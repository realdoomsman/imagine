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
import { env } from "./env.ts";
import { rawToUsd, usdPrice } from "./quotes.ts";
import { connection, imagine } from "./solana.ts";
import { unsyncedRewards } from "./stonk.ts";
import { budgetInstructions } from "./transactions.ts";

/**
 * The keeper. Permissionless cranks, paid for by `KEEPER_KEYPAIR`.
 *
 * Syncs. StonkFun forwards a coin's creator share to the LaunchLab pool's
 * creator — for an IMAGINE coin, the pool's reward vault — as plain transfers
 * that no program sees. Those funds join the lockers' stream only when
 * someone calls `sync`, and nobody has a reason to do that promptly, so the
 * keeper does: once a pool's vault holds at least `SYNC_MIN_USD` more than it
 * did at the last sync. Each pool is synced at most once per
 * `SYNC_SPACING_MS`, and a sync that folded nothing in backs that pool off
 * exponentially, so no pool can make the keeper burn fees.
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

/** Below this the keeper logs and stops sending rather than draining itself. */
const MIN_KEEPER_BALANCE = 20_000_000n;

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

async function aboveFloor(keeper: Keypair): Promise<boolean> {
  const balance = BigInt(await connection.getBalance(keeper.publicKey));
  if (balance >= MIN_KEEPER_BALANCE) return true;
  console.warn(`keeper ${keeper.publicKey.toBase58()} holds ${balance} lamports; below floor, not sending`);
  return false;
}

async function send(keeper: Keypair, tx: Transaction): Promise<string> {
  return sendAndConfirmTransaction(connection, tx, [keeper], { commitment: "confirmed", maxRetries: 3 });
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

/** Sync every pool whose vault took in at least `SYNC_MIN_USD` since its last sync. */
async function syncPools(keeper: Keypair): Promise<{ synced: number; skipped: number }> {
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
      if (!pool) {
        skipped += 1;
        continue;
      }
      const pending = await unsyncedRewards(pool);
      if (pending === 0n) {
        skipped += 1;
        continue;
      }
      const usd = rawToUsd(pending, Number(row.quote_decimals), await usdPrice(row.quote_mint as string));
      if (usd !== null && usd < env.syncMinUsd) {
        skipped += 1;
        continue;
      }
      const signature = await send(
        keeper,
        new Transaction().add(
          ...budgetInstructions(20_000, 150_000),
          await imagine.sync({ mint, quote: { mint: pool.quoteMint, tokenProgram: pool.quoteTokenProgram } }),
        ),
      );
      const after = await imagine.fetchPool(mint);
      const gained = after ? after.lifetimeInflow - pool.lifetimeInflow : 0n;
      settle(syncBackoff, key, gained > 0n, Date.now(), usd === null ? UNPRICED_SYNC_SPACING_MS : SYNC_SPACING_MS);
      synced += 1;
      await sql`
        INSERT INTO keeper_runs (mint, amount, signature)
        VALUES (${key}, ${pending.toString()}::NUMERIC, ${signature})
      `;
      console.log(
        `synced ${pending} unsynced quote units for ${key} in ${signature}; inflow +${gained}` +
          (gained > 0n ? "" : `, backing off (strike ${syncBackoff.get(key)?.strikes})`),
      );
    } catch (error) {
      settle(syncBackoff, key, false, Date.now());
      console.error("sync failed", key, error);
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
      console.log(
        `unlocked matured position ${key} (owner ${position.owner.toBase58()}, mint ${pool.mint.toBase58()}) in ${signature}` +
          (missing > 0 ? `; created ${missing} owner token account(s)` : ""),
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
      console.log(`claimed ${pool.treasuryClaimable} quote units to treasury for ${key} in ${signature}`);
    } catch (error) {
      treasuryClaimedAt.set(key, Date.now());
      console.error("treasury claim failed", key, error);
    }
  }
  return claimed;
}

export async function runOnce(
  keeper: Keypair,
): Promise<{ synced: number; skipped: number; unlocked: number; harvested: number; treasuries: number }> {
  const idle = { synced: 0, skipped: 0, unlocked: 0, harvested: 0, treasuries: 0 };
  if (!(await aboveFloor(keeper))) return idle;
  const { synced, skipped } = await syncPools(keeper);
  // Re-checked before each crank: the ones before spent from the same balance.
  const unlocked = (await aboveFloor(keeper)) ? await unlockMatured(keeper) : 0;
  const harvested = (await aboveFloor(keeper)) ? await retireCapped(keeper) : 0;
  const treasuries = (await aboveFloor(keeper)) ? await claimTreasuries(keeper) : 0;
  return { synced, skipped, unlocked, harvested, treasuries };
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
