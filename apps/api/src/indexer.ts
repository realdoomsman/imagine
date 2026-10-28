import { pathToFileURL } from "node:url";
import { EventParser } from "@coral-xyz/anchor";
import { getTokenMetadata, NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";
import { coder, decodePool, decodePosition, DISCRIMINATOR, IMAGINE_PROGRAM_ID, poolPda, positionPda } from "@imagine/sdk";
import { sql } from "./db.ts";
import { imageUrl, metadataUri } from "./files.ts";
import { startKeeper } from "./keeper.ts";
import { quoteDisplay } from "./quotes.ts";
import { connection, imagine } from "./solana.ts";
import { marketCapQuote, readMarket } from "./stonk.ts";

/**
 * Builds the read model from program logs.
 *
 * Two loops with different jobs:
 *  - a websocket subscription that reacts to events within a slot, so the UI
 *    feels live;
 *  - a slow reconciler that re-reads pool accounts from chain, so a dropped
 *    websocket frame can never leave the database permanently wrong.
 *
 * The chain stays authoritative: every number a user acts on is read from an
 * account, not from here. Events are only accepted when IMAGINE itself
 * emitted them, and are stamped with the transaction's time, never their own.
 * Amounts are in each pool's quote base units.
 */

type EventPayload = Record<string, { toString(): string } & PublicKey & number>;

const seenSignatures = new Set<string>();

function asBigint(value: unknown): bigint {
  return BigInt((value as { toString(): string }).toString());
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
    console.error("unparseable program logs", error);
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

function enqueue(job: () => Promise<void>) {
  if (queue.length >= MAX_QUEUED) {
    console.error("indexer queue full; dropping a transaction (reconcile will converge pools)");
    return;
  }
  queue.push(job);
  drain();
}

function drain() {
  while (active < HANDLER_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    active += 1;
    void job().finally(() => {
      active -= 1;
      drain();
    });
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
        VALUES (${signature}, ${mint}, 4,
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
      await sql`
        INSERT INTO claim_events (signature, mint, owner, amount, slot, at)
        VALUES (${signature}, ${mint}, ${data.owner.toBase58()},
                ${asBigint(data.amount).toString()}::NUMERIC, ${slot}, ${at})
        ON CONFLICT DO NOTHING
      `;
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

    case "Unlocked": {
      const mint = await mintOfPool(data.pool);
      if (!mint) break;
      const key = new PublicKey(mint);
      // Closed only once the account is really gone; if the same index was
      // opened again in the meantime this re-syncs it instead.
      await syncPosition(key, data.position);
      await upsertPoolFromChain(key);
      await sql`
        INSERT INTO lock_events (signature, mint, owner, kind, amount, slot, at)
        VALUES (${signature}, ${mint}, ${data.owner.toBase58()},
                ${data.early ? "EarlyUnlocked" : "Unlocked"},
                ${asBigint(data.returned).toString()}::NUMERIC, ${slot}, ${at})
        ON CONFLICT DO NOTHING
      `;
      break;
    }

    default:
      break;
  }
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
 * Re-read a pool from chain and overwrite the row. Always safe to call.
 *
 * Reads the pool *projected to now* — stream released, unsynced vault inflow
 * folded in — rather than the raw account, so a pool nobody has touched for
 * hours still shows what it has actually paid out. A pool that is launched
 * but not yet founded (its founding lock has not landed) is not listed.
 */
export async function upsertPoolFromChain(mint: PublicKey) {
  const [pool, raw] = await Promise.all([imagine.fetchProjectedPool(mint), imagine.fetchPool(mint)]);
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

async function subscribe() {
  connection.onLogs(
    IMAGINE_PROGRAM_ID,
    (log, context) => {
      if (log.err) return;
      if (seenSignatures.has(log.signature)) return;
      seenSignatures.add(log.signature);
      if (seenSignatures.size > 5_000) {
        // Bounded memory: the set only exists to dedupe a websocket replay.
        for (const sig of [...seenSignatures].slice(0, 2_500)) {
          seenSignatures.delete(sig);
        }
      }

      // The notification carries no block time; it arrives within moments of
      // confirmation, so the receipt time stands in for it.
      const at = txTime(null);
      enqueue(async () => {
        try {
          for (const event of parseImagineEvents(log.logs)) {
            await handleEvent(event.name, event.data, log.signature, context.slot, at);
          }
          await sql`UPDATE indexer_cursor SET slot = ${context.slot},
                    signature = ${log.signature}, updated_at = NOW()
                    WHERE id = 1 AND slot <= ${context.slot}`;
        } catch (error) {
          console.error("event handling failed", log.signature, error);
        }
      });
    },
    "confirmed",
  );
  console.log("subscribed to", IMAGINE_PROGRAM_ID.toBase58());
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
      console.error("reconcile failed", row.mint, error);
    }
  }
}

/** Discover pools founded while the indexer was offline. */
async function discover() {
  const accounts = await connection.getProgramAccounts(IMAGINE_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(DISCRIMINATOR.pool) } }],
  });
  for (const { account } of accounts) {
    const pool = decodePool(account.data);
    await upsertPoolFromChain(pool.mint);
    if (!pool.founded) continue;
    // Positions opened while the socket was down feed the diamond board and
    // the activity joins; mirror every live one once at startup.
    for (const position of await imagine.fetchPositionsByPool(pool.mint)) {
      await syncPosition(pool.mint, position.address);
    }
  }
  // Names and images are missing for anything created while the socket was
  // down, or before this read model existed. One mint read each, once.
  const unnamed = await sql`SELECT mint FROM pools WHERE name IS NULL`;
  for (const row of unnamed) {
    await backfillMetadata(row.mint as string);
  }
}

/**
 * Replay every program transaction newer than the cursor.
 *
 * Pools converge on their own through `reconcile`, but history does not: a
 * lock, claim or fee that landed while the socket was down is otherwise gone
 * from the tables that feed the activity feed, the reward chart and APR.
 *
 * Signatures come newest-first and are replayed oldest-first, so a crash
 * halfway leaves the cursor behind the gap rather than past it. Bounded to a
 * few pages: after a long outage the reconciler's view is the honest one and
 * the tail of history is not worth an hour of RPC.
 */
async function backfill() {
  const [cursor] = await sql`SELECT signature FROM indexer_cursor WHERE id = 1`;
  const until = (cursor?.signature as string | null) ?? undefined;
  if (!until) return;

  const signatures: Array<{ signature: string; slot: number }> = [];
  let before: string | undefined;
  for (let page = 0; page < 5; page++) {
    const batch = await connection.getSignaturesForAddress(IMAGINE_PROGRAM_ID, { until, before, limit: 1000 }, "confirmed");
    for (const entry of batch) {
      if (!entry.err) signatures.push({ signature: entry.signature, slot: entry.slot });
    }
    if (batch.length < 1000) break;
    before = batch[batch.length - 1]?.signature;
  }
  if (signatures.length === 0) return;
  console.log(`backfilling ${signatures.length} transactions since ${until}`);

  for (const { signature, slot } of signatures.reverse()) {
    if (seenSignatures.has(signature)) continue;
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages;
    if (!logs) continue;
    seenSignatures.add(signature);
    const at = txTime(tx.blockTime);
    for (const event of parseImagineEvents(logs)) {
      await handleEvent(event.name, event.data, signature, slot, at);
    }
    await sql`UPDATE indexer_cursor SET slot = ${slot}, signature = ${signature},
              updated_at = NOW() WHERE id = 1`;
  }
}

// `process.argv[1]` is a native path; it only matches `import.meta.url` once
// converted to a file URL (a Windows path otherwise never compares equal).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await discover().catch((error) => console.error("discovery failed", error));
  await backfill().catch((error) => console.error("backfill failed", error));
  await subscribe();
  setInterval(() => void reconcile().catch(console.error), 30_000);
  startKeeper();
  console.log("indexer running");
}

export { handleEvent, parseImagineEvents, reconcile };
