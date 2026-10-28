import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  accrued,
  decodePool,
  decodePosition,
  DISCRIMINATOR,
  IMAGINE_PROGRAM_ID,
  poolPda,
  positionPda,
} from "@imagine/sdk";
import bs58 from "bs58";
import { sql } from "./db.ts";
import { logger } from "./log.ts";
import { env } from "./env.ts";
import { rawToUsd, usdPrice } from "./quotes.ts";
import { connection, imagine } from "./solana.ts";
import { collectFeesInstructions, readMarket, uncollectedFees, unsyncedRewards } from "./raydium.ts";
import { KEEPER_LOW_BALANCE, KEEPER_MIN_BALANCE, writeStatus } from "./status.ts";
import { budgetInstructions } from "./transactions.ts";

/**
 * The keeper. Permissionless cranks, paid for by `KEEPER_KEYPAIR`.
 *
 * Fee collection. Every curve trade on a coin, wherever it happens, pays the
 * platform's on-chain trading fee into LaunchLab's creator-fee vault for that
 * coin — whose "creator" is the pool's reward vault — and after graduation
 * CPMM keeps its creator fees in the pool state. Those sit there until someone
 * calls `collect_creator_fee`, which moves them into the vault and syncs; app
 * fees and donations are already in the vault and need only `sync`. Nobody
 * has a reason to crank this promptly, so the keeper does, once a pool's
 * uncollected plus unsynced value reaches `SYNC_MIN_USD`. Each pool is
 * cranked at most once per `SYNC_SPACING_MS`, and a crank that folded nothing
 * in backs that pool off exponentially, so no pool can make the keeper burn
 * fees.
 *
 * Matured unlocks. A position past its `lock_end` keeps its full weight — and
 * keeps diluting every live locker — until someone closes it. `unlock` is
 * permissionless once matured and pays principal, rewards and rent to the
 * owner whoever signs, so the keeper closes them, creating the owner's token
 * accounts first when they are missing.
 *
 * Capped locks. A lock that has accrued its earnings cap keeps its weight
 * until touched, soaking up a share the locks still earning should get.
 * `harvest` pays the owner up to the cap, sends the excess to the treasury and
 * retires the lock's weight; the keeper calls it the moment a lock is due.
 *
 * Treasury. `claim_treasury` moves each pool's treasury share — the 10% cut
 * plus every surplus fee no lock could earn — into the treasury wallet, so it
 * is withdrawable there without anyone doing anything.
 */

const log = logger("keeper");

/** While the wallet is low (but above the floor) the warning repeats this often, not every tick. */
const LOW_BALANCE_WARN_EVERY_MS = 15 * 60_000;

/** A pool is synced at most once per this long, however busy it is. */
const SYNC_SPACING_MS = 10 * 60_000;
/** Without a USD price, unsynced balance is folded in at most this often. */
const UNPRICED_SYNC_SPACING_MS = 60 * 60_000;
/** Ceiling for the exponential backoff after syncs that folded in nothing. */
const MAX_BACKOFF_MS = 24 * 60 * 60_000;
/** Sends per tick, so one tick's spend is bounded whatever the pool count. */
const SYNCS_PER_TICK = 10;
const UNLOCKS_PER_TICK = 5;
/** How often the full position scan for matured locks runs. */
const MATURED_SCAN_MS = 10 * 60_000;
/**
 * Missing owner token accounts the keeper will pay rent for, per rolling day.
 * The owner can close that account again and pocket the rent, so without a
 * cap a wallet with many small matured locks could farm the keeper.
 */
const ATA_CREATIONS_PER_DAY = 10;
/** How often pools are scanned for locks that reached their cap. */
const CAP_SCAN_MS = 5 * 60_000;
const HARVESTS_PER_TICK = 5;
/** Treasury claims: only worth a transaction above this much USD, at most hourly per pool. */
const TREASURY_MIN_USD = 5;
const TREASURY_SPACING_MS = 60 * 60_000;

export function loadKeeper(): Keypair | null {
  const raw = env.keeperKeypair.trim();
  if (!raw) return null;
  // Accept either the CLI's JSON byte array or a base58 secret.
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw);
  return Keypair.fromSecretKey(bytes);
}

/** What the last balance read saw; published to /health with each run. */
let lastBalance: bigint | null = null;
let lowWarnedAt = 0;

/**
 * The wallet's balance, checked before each phase: below 0.03 SOL it warns
 * (every `LOW_BALANCE_WARN_EVERY_MS`), below the 0.02 SOL floor it stops
 * sending rather than drain itself.
 */
async function aboveFloor(keeper: Keypair): Promise<boolean> {
  const balance = BigInt(await connection.getBalance(keeper.publicKey));
  lastBalance = balance;
  const fields = { wallet: keeper.publicKey, balanceLamports: balance, balanceSol: Number(balance) / 1e9 };
  if (balance < KEEPER_MIN_BALANCE) {
    if (Date.now() - lowWarnedAt >= LOW_BALANCE_WARN_EVERY_MS) {
      lowWarnedAt = Date.now();
      log.error("keeper wallet below floor; not sending", { ...fields, floorSol: Number(KEEPER_MIN_BALANCE) / 1e9 });
    }
    return false;
  }
  if (balance < KEEPER_LOW_BALANCE) {
    if (Date.now() - lowWarnedAt >= LOW_BALANCE_WARN_EVERY_MS) {
      lowWarnedAt = Date.now();
      log.warn("keeper wallet low; top it up", { ...fields, lowSol: Number(KEEPER_LOW_BALANCE) / 1e9 });
    }
  } else if (lowWarnedAt !== 0) {
    lowWarnedAt = 0;
    log.info("keeper wallet topped up", fields);
  }
  return true;
}

/**
 * The keeper must be a singleton — two would race to send the same cranks —
 * but a deploy briefly overlaps the old indexer process with the new one. So
 * every send first takes (or renews) a lease row; whoever holds an unexpired
 * lease is the only sender, and a process that died lets it lapse.
 */
const LEASE_TTL_SECS = 300;
const leaseHolder = `${hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;
/** Null until the first attempt, so a process that starts on standby says so. */
let holdingLease: boolean | null = null;

class LeaseLost extends Error {
  constructor() {
    super("another keeper holds the lease");
  }
}

async function takeLease(): Promise<boolean> {
  const rows = await sql`
    INSERT INTO leases (name, holder, expires_at)
    VALUES ('keeper', ${leaseHolder}, NOW() + make_interval(secs => ${LEASE_TTL_SECS}))
    ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
    WHERE leases.holder = EXCLUDED.holder OR leases.expires_at < NOW()
    RETURNING holder
  `;
  const held = rows.length > 0;
  if (held !== holdingLease) {
    holdingLease = held;
    if (held) log.info("keeper lease acquired", { holder: leaseHolder });
    else log.warn("keeper lease held elsewhere; standing by", { holder: leaseHolder });
  }
  return held;
}

async function releaseLease(): Promise<void> {
  await sql`DELETE FROM leases WHERE name = 'keeper' AND holder = ${leaseHolder}`;
  holdingLease = false;
}

let lastSentAt: Date | null = null;

async function send(keeper: Keypair, tx: Transaction): Promise<string> {
  if (!(await takeLease())) throw new LeaseLost();
  const signature = await sendAndConfirmTransaction(connection, tx, [keeper], { commitment: "confirmed", maxRetries: 3 });
  lastSentAt = new Date();
  return signature;
}

interface Backoff {
  nextAt: number;
  strikes: number;
}

/** Success waits the normal spacing; each consecutive miss doubles it, capped. */
function settle(backoff: Map<string, Backoff>, key: string, ok: boolean, now: number, spacing = SYNC_SPACING_MS) {
  if (ok) {
    backoff.set(key, { nextAt: now + spacing, strikes: 0 });
    return;
  }
  const strikes = (backoff.get(key)?.strikes ?? 0) + 1;
  backoff.set(key, { nextAt: now + Math.min(spacing * 2 ** strikes, MAX_BACKOFF_MS), strikes });
}

const syncBackoff = new Map<string, Backoff>();

/** Collect and sync every pool whose uncollected + unsynced rewards reach `SYNC_MIN_USD`. */
async function collectPools(keeper: Keypair): Promise<{ synced: number; skipped: number }> {
  const pools = await sql`SELECT mint, quote_mint, quote_decimals FROM pools`;
  let synced = 0;
  let skipped = 0;

  for (const row of pools) {
    if (synced >= SYNCS_PER_TICK) break;
    const key = row.mint as string;
    if ((syncBackoff.get(key)?.nextAt ?? 0) > Date.now()) {
      skipped += 1;
      continue;
    }
    const mint = new PublicKey(key);
    try {
      const pool = await imagine.fetchPool(mint);
      if (!pool?.founded) {
        skipped += 1;
        continue;
      }
      const market = await readMarket(mint, pool.quoteMint);
      const [uncollected, unsynced] = await Promise.all([uncollectedFees(pool, market), unsyncedRewards(pool)]);
      const pending = uncollected + unsynced;
      if (pending === 0n) {
        skipped += 1;
        continue;
      }
      const usd = rawToUsd(pending, Number(row.quote_decimals), await usdPrice(row.quote_mint as string));
      if (usd !== null && usd < env.syncMinUsd) {
        skipped += 1;
        continue;
      }
      // Collecting syncs inline; with nothing to collect, a plain sync is cheaper.
      const instructions =
        uncollected > 0n
          ? await collectFeesInstructions(keeper.publicKey, pool, market)
          : [await imagine.sync({ mint, quote: { mint: pool.quoteMint, tokenProgram: pool.quoteTokenProgram } })];
      const signature = await send(keeper, new Transaction().add(...budgetInstructions(20_000, 300_000), ...instructions));
      const after = await imagine.fetchPool(mint);
      const gained = after ? after.lifetimeInflow - pool.lifetimeInflow : 0n;
      settle(syncBackoff, key, gained > 0n, Date.now(), usd === null ? UNPRICED_SYNC_SPACING_MS : SYNC_SPACING_MS);
      synced += 1;
      await sql`
        INSERT INTO keeper_runs (mint, amount, signature)
        VALUES (${key}, ${pending.toString()}::NUMERIC, ${signature})
      `;
      log.info(uncollected > 0n ? "collected and synced pool fees" : "synced pool", {
        action: uncollected > 0n ? "collect" : "sync",
        mint: key,
        signature,
        uncollected,
        unsynced,
        inflowGained: gained,
        ...(gained > 0n ? {} : { backoffStrike: syncBackoff.get(key)?.strikes }),
      });
    } catch (error) {
      if (error instanceof LeaseLost) throw error;
      settle(syncBackoff, key, false, Date.now());
      log.error("fee collection failed", { action: "collect", mint: key, err: error });
    }
  }
  return { synced, skipped };
}

/** Positions whose lock ends before the next full scan, soonest first. */
let matured: Array<{ address: PublicKey; lockEnd: number }> = [];
let maturedScannedAt = 0;
const unlockBackoff = new Map<string, Backoff>();
const ataCreations: number[] = [];

async function maturedCandidates(): Promise<typeof matured> {
  if (Date.now() - maturedScannedAt < MATURED_SCAN_MS) return matured;
  const horizon = Math.floor((Date.now() + MATURED_SCAN_MS) / 1000);
  const accounts = await connection.getProgramAccounts(IMAGINE_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(DISCRIMINATOR.position) } }],
  });
  matured = accounts
    .flatMap(({ pubkey, account }) => {
      try {
        const { lockEnd } = decodePosition(account.data);
        return lockEnd <= horizon ? [{ address: pubkey, lockEnd }] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.lockEnd - b.lockEnd);
  maturedScannedAt = Date.now();
  // Positions closed by their owners never come back through `forget`; drop
  // their backoff entries here so the map only ever holds live candidates.
  const live = new Set(matured.map((candidate) => candidate.address.toBase58()));
  for (const key of unlockBackoff.keys()) if (!live.has(key)) unlockBackoff.delete(key);
  return matured;
}

function forget(address: PublicKey) {
  matured = matured.filter((candidate) => !candidate.address.equals(address));
  unlockBackoff.delete(address.toBase58());
}

/**
 * Close up to `UNLOCKS_PER_TICK` matured positions. Every candidate is
 * re-read and re-derived from chain before sending: the scan is only a hint.
 */
async function unlockMatured(keeper: Keypair): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const due = (await maturedCandidates()).filter(
    (candidate) =>
      candidate.lockEnd <= now && (unlockBackoff.get(candidate.address.toBase58())?.nextAt ?? 0) <= Date.now(),
  );
  let attempts = 0;
  let unlocked = 0;

  for (const { address } of due) {
    if (attempts >= UNLOCKS_PER_TICK) break;
    const key = address.toBase58();
    try {
      const positionInfo = await connection.getAccountInfo(address);
      if (!positionInfo || !positionInfo.owner.equals(IMAGINE_PROGRAM_ID)) {
        forget(address); // already closed
        continue;
      }
      const position = decodePosition(positionInfo.data);
      if (position.lockEnd > now) {
        forget(address); // extended since the scan
        continue;
      }
      const poolInfo = await connection.getAccountInfo(position.pool);
      if (!poolInfo || !poolInfo.owner.equals(IMAGINE_PROGRAM_ID)) {
        forget(address);
        continue;
      }
      const pool = decodePool(poolInfo.data);
      if (
        !position.pool.equals(poolPda(pool.mint)) ||
        !address.equals(positionPda(pool.mint, position.owner, position.index))
      ) {
        forget(address);
        continue;
      }

      // The owner's coin account, and for a token-paired pool its quote
      // account: the keeper pays rent for whichever is missing.
      const needed = [getAssociatedTokenAddressSync(pool.mint, position.owner, true, pool.tokenProgram)];
      if (!pool.quoteMint.equals(NATIVE_MINT)) {
        needed.push(getAssociatedTokenAddressSync(pool.quoteMint, position.owner, true, pool.quoteTokenProgram));
      }
      const missing = (await connection.getMultipleAccountsInfo(needed)).filter((info) => info === null).length;
      if (missing > 0) {
        const dayAgo = Date.now() - 24 * 60 * 60_000;
        while (ataCreations.length > 0 && ataCreations[0]! < dayAgo) ataCreations.shift();
        if (ataCreations.length + missing > ATA_CREATIONS_PER_DAY) {
          settle(unlockBackoff, key, false, Date.now()); // retried once the budget frees
          continue;
        }
      }

      const ixs = await imagine.unlock({
        owner: position.owner,
        mint: pool.mint,
        quote: { mint: pool.quoteMint, tokenProgram: pool.quoteTokenProgram },
        index: position.index,
        early: false,
        payer: keeper.publicKey,
      });
      attempts += 1;
      const signature = await send(keeper, new Transaction().add(...budgetInstructions(10_000, 250_000), ...ixs));
      for (let i = 0; i < missing; i += 1) ataCreations.push(Date.now());
      unlocked += 1;
      forget(address);
      log.info("unlocked matured position", {
        action: "unlock",
        position: key,
        owner: position.owner,
        mint: pool.mint,
        signature,
        ownerAccountsCreated: missing,
      });
    } catch (error) {
      if (error instanceof LeaseLost) throw error;
      settle(unlockBackoff, key, false, Date.now());
      log.error("matured unlock failed", { action: "unlock", position: key, err: error });
    }
  }
  return unlocked;
}

let capScannedAt = 0;

/**
 * Retire locks that have accrued their earnings cap. Re-derived from chain
 * each scan; `harvest` itself re-checks everything on-chain.
 */
async function retireCapped(keeper: Keypair): Promise<number> {
  if (Date.now() - capScannedAt < CAP_SCAN_MS) return 0;
  capScannedAt = Date.now();
  const pools = await sql`SELECT mint FROM pools WHERE open_positions > 0`;
  let harvested = 0;
  for (const row of pools) {
    if (harvested >= HARVESTS_PER_TICK) break;
    const mint = new PublicKey(row.mint as string);
    try {
      const pool = await imagine.fetchProjectedPool(mint);
      if (!pool) continue;
      for (const position of await imagine.fetchPositionsByPool(mint)) {
        if (harvested >= HARVESTS_PER_TICK) break;
        if (position.weight === 0n) continue;
        const room = position.rewardCap > position.claimed ? position.rewardCap - position.claimed : 0n;
        if (accrued(position.weight, pool.accRewardPerWeight, position.rewardDebt) < room) continue;
        const ixs = await imagine.harvest({
          payer: keeper.publicKey,
          owner: position.owner,
          mint,
          quote: { mint: pool.quoteMint, tokenProgram: pool.quoteTokenProgram },
          index: position.index,
        });
        const signature = await send(keeper, new Transaction().add(...budgetInstructions(10_000, 150_000), ...ixs));
        harvested += 1;
        log.info("retired capped lock", {
          action: "harvest",
          position: position.address,
          owner: position.owner,
          mint,
          signature,
        });
      }
    } catch (error) {
      if (error instanceof LeaseLost) throw error;
      log.error("capped-lock scan failed", { action: "harvest", mint, err: error });
    }
  }
  return harvested;
}

const treasuryClaimedAt = new Map<string, number>();

/** Move each pool's treasury share to the treasury wallet. */
async function claimTreasuries(keeper: Keypair): Promise<number> {
  const pools = await sql`SELECT mint, quote_mint, quote_decimals FROM pools`;
  let claimed = 0;
  for (const row of pools) {
    const key = row.mint as string;
    if (Date.now() - (treasuryClaimedAt.get(key) ?? 0) < TREASURY_SPACING_MS) continue;
    try {
      const pool = await imagine.fetchProjectedPool(new PublicKey(key));
      if (!pool || pool.treasuryClaimable === 0n) continue;
      const usd = rawToUsd(pool.treasuryClaimable, Number(row.quote_decimals), await usdPrice(row.quote_mint as string));
      if (usd === null || usd < TREASURY_MIN_USD) continue;
      const ixs = await imagine.claimTreasury({
        payer: keeper.publicKey,
        mint: pool.mint,
        quote: { mint: pool.quoteMint, tokenProgram: pool.quoteTokenProgram },
        treasury: pool.treasury,
      });
      const signature = await send(keeper, new Transaction().add(...budgetInstructions(10_000, 150_000), ...ixs));
      treasuryClaimedAt.set(key, Date.now());
      claimed += 1;
      log.info("claimed treasury share", { action: "claim_treasury", mint: key, amount: pool.treasuryClaimable, signature });
    } catch (error) {
      if (error instanceof LeaseLost) throw error;
      treasuryClaimedAt.set(key, Date.now());
      log.error("treasury claim failed", { action: "claim_treasury", mint: key, err: error });
    }
  }
  return claimed;
}

export interface RunResult {
  synced: number;
  skipped: number;
  unlocked: number;
  harvested: number;
  treasuries: number;
  /** Another process holds the keeper lease; this one sent nothing. */
  standby: boolean;
}

export async function runOnce(keeper: Keypair): Promise<RunResult> {
  const idle = { synced: 0, skipped: 0, unlocked: 0, harvested: 0, treasuries: 0, standby: false };
  if (!(await takeLease())) return { ...idle, standby: true };
  try {
    if (!(await aboveFloor(keeper))) return idle;
    const { synced, skipped } = await collectPools(keeper);
    // Re-checked before each crank: the ones before spent from the same balance.
    const unlocked = (await aboveFloor(keeper)) ? await unlockMatured(keeper) : 0;
    const harvested = (await aboveFloor(keeper)) ? await retireCapped(keeper) : 0;
    const treasuries = (await aboveFloor(keeper)) ? await claimTreasuries(keeper) : 0;
    return { synced, skipped, unlocked, harvested, treasuries, standby: false };
  } catch (error) {
    if (error instanceof LeaseLost) return { ...idle, standby: true };
    throw error;
  }
}

export interface KeeperHandle {
  /** Stop scheduling, let a run in progress finish (up to `graceMs`), release the lease. */
  stop(graceMs: number): Promise<void>;
}

/** Start the loop if a keeper key is configured; null when it is not. */
export function startKeeper(): KeeperHandle | null {
  const keeper = loadKeeper();
  if (!keeper) {
    log.warn("keeper disabled: KEEPER_KEYPAIR not set");
    void writeStatus("keeper", { enabled: false }).catch((err: unknown) =>
      log.error("keeper status write failed", { err }),
    );
    return null;
  }
  log.info("keeper started", { wallet: keeper.publicKey, intervalMs: env.keeperIntervalMs });

  let running: Promise<void> | null = null;
  let stopped = false;
  const tick = () => {
    if (running || stopped) return; // a slow RPC must not stack runs
    running = (async () => {
      const startedAt = new Date();
      let result: RunResult | null = null;
      let failure: unknown = null;
      try {
        result = await runOnce(keeper);
      } catch (error) {
        failure = error;
        log.error("keeper run failed", { err: error });
      }
      const tookMs = Date.now() - startedAt.getTime();
      // Only the lease holder speaks for the keeper on /health.
      if (result?.standby) return;
      // Each send is logged where it happens; the summary only when there were any.
      if (result && result.synced + result.unlocked + result.harvested + result.treasuries > 0) {
        log.info("keeper run", { ...result, tookMs, balanceLamports: lastBalance });
      }
      await writeStatus("keeper", {
        enabled: true,
        wallet: keeper.publicKey.toBase58(),
        intervalMs: env.keeperIntervalMs,
        balanceLamports: lastBalance?.toString() ?? null,
        lastRunAt: startedAt.toISOString(),
        lastRunMs: tookMs,
        lastRunOk: failure === null,
        lastError: failure === null ? null : failure instanceof Error ? failure.message.slice(0, 300) : String(failure),
        lastResult: result,
        lastSentAt: lastSentAt?.toISOString() ?? null,
      }).catch((err: unknown) => log.error("keeper status write failed", { err }));
    })().finally(() => {
      running = null;
    });
  };
  tick();
  const timer = setInterval(tick, env.keeperIntervalMs);

  return {
    async stop(graceMs: number) {
      stopped = true;
      clearInterval(timer);
      if (running) {
        await Promise.race([running, sleep(graceMs, undefined, { ref: false })]);
      }
      // A run cut off mid-send keeps the lease until it expires: the next
      // process waits rather than risk sending the same crank twice.
      if (!running && holdingLease === true) {
        await releaseLease().catch((err: unknown) => log.error("keeper lease release failed", { err }));
      }
      log.info("keeper stopped", { finishedRun: !running });
    },
  };
}
