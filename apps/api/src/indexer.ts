import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { EventParser } from "@coral-xyz/anchor";
import { getTokenMetadata, NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey, type Context, type Logs, type VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";
import {
  coder,
  decodePool,
  decodePosition,
  DISCRIMINATOR,
  IMAGINE_PROGRAM_ID,
  launchLabPoolPda,
  metadataUri,
  poolPda,
  positionPda,
  type PositionAccount,
} from "@imagine/sdk";
import { sql } from "./db.ts";
import { env } from "./env.ts";
import { imageUrl } from "./files.ts";
import { startKeeper, type KeeperHandle } from "./keeper.ts";
import { logger } from "./log.ts";
import { quoteDisplay } from "./quotes.ts";
import { connection, imagine, timedFetch } from "./solana.ts";
import { marketCapQuote, readMarket } from "./raydium.ts";
import { writeStatus } from "./status.ts";
import { RECONSTRUCTED_KIND, SYNCED_KIND } from "./views.ts";

/**
 * Builds the read model from program logs.
 *
 * Three loops with different jobs:
 *  - a websocket subscription that reacts to events within a slot, so the UI
 *    feels live, with a watchdog that resubscribes on a fresh socket when it
 *    goes silent;
 *  - a catch-up pass that replays every program transaction after the cursor
 *    that the socket did not deliver (or failed to handle), so history has no
 *    gaps; only this pass moves the cursor, and only over contiguous history;
 *  - a slow reconciler that re-reads pool accounts from chain, so counters
 *    converge to the chain whatever was missed.
 *
 * The chain stays authoritative: every number a user acts on is read from an
 * account, not from here. Events are only accepted when IMAGINE itself
 * emitted them, and are stamped with the transaction's time, never their own.
 * Only IMAGINE pools are listed: a coin launched on LaunchLab under the
 * IMAGINE platform without going through `launch` has no IMAGINE pool, emits
 * no IMAGINE event, and is refused by `upsertPoolFromChain` whatever names it.
 * Amounts are in each pool's quote base units.
 */

const log = logger("indexer");

type EventPayload = Record<string, { toString(): string } & PublicKey & number>;

/** A set that forgets its oldest entries past `max`, so dedupe memory stays bounded. */
export class RecentSet {
  private readonly items = new Set<string>();
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  has(key: string): boolean {
    return this.items.has(key);
  }
  add(key: string): void {
    if (this.items.has(key)) return;
    this.items.add(key);
    if (this.items.size > this.max) this.items.delete(this.items.values().next().value as string);
  }
  get size(): number {
    return this.items.size;
  }
}

/** Signatures fully handled (events applied), from either path. */
const handled = new RecentSet(20_000);
/** Signatures the websocket queued and not yet finished. */
const queued = new Set<string>();
let lastEventAt: Date | null = null;

/**
 * An event's numeric field as a bigint, read from the BN's bytes rather than
 * its base-10 stringifier, which has been seen emitting corrupt strings
 * ("3857820000NaN") for ordinary u64s.
 */
function asBigint(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (value && typeof value === "object" && "toArrayLike" in value && typeof value.toArrayLike === "function") {
    const hex = (value.toArrayLike(Buffer, "be") as Buffer).toString("hex");
    return BigInt(`0x${hex || "0"}`);
  }
  return BigInt(String(value));
}

function asDate(unixSeconds: unknown): Date {
  return new Date(Number(asBigint(unixSeconds)) * 1000);
}

/**
 * Anchor's parser follows the `invoke` / `success` stack in the logs and only
 * yields `Program data:` lines written while IMAGINE is the executing frame.
 * A `sol_log_data` from another program (LaunchLab emits its own events in
 * the same transactions), or a Memo that happens to contain an encoded event,
 * never gets through.
 */
const eventParser = new EventParser(IMAGINE_PROGRAM_ID, coder);

function parseImagineEvents(logs: string[]): Array<{ name: string; data: EventPayload }> {
  try {
    return [...eventParser.parseLogs(logs)].map((event) => ({
      name: event.name,
      data: event.data as EventPayload,
    }));
  } catch (error) {
    // An unbalanced invoke stack means attribution cannot be trusted.
    log.error("unparseable program logs", { err: error });
    return [];
  }
}

/** A transaction's time: its block time when known, never later than now. */
function txTime(blockTime: number | null | undefined): Date {
  const now = Date.now();
  return new Date(blockTime ? Math.min(blockTime * 1000, now) : now);
}

/**
 * Transactions are handled a few at a time: each one costs RPC reads, and a
 * burst of program activity must not fan out into hundreds of concurrent
 * requests against the same endpoint the keeper and the API depend on.
 */
const HANDLER_CONCURRENCY = 4;
const MAX_QUEUED = 20_000;
const queue: Array<() => Promise<void>> = [];
let active = 0;

/** Jobs running now, so shutdown can wait for them. */
const running = new Set<Promise<void>>();

/** False when the queue is full and the job was dropped (catch-up will replay it). */
function enqueue(job: () => Promise<void>): boolean {
  if (queue.length >= MAX_QUEUED) {
    log.error("indexer queue full; dropping a transaction (catch-up will replay it)", { queued: queue.length });
    return false;
  }
  queue.push(job);
  drain();
  return true;
}

function drain() {
  while (active < HANDLER_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    active += 1;
    const run: Promise<void> = job().finally(() => {
      active -= 1;
      running.delete(run);
      drain();
    });
    running.add(run);
  }
}

/** New-pool work in flight, per mint, so a replayed event never doubles it. */
const poolWork = new Map<string, Promise<void>>();

function indexNewPool(mint: string): Promise<void> {
  const pending = poolWork.get(mint);
  if (pending) return pending;
  const work = (async () => {
    const key = new PublicKey(mint);
    await upsertPoolFromChain(key);
    const [row] = await sql`SELECT name FROM pools WHERE mint = ${mint}`;
    if (!row) return; // not founded yet
    if (row.name === null) await backfillMetadata(mint);
    // The founding lock's `Locked` event shares the launch transaction's
    // truncated logs, so mirror the pool's positions from chain instead.
    for (const position of await imagine.fetchPositionsByPool(key)) {
      await syncPosition(key, position.address);
    }
  })().finally(() => poolWork.delete(mint));
  poolWork.set(mint, work);
  return work;
}

/**
 * The read-model mint of the pool an event names, indexing the pool first if
 * it is an IMAGINE pool not seen yet; null for anything else.
 *
 * A launch is one transaction carrying LaunchLab's mint creation and dev buy,
 * and its logs overrun the runtime's log cap: `PoolCreated` (emitted last, by
 * `found`) is routinely truncated away. So the read model never depends on
 * seeing it — the first event that names an unknown pool indexes it.
 */
async function mintOfPool(pool: PublicKey): Promise<string | null> {
  const [row] = await sql`SELECT mint FROM pools WHERE pool = ${pool.toBase58()}`;
  if (row) return row.mint as string;
  const info = await connection.getAccountInfo(pool);
  if (!info || !info.owner.equals(IMAGINE_PROGRAM_ID)) return null;
  let mint: PublicKey;
  try {
    mint = decodePool(info.data).mint;
  } catch {
    return null;
  }
  if (!poolPda(mint).equals(pool)) return null;
  await indexNewPool(mint.toBase58());
  const [indexed] = await sql`SELECT mint FROM pools WHERE pool = ${pool.toBase58()}`;
  return indexed ? (indexed.mint as string) : null;
}

async function handleEvent(name: string, data: EventPayload, signature: string, slot: number, at: Date) {
  switch (name) {
    // `PoolLaunched` is the launch's first event, so it survives the launch
    // transaction's log truncation; the pool is founded by the end of that
    // same transaction. `PoolCreated` covers a founding that landed apart.
    case "PoolLaunched":
    case "PoolCreated": {
      await indexNewPool(data.mint.toBase58());
      break;
    }

    case "RewardsSynced": {
      const mint = await mintOfPool(data.pool);
      if (!mint) break;
      // `to_lockers` is what joined the stream, not what has been paid out, so
      // adding it to lifetime_rewards here would run ahead of the chain. Read
      // the projected pool instead: one RPC, and every counter is exact.
      await upsertPoolFromChain(new PublicKey(mint));
      await sql`
        INSERT INTO fee_events (signature, mint, kind, amount, to_lockers, slot, at)
        VALUES (${signature}, ${mint}, ${SYNCED_KIND},
                ${asBigint(data.inflow).toString()}::NUMERIC,
                ${asBigint(data.to_lockers).toString()}::NUMERIC,
                ${slot}, ${at})
        ON CONFLICT DO NOTHING
      `;
      break;
    }

    case "FeeDeposited": {
      const mint = await mintOfPool(data.pool);
      if (!mint) break;
      await sql`
        INSERT INTO fee_events (signature, mint, kind, payer, amount, slot, at)
        VALUES (${signature}, ${mint}, ${Number(data.kind)},
                ${data.payer.toBase58()}, ${asBigint(data.amount).toString()}::NUMERIC,
                ${slot}, ${at})
        ON CONFLICT DO NOTHING
      `;
      break;
    }

    case "Locked":
    case "PositionIncreased":
    case "PositionExtended": {
      const mint = await mintOfPool(data.pool);
      if (!mint) break;
      await syncPosition(new PublicKey(mint), data.position);
      // A lock records what it locked, an increase what it added, an extend nothing.
      const amount = name === "PositionIncreased" ? data.added : name === "Locked" ? data.amount : 0;
      await sql`
        INSERT INTO lock_events (signature, mint, owner, kind, amount, weight, lock_end, slot, at)
        VALUES (${signature}, ${mint}, ${data.owner.toBase58()}, ${name},
                ${asBigint(amount).toString()}::NUMERIC,
                ${asBigint(data.weight ?? 0).toString()}::NUMERIC,
                ${data.lock_end ? asDate(data.lock_end) : null},
                ${slot}, ${at})
        ON CONFLICT DO NOTHING
      `;
      break;
    }

    case "Claimed": {
      const mint = await mintOfPool(data.pool);
      if (!mint) break;
      // The lifetime figure comes from the account, not the event.
      await syncPosition(new PublicKey(mint), data.position);
      await recordHistory(name, data, mint, signature, slot, at);
      break;
    }

    case "Compounded": {
      // Rewards bought more of the coin into the lock: the position and the
      // pool's totals both moved, so both are re-read from chain.
      const mint = await mintOfPool(data.pool);
      if (!mint) break;
      const key = new PublicKey(mint);
      await syncPosition(key, data.position);
      await upsertPoolFromChain(key);
      await recordHistory(name, data, mint, signature, slot, at);
      break;
    }

    case "RewardCapped":
    case "Renounced": {
      const mint = await mintOfPool(data.pool);
      if (!mint) break;
      await syncPosition(new PublicKey(mint), data.position);
      await upsertPoolFromChain(new PublicKey(mint));
      break;
    }

    case "LockedForever":
    case "Unlocked": {
      // LockedForever: weight leaves the pool (earnings forfeited). Unlocked:
      // closed only once the account is really gone; if the same index was
      // opened again in the meantime this re-syncs it instead. Either way the
      // pool is re-read too.
      const mint = await mintOfPool(data.pool);
      if (!mint) break;
      const key = new PublicKey(mint);
      await syncPosition(key, data.position);
      await upsertPoolFromChain(key);
      await recordHistory(name, data, mint, signature, slot, at);
      break;
    }

    default:
      break;
  }
}

/** The events `recordHistory` writes rows for: what the proof page lists and counts. */
const HISTORY_EVENTS: Record<string, true> = { Claimed: true, Compounded: true, LockedForever: true, Unlocked: true };

/**
 * The append-only row for a payout, compound, lock-forever or unlock. Insert
 * only — no chain reads — so a history replay can call it for events long
 * past without touching current state. Idempotent: replaying an event that
 * is already there changes nothing, except that an unlock row written before
 * `burned` was recorded gets it.
 */
async function recordHistory(name: string, data: EventPayload, mint: string, signature: string, slot: number, at: Date) {
  const owner = data.owner.toBase58();
  if (name === "Claimed") {
    await sql`
      INSERT INTO claim_events (signature, mint, owner, amount, slot, at)
      VALUES (${signature}, ${mint}, ${owner}, ${asBigint(data.amount).toString()}::NUMERIC, ${slot}, ${at})
      ON CONFLICT DO NOTHING
    `;
  } else if (name === "Compounded") {
    await sql`
      INSERT INTO compound_events (signature, mint, position, owner, quote_in, tokens_out,
                                   new_amount, new_weight, slot, at)
      VALUES (${signature}, ${mint}, ${data.position.toBase58()}, ${owner},
              ${asBigint(data.quote_in).toString()}::NUMERIC,
              ${asBigint(data.tokens_out).toString()}::NUMERIC,
              ${asBigint(data.new_amount).toString()}::NUMERIC,
              ${asBigint(data.new_weight).toString()}::NUMERIC,
              ${slot}, ${at})
      ON CONFLICT DO NOTHING
    `;
  } else if (name === "LockedForever") {
    await sql`
      INSERT INTO lock_events (signature, mint, owner, kind, amount, lock_end, slot, at)
      VALUES (${signature}, ${mint}, ${owner}, 'LockedForever', ${asBigint(data.amount).toString()}::NUMERIC,
              ${data.lock_end ? asDate(data.lock_end) : null}, ${slot}, ${at})
      ON CONFLICT DO NOTHING
    `;
  } else if (name === "Unlocked") {
    await sql`
      INSERT INTO lock_events (signature, mint, owner, kind, amount, burned, slot, at)
      VALUES (${signature}, ${mint}, ${owner}, ${data.early ? "EarlyUnlocked" : "Unlocked"},
              ${asBigint(data.returned).toString()}::NUMERIC, ${asBigint(data.burned).toString()}::NUMERIC, ${slot}, ${at})
      ON CONFLICT (signature, mint, owner, kind, amount) DO UPDATE SET burned = EXCLUDED.burned
    `;
  }
}

/**
 * Payout history from the program's first transaction: every `Claimed`,
 * `Compounded`, `LockedForever` and `Unlocked` the read model may have
 * missed because it started after them (a fresh read model mirrors current
 * state and begins its history at that moment). Insert-only through
 * `recordHistory`, so it never disturbs live state, and recorded in
 * `backfills` once it has walked the whole history. A failure is retried on
 * the next start.
 */
const PAYOUT_HISTORY = "payout-history-v1";

async function backfillPayoutHistory() {
  const [done] = await sql`SELECT 1 FROM backfills WHERE name = ${PAYOUT_HISTORY}`;
  if (done) return;
  let before: string | undefined;
  let transactions = 0;
  let events = 0;
  for (;;) {
    const batch = await connection.getSignaturesForAddress(IMAGINE_PROGRAM_ID, { before, limit: 1000 }, "confirmed");
    for (const entry of batch) {
      if (entry.err !== null) continue;
      const tx = await connection.getTransaction(entry.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const logs = tx?.meta?.logMessages;
      if (!tx || !logs) throw new Error(`transaction ${entry.signature} is not readable`);
      transactions += 1;
      for (const { name, data } of parseImagineEvents(logs)) {
        if (!HISTORY_EVENTS[name]) continue;
        const mint = await mintOfPool(data.pool);
        if (!mint) continue;
        await recordHistory(name, data, mint, entry.signature, entry.slot, txTime(tx.blockTime));
        events += 1;
      }
    }
    if (batch.length < 1000) break;
    before = batch[batch.length - 1].signature;
  }
  await sql`INSERT INTO backfills (name) VALUES (${PAYOUT_HISTORY}) ON CONFLICT DO NOTHING`;
  log.info("payout history replayed", { transactions, events });
}

/**
 * Mirror one position account into the read model. Only an account IMAGINE
 * owns, at the address its own contents derive to, in the pool for `mint`, is
 * written; a missing account closes the row.
 */
async function syncPosition(mint: PublicKey, address: PublicKey) {
  const info = await connection.getAccountInfo(address);
  if (!info) {
    await sql`
      UPDATE positions SET closed = TRUE, updated_at = NOW()
      WHERE address = ${address.toBase58()} AND mint = ${mint.toBase58()}
    `;
    return;
  }
  if (!info.owner.equals(IMAGINE_PROGRAM_ID)) return;
  const position = decodePosition(info.data);
  if (!position.pool.equals(poolPda(mint)) || !address.equals(positionPda(mint, position.owner, position.index))) {
    return;
  }
  await sql`
    INSERT INTO positions (address, mint, owner, idx, amount, weight, multiplier_bps,
                           lock_start, lock_end, claimed, closed, updated_at)
    VALUES (${address.toBase58()}, ${mint.toBase58()}, ${position.owner.toBase58()}, ${position.index},
            ${position.amount.toString()}::NUMERIC, ${position.weight.toString()}::NUMERIC,
            ${position.multiplierBps}, ${new Date(position.lockStart * 1000)},
            ${new Date(position.lockEnd * 1000)}, ${position.claimed.toString()}::NUMERIC,
            FALSE, NOW())
    ON CONFLICT (address) DO UPDATE SET
      amount = EXCLUDED.amount, weight = EXCLUDED.weight,
      multiplier_bps = EXCLUDED.multiplier_bps, lock_start = EXCLUDED.lock_start,
      lock_end = EXCLUDED.lock_end, claimed = EXCLUDED.claimed,
      closed = FALSE, updated_at = NOW()
  `;
}

/**
 * The IMAGINE pool for `mint`, or null when there is none: the account at the
 * pool PDA must be owned by the IMAGINE program, decode as a Pool for this
 * mint, and point at the coin's canonical LaunchLab pool. A coin launched on
 * LaunchLab directly — under the IMAGINE platform or any other — fails the
 * first check, so it never reaches the read model and never appears on the
 * site.
 */
export async function readImaginePool(mint: PublicKey) {
  const info = await connection.getAccountInfo(poolPda(mint));
  if (!info || !info.owner.equals(IMAGINE_PROGRAM_ID)) return null;
  let pool;
  try {
    pool = decodePool(info.data);
  } catch {
    return null;
  }
  if (!pool.mint.equals(mint) || !pool.launchlabPool.equals(launchLabPoolPda(mint, pool.quoteMint))) return null;
  return pool;
}

/**
 * Re-read a pool from chain and overwrite the row. Always safe to call.
 *
 * Reads the pool *projected to now* — stream released, unsynced vault inflow
 * folded in — rather than the raw account, so a pool nobody has touched for
 * hours still shows what it has actually paid out. A pool that is launched
 * but not yet founded (its founding lock has not landed) is not listed, and
 * neither is any mint without a genuine IMAGINE pool (`readImaginePool`).
 */
export async function upsertPoolFromChain(mint: PublicKey) {
  const [pool, raw] = await Promise.all([imagine.fetchProjectedPool(mint), readImaginePool(mint)]);
  if (!pool || !raw?.founded) return;

  const [market, supply, quote] = await Promise.all([
    readMarket(mint, raw.quoteMint),
    connection.getTokenSupply(mint).catch(() => null),
    quoteDisplay(raw.quoteMint.toBase58()),
  ]);
  const decimals = supply?.value.decimals ?? 6;
  const totalSupply = supply ? BigInt(supply.value.amount) : null;
  const marketCap = market && totalSupply !== null ? marketCapQuote(market, totalSupply) : null;
  const rewardTokenAccount = raw.quoteMint.equals(NATIVE_MINT) ? null : raw.rewardTokenAccount.toBase58();

  await sql`
    INSERT INTO pools (
      mint, pool, creator, reward_vault, reward_token_account, token_vault, token_program,
      launchlab_pool, quote_mint, quote_token_program, quote_symbol, quote_name, quote_decimals,
      quote_category, quote_logo_url,
      treasury_share_bps, creator_share_bps, min_lock_secs, max_lock_secs,
      max_multiplier_bps, early_unlock_penalty_bps, total_locked, total_weight,
      lifetime_inflow, lifetime_rewards, lifetime_burned, open_positions,
      token_supply, token_decimals, price_quote, market_cap_quote,
      curve_progress, graduated, created_at, updated_at
    ) VALUES (
      ${mint.toBase58()}, ${poolPda(mint).toBase58()}, ${pool.creator.toBase58()},
      ${pool.rewardVault.toBase58()}, ${rewardTokenAccount}, ${pool.tokenVault.toBase58()},
      ${pool.tokenProgram.toBase58()}, ${raw.launchlabPool.toBase58()},
      ${quote.mint}, ${quote.tokenProgram}, ${quote.symbol}, ${quote.name}, ${quote.decimals},
      ${quote.category}, ${quote.logoUrl},
      ${pool.terms.treasuryShareBps}, ${pool.terms.creatorShareBps},
      ${pool.terms.minLockSecs}, ${pool.terms.maxLockSecs},
      ${pool.terms.maxMultiplierBps}, ${pool.terms.earlyUnlockPenaltyBps},
      ${pool.totalLocked.toString()}::NUMERIC, ${pool.totalWeight.toString()}::NUMERIC,
      ${pool.lifetimeInflow.toString()}::NUMERIC, ${pool.lifetimeRewards.toString()}::NUMERIC,
      ${pool.lifetimeBurned.toString()}::NUMERIC, ${Number(pool.openPositions)},
      ${totalSupply !== null ? totalSupply.toString() : null}::NUMERIC, ${decimals},
      ${market?.priceQuote ?? null}, ${marketCap !== null ? marketCap.toString() : null}::NUMERIC,
      ${market?.progress ?? null}, ${market?.status === "graduated"},
      ${new Date(pool.createdAt * 1000)}, NOW()
    )
    ON CONFLICT (mint) DO UPDATE SET
      total_locked = EXCLUDED.total_locked,
      total_weight = EXCLUDED.total_weight,
      lifetime_inflow = EXCLUDED.lifetime_inflow,
      lifetime_rewards = EXCLUDED.lifetime_rewards,
      lifetime_burned = EXCLUDED.lifetime_burned,
      open_positions = EXCLUDED.open_positions,
      token_supply = EXCLUDED.token_supply,
      price_quote = EXCLUDED.price_quote,
      market_cap_quote = EXCLUDED.market_cap_quote,
      curve_progress = EXCLUDED.curve_progress,
      graduated = EXCLUDED.graduated,
      quote_symbol = EXCLUDED.quote_symbol,
      quote_name = EXCLUDED.quote_name,
      quote_category = EXCLUDED.quote_category,
      quote_logo_url = EXCLUDED.quote_logo_url,
      updated_at = NOW()
  `;
}

/** The hosted document's shape (routes/metadata.ts writes it; validated anyway). */
const HostedMetadata = z
  .object({
    description: z.string().max(2_000).optional(),
    twitter: z.string().max(300).optional(),
    telegram: z.string().max(300).optional(),
    website: z.string().max(300).optional(),
  })
  .catchall(z.unknown());

/**
 * Pull the coin's name, symbol, image and socials into the read model.
 *
 * LaunchLab's `initialize_with_token_2022` writes name/symbol/uri into the
 * Token-2022 metadata extension on the mint itself, so the on-chain part is
 * one account read. Every IMAGINE coin's URI is a document hosted here (a
 * launch refuses any other), so the rest is read from our own table rather
 * than fetched over the network.
 */
export async function backfillMetadata(mint: string) {
  const [pool] = await sql`SELECT 1 FROM pools WHERE mint = ${mint}`;
  if (!pool) return;
  let onChain;
  try {
    onChain = await getTokenMetadata(connection, new PublicKey(mint), "confirmed", TOKEN_2022_PROGRAM_ID);
  } catch {
    return;
  }
  if (!onChain) return;
  const [files] = onChain.uri === metadataUri(mint) ? await sql`SELECT metadata FROM coin_files WHERE mint = ${mint}` : [];
  const parsed = files ? HostedMetadata.safeParse(files.metadata) : null;
  const doc = parsed?.success ? parsed.data : {};
  await sql`
    UPDATE pools SET
      name = ${onChain.name}, symbol = ${onChain.symbol}, metadata_uri = ${onChain.uri},
      image_url = ${files ? imageUrl(mint) : null},
      description = ${doc.description ?? null},
      twitter = ${doc.twitter ?? null}, telegram = ${doc.telegram ?? null},
      website = ${doc.website ?? null}, updated_at = NOW()
    WHERE mint = ${mint}
  `;
}

/** The runtime's marker when a transaction's logs overran the cap and were cut. */
export function isTruncated(logs: readonly string[]): boolean {
  return logs.some((line) => line === "Log truncated");
}

/** Every account a transaction touched, lookup-table entries included, in balance order. */
export function transactionAccounts(tx: VersionedTransactionResponse): PublicKey[] {
  const loaded = tx.meta?.loadedAddresses;
  return [...tx.transaction.message.staticAccountKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
}

/** Accounts the transaction created: no lamports before it, some after. */
export function createdAccounts(tx: VersionedTransactionResponse): Set<string> {
  const pre = tx.meta?.preBalances ?? [];
  const post = tx.meta?.postBalances ?? [];
  return new Set(
    transactionAccounts(tx).flatMap((key, i) => ((pre[i] ?? 0) === 0 && (post[i] ?? 0) > 0 ? [key.toBase58()] : [])),
  );
}

/**
 * Bring every IMAGINE pool and position a transaction touched in line with
 * the chain. Used when its logs were truncated: events past the cut are
 * gone (a launch's `PoolCreated` and founding `Locked`, or the tail of a large
 * trade-and-lock), but the accounts they changed are still listed. A position
 * this transaction opened gets the `Locked` row its lost event would have
 * written, so the founding lock still shows in the coin's activity.
 */
async function reconcileTouched(tx: VersionedTransactionResponse, at: Date) {
  const signature = tx.transaction.signatures[0]!;
  const created = createdAccounts(tx);
  const unique = [...new Map(transactionAccounts(tx).map((key) => [key.toBase58(), key])).values()];
  const mints = new Set<string>();
  const positions = new Map<string, { address: PublicKey; position: PositionAccount }>();
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(batch);
    infos.forEach((info, j) => {
      const key = batch[j]!;
      if (!info || !info.owner.equals(IMAGINE_PROGRAM_ID) || info.data.length < 8) return;
      const discriminator = info.data.subarray(0, 8);
      try {
        if (discriminator.equals(DISCRIMINATOR.pool)) {
          const pool = decodePool(info.data);
          if (poolPda(pool.mint).equals(key)) mints.add(pool.mint.toBase58());
        } else if (discriminator.equals(DISCRIMINATOR.position)) {
          positions.set(key.toBase58(), { address: key, position: decodePosition(info.data) });
        }
      } catch {
        // Not a layout this indexer knows; nothing to mirror.
      }
    });
  }
  for (const mint of mints) {
    const [known] = await sql`SELECT 1 FROM pools WHERE mint = ${mint}`;
    if (known) await upsertPoolFromChain(new PublicKey(mint));
    else await indexNewPool(mint);
  }
  for (const [key, { address, position }] of positions) {
    const mint = await mintOfPool(position.pool);
    if (!mint) continue;
    await syncPosition(new PublicKey(mint), address);
    // Opened by this transaction: the account did not exist before it.
    if (created.has(key)) {
      await sql`
        INSERT INTO lock_events (signature, mint, owner, kind, amount, weight, lock_end, slot, at)
        VALUES (${signature}, ${mint}, ${position.owner.toBase58()}, 'Locked',
                ${position.amount.toString()}::NUMERIC, ${position.weight.toString()}::NUMERIC,
                ${new Date(position.lockEnd * 1000)}, ${tx.slot}, ${at})
        ON CONFLICT DO NOTHING
      `;
    }
  }
  // Positions the transaction closed no longer exist to be read; close their rows.
  const open = await sql`
    SELECT address, mint FROM positions WHERE NOT closed AND address = ANY(${unique.map((key) => key.toBase58())})
  `;
  for (const row of open) {
    if (!positions.has(row.address as string)) {
      await syncPosition(new PublicKey(row.mint as string), new PublicKey(row.address as string));
    }
  }
}

/**
 * Apply one transaction's IMAGINE events, then — if its logs were cut —
 * mirror the accounts it touched. Throws when it could not be fully applied,
 * so the caller leaves it for the catch-up pass to retry.
 */
async function applyTransaction(
  signature: string,
  slot: number,
  logs: readonly string[],
  at: Date,
  fetched: VersionedTransactionResponse | null,
) {
  for (const event of parseImagineEvents([...logs])) {
    await handleEvent(event.name, event.data, signature, slot, at);
  }
  if (isTruncated(logs)) {
    let tx = fetched;
    // A notification can beat the transaction into the RPC's history by a moment.
    for (let attempt = 0; !tx && attempt < 3; attempt++) {
      if (attempt > 0) await sleep(500);
      tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    }
    if (!tx) throw new Error("logs truncated and the transaction is not readable yet");
    log.info("logs truncated; mirroring touched accounts", { signature });
    await reconcileTouched(tx, at);
  }
  handled.add(signature);
  if (!lastEventAt || at > lastEventAt) lastEventAt = at;
}

function onLogs(logs: Logs, context: Context) {
  socketHeardAt = Date.now();
  if (logs.err) return;
  const signature = logs.signature;
  if (handled.has(signature) || queued.has(signature)) return;
  queued.add(signature);
  // The notification carries no block time; it arrives within moments of
  // confirmation, so the receipt time stands in for it.
  const at = txTime(null);
  const accepted = enqueue(async () => {
    try {
      await applyTransaction(signature, context.slot, logs.logs, at, null);
    } catch (error) {
      log.error("event handling failed; catch-up will retry", { signature, err: error });
    } finally {
      queued.delete(signature);
    }
  });
  if (!accepted) queued.delete(signature);
}

/**
 * The websocket. web3.js reconnects a socket that closes and resubscribes on
 * its own; a socket that stays open but stops delivering (a half-open TCP
 * connection, a provider-side stall) it never notices. So the subscription
 * also listens to slots — a notification every ~400ms on a healthy socket —
 * and the watchdog replaces the connection outright once nothing has arrived
 * for `SOCKET_SILENCE_MS`. Whatever the socket missed, catch-up replays.
 */
const SOCKET_SILENCE_MS = 60_000;
/** Fresh connections are made at most this often, so a provider outage does not pile them up. */
const RESUBSCRIBE_SPACING_MS = 5 * 60_000;
let socket: { connection: Connection; logs: number; slots: number } | null = null;
let socketHeardAt = 0;
let socketState: "connecting" | "live" | "silent" | "stopped" = "connecting";
let resubscribedAt = 0;

function subscribe() {
  const subscriber = new Connection(env.rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: env.wsUrl || undefined,
    fetch: timedFetch,
  });
  socketHeardAt = Date.now();
  socketState = "connecting";
  const logs = subscriber.onLogs(IMAGINE_PROGRAM_ID, onLogs, "confirmed");
  const slots = subscriber.onSlotChange(() => {
    socketHeardAt = Date.now();
    if (socketState !== "live") {
      socketState = "live";
      log.info("websocket live", { program: IMAGINE_PROGRAM_ID });
    }
  });
  socket = { connection: subscriber, logs, slots };
}

/** Drop the listeners; with none left web3.js closes the socket itself. */
function unsubscribe() {
  const old = socket;
  socket = null;
  if (!old) return;
  // Not awaited: on a stalled socket the unsubscribe call may never be answered.
  void old.connection.removeOnLogsListener(old.logs).catch(() => {});
  void old.connection.removeSlotChangeListener(old.slots).catch(() => {});
}

function watchdog() {
  const silentMs = Date.now() - socketHeardAt;
  if (silentMs < SOCKET_SILENCE_MS) return;
  if (socketState !== "silent") {
    socketState = "silent";
    log.warn("websocket silent", { silentMs });
  }
  if (Date.now() - resubscribedAt < RESUBSCRIBE_SPACING_MS) return;
  resubscribedAt = Date.now();
  log.warn("resubscribing on a fresh websocket", { silentMs });
  unsubscribe();
  subscribe();
  void catchUp();
}

/**
 * Re-read every known pool from chain on a slow cycle.
 *
 * This is the safety net: if a websocket frame is lost, prices, weights and
 * counters still converge to what the chain says within one pass.
 */
async function reconcile() {
  const rows = await sql`SELECT mint FROM pools ORDER BY updated_at ASC LIMIT 60`;
  for (const row of rows) {
    try {
      await upsertPoolFromChain(new PublicKey(row.mint as string));
    } catch (error) {
      log.error("reconcile failed", { mint: row.mint, err: error });
    }
  }
}

/**
 * Unlist any row that is not a founded IMAGINE pool at its own PDA. Rows only
 * enter through `upsertPoolFromChain`, which refuses those; this sweeps out
 * anything written before that check or by hand. A missing account is re-read
 * once before it counts, so one bad RPC answer cannot unlist a live coin.
 */
async function hideForeignPools() {
  const rows = await sql`SELECT mint, pool FROM pools WHERE NOT hidden`;
  const foreign: string[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const read = () => connection.getMultipleAccountsInfo(batch.map((row) => new PublicKey(row.pool as string)));
    const first = await read();
    const second = first.some((info) => info === null) ? await read() : first;
    batch.forEach((row, j) => {
      const info = first[j] ?? second[j];
      const mint = new PublicKey(row.mint as string);
      let ok = false;
      if (info?.owner.equals(IMAGINE_PROGRAM_ID) && poolPda(mint).toBase58() === row.pool) {
        try {
          const pool = decodePool(info.data);
          ok = pool.founded && pool.mint.equals(mint) && pool.launchlabPool.equals(launchLabPoolPda(mint, pool.quoteMint));
        } catch {
          ok = false;
        }
      }
      if (!ok) foreign.push(row.mint as string);
    });
  }
  if (foreign.length === 0) return;
  await sql`UPDATE pools SET hidden = TRUE, updated_at = NOW() WHERE mint = ANY(${foreign})`;
  log.warn("unlisted rows without a founded IMAGINE pool", { mints: foreign });
}

/** A founded pool's synced-inflow counters as discovery read them. */
interface PoolCounters {
  inflow: bigint;
  /** Everything that has joined lockers' streams: released plus still queued. */
  toLockers: bigint;
  /** When rewards last streamed (else creation): where reconstructed history is charted. */
  at: Date;
}

/** Discover pools founded while the indexer was offline; returns their counters. */
async function discover(): Promise<Map<string, PoolCounters>> {
  const accounts = await connection.getProgramAccounts(IMAGINE_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(DISCRIMINATOR.pool) } }],
  });
  const counters = new Map<string, PoolCounters>();
  for (const { pubkey, account } of accounts) {
    let pool;
    try {
      pool = decodePool(account.data);
    } catch (error) {
      log.error("undecodable pool account", { address: pubkey, err: error });
      continue;
    }
    if (!pool.founded || !poolPda(pool.mint).equals(pubkey)) continue;
    counters.set(pool.mint.toBase58(), {
      inflow: pool.lifetimeInflow,
      toLockers: pool.lifetimeRewards + pool.undistributed,
      at: new Date((pool.lastStreamAt || pool.createdAt) * 1000),
    });
    try {
      await upsertPoolFromChain(pool.mint);
      // Positions opened while the socket was down feed the diamond board and
      // the activity joins; mirror every live one once at startup.
      for (const position of await imagine.fetchPositionsByPool(pool.mint)) {
        await syncPosition(pool.mint, position.address);
      }
    } catch (error) {
      log.error("discovering pool failed", { mint: pool.mint, err: error });
    }
  }
  await hideForeignPools();
  // Names and images are missing for anything created while the socket was
  // down, or before this read model existed. One mint read each, once.
  const unnamed = await sql`SELECT mint FROM pools WHERE name IS NULL`;
  for (const row of unnamed) {
    await backfillMetadata(row.mint as string).catch((error: unknown) =>
      log.error("metadata backfill failed", { mint: row.mint, err: error }),
    );
  }
  log.info("discovery done", { pools: accounts.length });
  return counters;
}

/**
 * Record synced inflow the read model has no transaction for.
 *
 * A fresh database, an outage longer than catch-up's window, a transaction
 * given up on, or a validator whose history was reset all leave a pool's
 * on-chain lifetime inflow ahead of its `RewardsSynced` rows — and its reward
 * chart empty while "paid to lockers" is not. Runs after the startup catch-up
 * reached the chain head, against counters read *before* it, so a sync that
 * landed meanwhile is already a real row and is never counted twice. The gap
 * becomes one `RECONSTRUCTED_KIND` row at the pool's last stream time,
 * idempotent per counter value.
 */
async function fillHistoryGaps(counters: Map<string, PoolCounters>) {
  if (counters.size === 0) return;
  const recorded = await sql`
    SELECT f.mint, COALESCE(SUM(f.amount), 0)::TEXT AS inflow, COALESCE(SUM(f.to_lockers), 0)::TEXT AS to_lockers
    FROM fee_events f JOIN pools p ON p.mint = f.mint
    WHERE f.kind IN (${SYNCED_KIND}, ${RECONSTRUCTED_KIND}) AND f.mint = ANY(${[...counters.keys()]})
    GROUP BY f.mint
  `;
  const byMint = new Map(recorded.map((row) => [row.mint as string, row]));
  const listed = new Set((await sql`SELECT mint FROM pools WHERE mint = ANY(${[...counters.keys()]})`).map((row) => row.mint as string));
  for (const [mint, chain] of counters) {
    if (!listed.has(mint)) continue;
    const row = byMint.get(mint);
    const gap = chain.inflow - BigInt((row?.inflow as string | undefined) ?? "0");
    if (gap <= 0n) continue;
    const lockersGap = chain.toLockers - BigInt((row?.to_lockers as string | undefined) ?? "0");
    await sql`
      INSERT INTO fee_events (signature, mint, kind, amount, to_lockers, slot, at)
      VALUES (${`history-gap:${mint}:${chain.inflow}`}, ${mint}, ${RECONSTRUCTED_KIND}, ${gap.toString()}::NUMERIC,
              ${(lockersGap > 0n ? lockersGap : 0n).toString()}::NUMERIC, 0, ${chain.at})
      ON CONFLICT DO NOTHING
    `;
    log.warn("reconstructed reward history with no transaction", { mint, inflow: gap, toLockers: lockersGap, at: chain.at });
  }
}

/**
 * Replay every program transaction after the cursor that has not been
 * handled yet, oldest first, moving the cursor only over contiguous history:
 * a transaction that fails (or is not readable yet) stops the pass with the
 * cursor just before it, and is retried next pass — `MAX_ATTEMPTS` times,
 * then logged and skipped so one poison transaction cannot wedge the indexer.
 *
 * Runs every `CATCH_UP_MS`, right after a resubscribe, and at startup. The
 * websocket is only for latency; this is what makes history complete.
 * Bounded to `CATCH_UP_PAGES` pages: after a very long outage the newest
 * transactions are replayed and the gap before them is logged — pools still
 * converge through `reconcile`.
 */
const CATCH_UP_MS = 30_000;
const CATCH_UP_PAGES = 5;
const MAX_ATTEMPTS = 3;
const attempts = new Map<string, number>();
let caughtUpAt: Date | null = null;
let cursorSlot: number | null = null;
let catchingUp: Promise<void> | null = null;

function catchUp(): Promise<void> {
  catchingUp ??= catchUpPass()
    .catch((error: unknown) => log.error("catch-up failed", { err: error }))
    .finally(() => {
      catchingUp = null;
    });
  return catchingUp;
}

async function setCursor(signature: string, slot: number) {
  await sql`UPDATE indexer_cursor SET slot = ${slot}, signature = ${signature}, updated_at = NOW() WHERE id = 1`;
  cursorSlot = slot;
}

async function catchUpPass() {
  const startedAt = new Date();
  const [cursor] = await sql`SELECT signature, slot FROM indexer_cursor WHERE id = 1`;
  const until = (cursor?.signature as string | null) ?? undefined;
  cursorSlot = cursor ? Number(cursor.slot) : null;
  if (!until) {
    // A fresh read model: `discover` mirrored current state, so history starts now.
    const [newest] = await connection.getSignaturesForAddress(IMAGINE_PROGRAM_ID, { limit: 1 }, "confirmed");
    if (newest) await setCursor(newest.signature, newest.slot);
    caughtUpAt = startedAt;
    return;
  }

  const pending: Array<{ signature: string; slot: number; failed: boolean }> = [];
  let before: string | undefined;
  let complete = false;
  for (let page = 0; page < CATCH_UP_PAGES; page++) {
    const batch = await connection.getSignaturesForAddress(IMAGINE_PROGRAM_ID, { until, before, limit: 1000 }, "confirmed");
    for (const entry of batch) pending.push({ signature: entry.signature, slot: entry.slot, failed: entry.err !== null });
    if (batch.length < 1000) {
      complete = true;
      break;
    }
    before = batch[batch.length - 1]?.signature;
  }
  if (!complete) {
    log.warn("catch-up window exceeded; replaying the newest transactions only", {
      since: until,
      replaying: pending.length,
    });
  }

  let replayed = 0;
  for (const entry of pending.reverse()) {
    const { signature, slot } = entry;
    if (!entry.failed && !handled.has(signature)) {
      // The socket is already on it; let it finish rather than do it twice.
      if (queued.has(signature)) return;
      try {
        const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        const logs = tx?.meta?.logMessages;
        if (!tx || !logs) throw new Error("transaction not readable yet");
        await applyTransaction(signature, slot, logs, txTime(tx.blockTime), tx);
        replayed += 1;
      } catch (error) {
        const attempt = (attempts.get(signature) ?? 0) + 1;
        if (attempt < MAX_ATTEMPTS) {
          attempts.set(signature, attempt);
          log.warn("transaction not indexed; retrying next pass", { signature, attempt, err: error });
          return;
        }
        log.error("giving up on transaction after repeated failures", { signature, attempts: attempt, err: error });
      }
    }
    attempts.delete(signature);
    await setCursor(signature, slot);
  }
  if (replayed > 0) log.info("caught up", { replayed, cursorSlot });
  caughtUpAt = startedAt;
}

/** What /health reports for this process; also its heartbeat. */
async function publishStatus() {
  await writeStatus("indexer", {
    caughtUpAt: caughtUpAt?.toISOString() ?? null,
    lastEventAt: lastEventAt?.toISOString() ?? null,
    cursorSlot,
    websocket: socketState,
    socketSilentMs: Date.now() - socketHeardAt,
    queued: queue.length,
  });
}

async function main() {
  const timers: NodeJS.Timeout[] = [];
  let keeper: KeeperHandle | null = null;
  let stopping = false;

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    for (const timer of timers) clearInterval(timer);
    unsubscribe();
    socketState = "stopped";
    // Queued work is dropped, not lost: the cursor never passed it, so the
    // next process replays it. Work already running is let finish.
    queue.length = 0;
    const GRACE_MS = 20_000;
    await Promise.race([
      Promise.allSettled([keeper?.stop(GRACE_MS), ...running, catchingUp]),
      sleep(GRACE_MS, undefined, { ref: false }),
    ]);
    await publishStatus().catch(() => {});
    await sql.end({ timeout: 5 });
    log.info("stopped", { signal });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  const discoveredAt = new Date();
  const counters = await discover().catch((error: unknown) => {
    log.error("discovery failed", { err: error });
    return null;
  });
  if (stopping) return;
  subscribe();
  await catchUp();
  // Only once a catch-up that began after the counters were read has reached
  // the chain head: every sync since then is a real row by now.
  if (counters && caughtUpAt && caughtUpAt >= discoveredAt) {
    await fillHistoryGaps(counters).catch((error: unknown) => log.error("history gap fill failed", { err: error }));
  }
  // In the background: the live feed must not wait on a walk through history.
  void backfillPayoutHistory().catch((error: unknown) => log.error("payout history replay failed", { err: error }));
  await publishStatus().catch((error: unknown) => log.error("status write failed", { err: error }));
  if (stopping) return;

  timers.push(
    setInterval(() => void catchUp(), CATCH_UP_MS),
    setInterval(() => void reconcile().catch((error: unknown) => log.error("reconcile pass failed", { err: error })), 30_000),
    setInterval(watchdog, 15_000),
    setInterval(
      () => void publishStatus().catch((error: unknown) => log.error("status write failed", { err: error })),
      30_000,
    ),
  );
  keeper = startKeeper();
  log.info("indexer running", { program: IMAGINE_PROGRAM_ID });
}

// `process.argv[1]` is a native path; it only matches `import.meta.url` once
// converted to a file URL (a Windows path otherwise never compares equal).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { handleEvent, parseImagineEvents, reconcile };
