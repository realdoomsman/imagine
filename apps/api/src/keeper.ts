import {
  ammCreatorVaultPda,
  creatorVaultPda,
  feeSharingConfigPda,
  quoteAta,
  type SharingConfig,
} from "@pump-fun/pump-sdk";
import { AccountLayout, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  accrued,
  decodePool,
  decodePosition,
  DISCRIMINATOR,
  poolPda,
  positionPda,
  rewardVaultPda,
  VISE_PROGRAM_ID,
} from "@imagine/sdk";
import bs58 from "bs58";
import { sql } from "./db.ts";
import { env } from "./env.ts";
import {
  budgetInstructions,
  fetchSharingConfig,
  QUOTE_MINT,
  QUOTE_TOKEN_PROGRAM,
  routesEntirelyToPool,
  sweepCreatorFees,
} from "./pump.ts";
import { connection, vise } from "./solana.ts";

/**
 * The keeper. Two permissionless cranks, paid for by `KEEPER_KEYPAIR`.
 *
 * Sweeps. pump.fun pays a coin's creator fees into a vault and leaves them
 * there until someone calls `distribute_creator_fees_v2`. Nobody has a reason
 * to do that promptly — the lockers it pays are the ones who would least like
 * to spend SOL on it — so VISE does: distribution and a pool sync in one
 * transaction. Only for coins whose pump sharing config permanently routes
 * 100% to the pool's reward vault; anything else would have the keeper paying
 * to move fees into somebody else's wallet. Each coin is swept at most once
 * per `SWEEP_SPACING_MS`, and a sweep that moved nothing into the pool backs
 * that coin off exponentially, so no coin can make the keeper burn fees.
 *
 * Matured unlocks. A position past its `lock_end` keeps its full weight — and
 * keeps diluting every live locker — until someone closes it. `unlock` is
 * permissionless once matured and pays principal, rewards and rent to the
 * owner whoever signs, so the keeper closes them, creating the owner's token
 * account first when it is missing.
 *
 * Capped locks. On a pool with earnings limits, a lock that has accrued its
 * cap keeps its weight until touched, soaking up a share the locks still
 * earning should get. `harvest` pays the owner up to the cap, sends the
 * excess to the treasury and retires the lock's weight; the keeper calls it
 * the moment a lock is due.
 *
 * Treasury. `claim_treasury` moves each pool's treasury share — the 10% cut
 * plus every surplus fee no lock could earn — into the treasury wallet, so it
 * is withdrawable there without anyone doing anything.
 */

/**
 * pump leaves the creator vault at the rent-exempt minimum for an empty
 * account. Read from the cluster, not hardcoded: the rent rate differs between
 * clusters and has changed over time (mainnet is 650,240 lamports, not the
 * long-standing 890,880).
 */
let emptyAccountRent: Promise<bigint> | null = null;
function rentFloor(): Promise<bigint> {
  emptyAccountRent ??= connection.getMinimumBalanceForRentExemption(0).then(BigInt);
  return emptyAccountRent;
}
/** Below this the keeper logs and stops sending rather than draining itself. */
const MIN_KEEPER_BALANCE = 20_000_000n;

/** A coin is swept at most once per this long, however busy it is. */
const SWEEP_SPACING_MS = 10 * 60_000;
/** Ceiling for the exponential backoff after sweeps that moved nothing. */
const MAX_BACKOFF_MS = 24 * 60 * 60_000;
/** Sends per tick, so one tick's spend is bounded whatever the pool count. */
const SWEEPS_PER_TICK = 10;
const UNLOCKS_PER_TICK = 5;
/** How often the full position scan for matured locks runs. */
const MATURED_SCAN_MS = 10 * 60_000;
/**
 * A config that does not route to the pool yet may still be pointed at it —
 * and a fresh launch always looks unrouted for a moment, because the pool
 * opens a transaction before the fee routing lands. Re-read soon, so a new
 * coin's first fees are not held back for an hour.
 */
const ROUTING_RECHECK_MS = 5 * 60_000;
/**
 * Missing owner token accounts the keeper will pay rent for, per rolling day.
 * The owner can close that account again and pocket the rent, so without a
 * cap a wallet with many small matured locks could farm the keeper.
 */
const ATA_CREATIONS_PER_DAY = 10;
/** How often capped pools are scanned for locks that reached their cap. */
const CAP_SCAN_MS = 5 * 60_000;
const HARVESTS_PER_TICK = 5;
/** Treasury claims: only worth a transaction above this, at most hourly per pool. */
const TREASURY_MIN_LAMPORTS = 10_000_000n;
const TREASURY_SPACING_MS = 60 * 60_000;

export function loadKeeper(): Keypair | null {
  const raw = env.keeperKeypair.trim();
  if (!raw) return null;
  // Accept either the CLI's JSON byte array or a base58 secret.
  const bytes = raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw) as number[])
    : bs58.decode(raw);
  return Keypair.fromSecretKey(bytes);
}

async function aboveFloor(keeper: Keypair): Promise<boolean> {
  const balance = BigInt(await connection.getBalance(keeper.publicKey));
  if (balance >= MIN_KEEPER_BALANCE) return true;
  console.warn(
    `keeper ${keeper.publicKey.toBase58()} holds ${balance} lamports; below floor, not sending`,
  );
  return false;
}

interface Backoff {
  nextAt: number;
  strikes: number;
}

/** Success waits the normal spacing; each consecutive miss doubles it, capped. */
function settle(backoff: Map<string, Backoff>, key: string, ok: boolean, now: number) {
  if (ok) {
    backoff.set(key, { nextAt: now + SWEEP_SPACING_MS, strikes: 0 });
    return;
  }
  const strikes = (backoff.get(key)?.strikes ?? 0) + 1;
  backoff.set(key, {
    nextAt: now + Math.min(SWEEP_SPACING_MS * 2 ** strikes, MAX_BACKOFF_MS),
    strikes,
  });
}

/**
 * Lamports waiting to be distributed for one coin, by source: the pump creator
 * vault above its rent floor, and the AMM's WSOL creator vault once one exists.
 */
export async function distributable(mint: PublicKey): Promise<{ pump: bigint; amm: bigint }> {
  const sharing = feeSharingConfigPda(mint);
  const [[vault, ammAta], floor] = await Promise.all([
    connection.getMultipleAccountsInfo([
      creatorVaultPda(sharing),
      quoteAta(ammCreatorVaultPda(sharing), QUOTE_MINT, QUOTE_TOKEN_PROGRAM),
    ]),
    rentFloor(),
  ]);

  const pump = vault && BigInt(vault.lamports) > floor ? BigInt(vault.lamports) - floor : 0n;
  const amm =
    ammAta && ammAta.data.length >= AccountLayout.span
      ? AccountLayout.decode(ammAta.data).amount
      : 0n;
  return { pump, amm };
}

/**
 * Verdicts on each coin's fee routing. A passing config has its admin revoked,
 * so it can never change and is cached for the life of the process; a failing
 * one is re-read hourly in case the creator routes it to the pool later.
 */
const routing = new Map<
  string,
  { ok: true; config: SharingConfig } | { ok: false; recheckAt: number }
>();

async function verifiedRouting(mint: PublicKey): Promise<SharingConfig | null> {
  const key = mint.toBase58();
  const cached = routing.get(key);
  if (cached?.ok) return cached.config;
  if (cached && Date.now() < cached.recheckAt) return null;

  const config = await fetchSharingConfig(mint);
  if (config && routesEntirelyToPool(mint, config)) {
    routing.set(key, { ok: true, config });
    return config;
  }
  if (!cached) {
    console.warn(
      `keeper: not sweeping ${key}: pump fee sharing ${
        config
          ? "does not route 100% to the pool reward vault with admin revoked"
          : "is not configured"
      }`,
    );
  }
  routing.set(key, { ok: false, recheckAt: Date.now() + ROUTING_RECHECK_MS });
  return null;
}

const sweepBackoff = new Map<string, Backoff>();

async function sweep(
  keeper: Keypair,
  mint: PublicKey,
  includeAmm: boolean,
  sharingConfig: SharingConfig,
) {
  const ixs = await sweepCreatorFees({ payer: keeper.publicKey, mint, includeAmm, sharingConfig });
  if (ixs.length === 0) return null;
  const tx = new Transaction().add(...budgetInstructions(50_000, 400_000), ...ixs);
  return sendAndConfirmTransaction(connection, tx, [keeper], {
    commitment: "confirmed",
    maxRetries: 3,
  });
}

async function sweepPools(keeper: Keypair): Promise<{ swept: number; skipped: number }> {
  const pools = await sql`SELECT mint FROM pools`;
  let swept = 0;
  let skipped = 0;

  for (const row of pools) {
    if (swept >= SWEEPS_PER_TICK) break;
    const key = row.mint as string;
    if ((sweepBackoff.get(key)?.nextAt ?? 0) > Date.now()) {
      skipped += 1;
      continue;
    }
    const mint = new PublicKey(key);
    try {
      const sharingConfig = await verifiedRouting(mint);
      if (!sharingConfig) {
        skipped += 1;
        continue;
      }
      const { pump, amm } = await distributable(mint);
      const pending = pump + amm;
      if (pending < env.sweepMinLamports) {
        skipped += 1;
        continue;
      }
      const vault = rewardVaultPda(mint);
      const before = BigInt(await connection.getBalance(vault, "confirmed"));
      const signature = await sweep(keeper, mint, amm > 0n, sharingConfig);
      if (!signature) {
        skipped += 1;
        continue;
      }
      const gained = BigInt(await connection.getBalance(vault, "confirmed")) - before;
      settle(sweepBackoff, key, gained > 0n, Date.now());
      swept += 1;
      await sql`
        INSERT INTO keeper_runs (mint, lamports, signature)
        VALUES (${key}, ${pending.toString()}::BIGINT, ${signature})
      `;
      console.log(
        `swept ${pending} lamports for ${key} in ${signature}; reward vault +${gained}` +
          (gained > 0n ? "" : `, backing off (strike ${sweepBackoff.get(key)?.strikes})`),
      );
    } catch (error) {
      settle(sweepBackoff, key, false, Date.now());
      console.error("sweep failed", key, error);
    }
  }
  return { swept, skipped };
}

/** Positions whose lock ends before the next full scan, soonest first. */
let matured: Array<{ address: PublicKey; lockEnd: number }> = [];
let maturedScannedAt = 0;
const unlockBackoff = new Map<string, Backoff>();
const ataCreations: number[] = [];

async function maturedCandidates(): Promise<typeof matured> {
  if (Date.now() - maturedScannedAt < MATURED_SCAN_MS) return matured;
  const horizon = Math.floor((Date.now() + MATURED_SCAN_MS) / 1000);
  const accounts = await connection.getProgramAccounts(VISE_PROGRAM_ID, {
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
      candidate.lockEnd <= now &&
      (unlockBackoff.get(candidate.address.toBase58())?.nextAt ?? 0) <= Date.now(),
  );
  let attempts = 0;
  let unlocked = 0;

  for (const { address } of due) {
    if (attempts >= UNLOCKS_PER_TICK) break;
    const key = address.toBase58();
    try {
      const positionInfo = await connection.getAccountInfo(address);
      if (!positionInfo || !positionInfo.owner.equals(VISE_PROGRAM_ID)) {
        forget(address); // already closed
        continue;
      }
      const position = decodePosition(positionInfo.data);
      if (position.lockEnd > now) {
        forget(address); // extended since the scan
        continue;
      }
      const poolInfo = await connection.getAccountInfo(position.pool);
      if (!poolInfo || !poolInfo.owner.equals(VISE_PROGRAM_ID)) {
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

      const ata = getAssociatedTokenAddressSync(pool.mint, position.owner, true, pool.tokenProgram);
      const ataMissing = (await connection.getAccountInfo(ata)) === null;
      if (ataMissing) {
        const dayAgo = Date.now() - 24 * 60 * 60_000;
        while (ataCreations.length > 0 && ataCreations[0]! < dayAgo) ataCreations.shift();
        if (ataCreations.length >= ATA_CREATIONS_PER_DAY) {
          settle(unlockBackoff, key, false, Date.now()); // retried once the budget frees
          continue;
        }
      }

      const ixs = await vise.unlockInstructions({
        owner: position.owner,
        mint: pool.mint,
        index: position.index,
        early: false,
        payer: keeper.publicKey,
        tokenProgram: pool.tokenProgram,
      });
      const tx = new Transaction().add(...budgetInstructions(10_000, 200_000), ...ixs);
      attempts += 1;
      const signature = await sendAndConfirmTransaction(connection, tx, [keeper], {
        commitment: "confirmed",
        maxRetries: 3,
      });
      if (ataMissing) ataCreations.push(Date.now());
      unlocked += 1;
      forget(address);
      console.log(
        `unlocked matured position ${key} (owner ${position.owner.toBase58()}, mint ${pool.mint.toBase58()}) in ${signature}` +
          (ataMissing ? "; created the owner's token account" : ""),
      );
    } catch (error) {
      settle(unlockBackoff, key, false, Date.now());
      console.error("matured unlock failed", key, error);
    }
  }
  return unlocked;
}

let capScannedAt = 0;

/**
 * Retire locks on capped pools that have accrued their cap. Re-derived from
 * chain each scan; `harvest` itself re-checks everything on-chain.
 */
async function retireCapped(keeper: Keypair): Promise<number> {
  if (Date.now() - capScannedAt < CAP_SCAN_MS) return 0;
  capScannedAt = Date.now();
  const pools = await sql`SELECT mint FROM pools`;
  let harvested = 0;
  for (const row of pools) {
    if (harvested >= HARVESTS_PER_TICK) break;
    const mint = new PublicKey(row.mint as string);
    try {
      const pool = await vise.fetchProjectedPool(mint);
      if (!pool?.capped) continue;
      for (const position of await vise.fetchPositionsByPool(mint)) {
        if (harvested >= HARVESTS_PER_TICK) break;
        if (position.weight === 0n) continue;
        const room = position.rewardCap > position.claimed ? position.rewardCap - position.claimed : 0n;
        if (accrued(position.weight, pool.accRewardPerWeight, position.rewardDebt) < room) continue;
        const ix = await vise.harvest({
          payer: keeper.publicKey,
          owner: position.owner,
          mint,
          index: position.index,
        });
        const signature = await sendAndConfirmTransaction(
          connection,
          new Transaction().add(...budgetInstructions(10_000, 120_000), ix),
          [keeper],
          { commitment: "confirmed", maxRetries: 3 },
        );
        harvested += 1;
        console.log(
          `retired capped lock ${position.address.toBase58()} (owner ${position.owner.toBase58()}, mint ${mint.toBase58()}) in ${signature}`,
        );
      }
    } catch (error) {
      console.error("capped-lock scan failed", mint.toBase58(), error);
    }
  }
  return harvested;
}

const treasuryClaimedAt = new Map<string, number>();

/** Move each pool's treasury share to the treasury wallet. */
async function claimTreasuries(keeper: Keypair): Promise<number> {
  const pools = await sql`SELECT mint FROM pools`;
  let claimed = 0;
  for (const row of pools) {
    const key = row.mint as string;
    if (Date.now() - (treasuryClaimedAt.get(key) ?? 0) < TREASURY_SPACING_MS) continue;
    try {
      const pool = await vise.fetchProjectedPool(new PublicKey(key));
      if (!pool || pool.treasuryClaimable < TREASURY_MIN_LAMPORTS) continue;
      const ix = await vise.claimTreasury({
        payer: keeper.publicKey,
        mint: pool.mint,
        treasury: pool.treasury,
      });
      const signature = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(...budgetInstructions(10_000, 120_000), ix),
        [keeper],
        { commitment: "confirmed", maxRetries: 3 },
      );
      treasuryClaimedAt.set(key, Date.now());
      claimed += 1;
      console.log(`claimed ${pool.treasuryClaimable} lamports to treasury for ${key} in ${signature}`);
    } catch (error) {
      treasuryClaimedAt.set(key, Date.now());
      console.error("treasury claim failed", key, error);
    }
  }
  return claimed;
}

export async function runOnce(
  keeper: Keypair,
): Promise<{ swept: number; skipped: number; unlocked: number; harvested: number; treasuries: number }> {
  const idle = { swept: 0, skipped: 0, unlocked: 0, harvested: 0, treasuries: 0 };
  if (!(await aboveFloor(keeper))) return idle;
  const { swept, skipped } = await sweepPools(keeper);
  // Re-checked before each crank: the ones before spent from the same balance.
  const unlocked = (await aboveFloor(keeper)) ? await unlockMatured(keeper) : 0;
  const harvested = (await aboveFloor(keeper)) ? await retireCapped(keeper) : 0;
  const treasuries = (await aboveFloor(keeper)) ? await claimTreasuries(keeper) : 0;
  return { swept, skipped, unlocked, harvested, treasuries };
}

/** Start the loop if a keeper key is configured. Returns whether it started. */
export function startKeeper(): boolean {
  const keeper = loadKeeper();
  if (!keeper) {
    console.log("keeper disabled: KEEPER_KEYPAIR not set");
    return false;
  }
  console.log(`keeper ${keeper.publicKey.toBase58()} every ${env.keeperIntervalMs}ms`);

  let running = false;
  const tick = async () => {
    if (running) return; // a slow RPC must not stack runs
    running = true;
    try {
      await runOnce(keeper);
    } catch (error) {
      console.error("keeper run failed", error);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), env.keeperIntervalMs);
  return true;
}
