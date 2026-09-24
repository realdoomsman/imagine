import { pathToFileURL } from "node:url";
import { EventParser } from "@coral-xyz/anchor";
import { getTokenMetadata, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";
import {
  bondingCurvePda,
  coder,
  curveProgress,
  curveSpotPrice,
  decodePool,
  decodePosition,
  DISCRIMINATOR,
  poolPda,
  positionPda,
  VISE_PROGRAM_ID,
} from "@vise/sdk";
import { sql } from "./db.ts";
import { fetchCurve, onlinePump } from "./pump.ts";
import { connection, vise } from "./solana.ts";
import { startKeeper } from "./keeper.ts";

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
 * account, not from here. Events are only accepted when VISE itself emitted
 * them, and are stamped with the transaction's time, never their own.
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
 * yields `Program data:` lines written while VISE is the executing frame. A
 * `sol_log_data` from another program, or a Memo that happens to contain an
 * encoded event, in the same transaction never gets through.
 */
const eventParser = new EventParser(VISE_PROGRAM_ID, coder);

function parseViseEvents(logs: string[]): Array<{ name: string; data: EventPayload }> {
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
    await upsertPoolFromChain(new PublicKey(mint));
    const [row] = await sql`SELECT name FROM pools WHERE mint = ${mint}`;
    if (row && row.name === null) await backfillMetadata(mint);
  })().finally(() => poolWork.delete(mint));
  poolWork.set(mint, work);
  return work;
}

async function handleEvent(
  name: string,
  data: EventPayload,
  signature: string,
  slot: number,
  at: Date,
) {
  switch (name) {
    case "PoolCreated": {
      await indexNewPool(data.mint.toBase58());
      break;
    }

    case "RewardsSynced": {
      const pool = data.pool.toBase58();
      const [row] = await sql`SELECT mint FROM pools WHERE pool = ${pool}`;
      if (!row) break;
      // `to_lockers` is what joined the stream, not what has been paid out, so
      // adding it to lifetime_rewards here would run ahead of the chain. Read
      // the projected pool instead: one RPC, and every counter is exact.
      await upsertPoolFromChain(new PublicKey(row.mint as string));
      await sql`
        INSERT INTO fee_events (signature, mint, kind, amount, to_lockers, slot, at)
        VALUES (${signature}, ${row.mint as string}, 4,
                ${asBigint(data.inflow).toString()}::BIGINT,
                ${asBigint(data.to_lockers).toString()}::BIGINT,
                ${slot}, ${at})
        ON CONFLICT DO NOTHING
      `;
      break;
    }

    case "FeeDeposited": {
      const pool = data.pool.toBase58();
      const [row] = await sql`SELECT mint FROM pools WHERE pool = ${pool}`;
      if (!row) break;
      await sql`
        INSERT INTO fee_events (signature, mint, kind, payer, amount, slot, at)
        VALUES (${signature}, ${row.mint as string}, ${Number(data.kind)},
                ${data.payer.toBase58()}, ${asBigint(data.amount).toString()}::BIGINT,
                ${slot}, ${at})
        ON CONFLICT DO NOTHING
      `;
      break;
    }

    case "Locked":
    case "PositionIncreased":
    case "PositionExtended": {
      const pool = data.pool.toBase58();
      const [row] = await sql`SELECT mint FROM pools WHERE pool = ${pool}`;
      if (!row) break;
      const mint = row.mint as string;
      await syncPosition(new PublicKey(mint), data.position);
      await sql`
        INSERT INTO lock_events (signature, mint, owner, kind, amount, weight, lock_end, slot, at)
        VALUES (${signature}, ${mint}, ${data.owner.toBase58()}, ${name},
                ${asBigint(data.amount ?? data.added ?? 0).toString()}::NUMERIC,
                ${asBigint(data.weight ?? 0).toString()}::NUMERIC,
                ${data.lock_end ? asDate(data.lock_end) : null},
                ${slot}, ${at})
        ON CONFLICT DO NOTHING
      `;
      break;
    }

    case "Claimed": {
      const pool = data.pool.toBase58();
      const [row] = await sql`SELECT mint FROM pools WHERE pool = ${pool}`;
      if (!row) break;
      // The lifetime figure comes from the account, not the event.
      await syncPosition(new PublicKey(row.mint as string), data.position);
      await sql`
        INSERT INTO claim_events (signature, mint, owner, amount, slot, at)
        VALUES (${signature}, ${row.mint as string}, ${data.owner.toBase58()},
                ${asBigint(data.amount).toString()}::BIGINT, ${slot}, ${at})
        ON CONFLICT DO NOTHING
      `;
      break;
    }

    case "Unlocked": {
      const pool = data.pool.toBase58();
      const [row] = await sql`SELECT mint FROM pools WHERE pool = ${pool}`;
      if (!row) break;
      const mint = new PublicKey(row.mint as string);
      // Closed only once the account is really gone; if the same index was
      // opened again in the meantime this re-syncs it instead.
      await syncPosition(mint, data.position);
      await upsertPoolFromChain(mint);
      await sql`
        INSERT INTO lock_events (signature, mint, owner, kind, amount, slot, at)
        VALUES (${signature}, ${row.mint as string}, ${data.owner.toBase58()},
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
 * Mirror one position account into the read model. Only an account VISE owns,
 * at the address its own contents derive to, in the pool for `mint`, is
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
  if (!info.owner.equals(VISE_PROGRAM_ID)) return;
  const position = decodePosition(info.data);
  if (
    !position.pool.equals(poolPda(mint)) ||
    !address.equals(positionPda(mint, position.owner, position.index))
  ) {
    return;
  }
  await sql`
    INSERT INTO positions (address, mint, owner, idx, amount, weight, multiplier_bps,
                           lock_start, lock_end, claimed, closed, updated_at)
    VALUES (${address.toBase58()}, ${mint.toBase58()}, ${position.owner.toBase58()}, ${position.index},
            ${position.amount.toString()}::NUMERIC, ${position.weight.toString()}::NUMERIC,
            ${position.multiplierBps}, ${new Date(position.lockStart * 1000)},
            ${new Date(position.lockEnd * 1000)}, ${position.claimed.toString()}::BIGINT,
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
 * hours still shows what it has actually paid out.
 */
export async function upsertPoolFromChain(mint: PublicKey) {
  const pool = await vise.fetchProjectedPool(mint);
  if (!pool) return;

  const [curve, supply, global] = await Promise.all([
    fetchCurve(mint),
    connection.getTokenSupply(mint).catch(() => null),
    onlinePump.fetchGlobal(),
  ]);
  const price = curve ? curveSpotPrice(curve.state) : null;
  const progress = curve
    ? curveProgress(curve.state, BigInt(global.initialRealTokenReserves.toString()))
    : null;
  const decimals = supply?.value.decimals ?? 6;
  const totalSupply = supply ? BigInt(supply.value.amount) : null;
  const marketCap =
    curve && price !== null && totalSupply !== null
      ? BigInt(Math.round((price * Number(totalSupply)) / 10 ** decimals))
      : null;

  await sql`
    INSERT INTO pools (
      mint, pool, creator, reward_vault, token_vault, token_program,
      treasury_share_bps, creator_share_bps, min_lock_secs, max_lock_secs,
      max_multiplier_bps, early_unlock_penalty_bps, total_locked, total_weight,
      lifetime_inflow, lifetime_rewards, lifetime_burned, open_positions,
      token_supply, token_decimals, price_lamports, market_cap_lamports,
      curve_progress, graduated, created_at, updated_at
    ) VALUES (
      ${mint.toBase58()}, ${poolPda(mint).toBase58()}, ${pool.creator.toBase58()},
      ${pool.rewardVault.toBase58()}, ${pool.tokenVault.toBase58()},
      ${pool.tokenProgram.toBase58()},
      ${pool.terms.treasuryShareBps}, ${pool.terms.creatorShareBps},
      ${pool.terms.minLockSecs}, ${pool.terms.maxLockSecs},
      ${pool.terms.maxMultiplierBps}, ${pool.terms.earlyUnlockPenaltyBps},
      ${pool.totalLocked.toString()}::NUMERIC, ${pool.totalWeight.toString()}::NUMERIC,
      ${pool.lifetimeInflow.toString()}::BIGINT, ${pool.lifetimeRewards.toString()}::BIGINT,
      ${pool.lifetimeBurned.toString()}::NUMERIC, ${Number(pool.openPositions)},
      ${totalSupply ? totalSupply.toString() : null}::NUMERIC, ${decimals},
      ${price}, ${marketCap ? marketCap.toString() : null}::BIGINT,
      ${progress}, ${curve?.state.complete ?? false},
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
      price_lamports = EXCLUDED.price_lamports,
      market_cap_lamports = EXCLUDED.market_cap_lamports,
      curve_progress = EXCLUDED.curve_progress,
      graduated = EXCLUDED.graduated,
      updated_at = NOW()
  `;
}

/**
 * Shape of a pump.fun metadata JSON document. Validated rather than asserted:
 * this is arbitrary user-uploaded IPFS content and any field may be missing,
 * the wrong type, or hostile.
 */
const TokenMetadata = z
  .object({
    name: z.string().max(200).optional(),
    symbol: z.string().max(50).optional(),
    image: z.string().max(500).optional(),
    description: z.string().max(2_000).optional(),
    twitter: z.string().max(300).optional(),
    telegram: z.string().max(300).optional(),
    website: z.string().max(300).optional(),
  })
  .catchall(z.unknown());

/**
 * The only places a metadata document or image is ever fetched from.
 *
 * A coin's metadata URI is whatever its creator wrote, so fetching it as-is
 * would let anyone point the indexer at an internal address or an endless
 * response. Instead only IPFS content is accepted — `ipfs://<cid>` or a
 * `/ipfs/<cid>` path on a known public gateway — and it is always fetched from
 * pump's own Pinata gateway (`ipfs.io` as the fallback), which serves pump's
 * pins reliably. Image URLs are rewritten the same way so browsers load them
 * from the gateway that actually answers.
 */
const PUMP_GATEWAY = "https://pump.mypinata.cloud/ipfs/";
const IPFS_IO = "https://ipfs.io/ipfs/";
const IPFS_HOSTS: Record<string, true> = {
  "ipfs.io": true,
  "gateway.pinata.cloud": true,
  "cf-ipfs.com": true,
};
/** Any Pinata dedicated gateway, pump's own among them. */
const PINATA_SUBDOMAIN = /^[a-z0-9-]+\.mypinata\.cloud$/;
/** A CID and an optional plain path inside it: nothing to escape or traverse. */
const IPFS_PATH = /^[A-Za-z0-9]{32,128}(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,127})*$/;
const METADATA_MAX_BYTES = 64 * 1024;

/** The `<cid>[/path]` an IPFS URL names, or null for anything else. */
function ipfsPath(raw: string): string | null {
  let path: string;
  if (raw.startsWith("ipfs://")) {
    path = raw.slice("ipfs://".length).replace(/^ipfs\//, "");
  } else {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (IPFS_HOSTS[url.hostname] !== true && !PINATA_SUBDOMAIN.test(url.hostname)) return null;
    if (!url.pathname.startsWith("/ipfs/")) return null;
    path = url.pathname.slice("/ipfs/".length);
  }
  path = path.replace(/\/+$/, "");
  return IPFS_PATH.test(path) ? path : null;
}

/** An IPFS URL on pump's gateway, or null if `raw` is not IPFS content. */
export function gatewayUrl(raw: string): string | null {
  const path = ipfsPath(raw);
  return path ? PUMP_GATEWAY + path : null;
}

/** A social link worth showing: an absolute http(s) URL, or nothing. */
function webLink(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** GET with no redirects and a hard size cap, however the server behaves. */
async function fetchCappedJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`${url} → ${response.status}`);
  }
  if (Number(response.headers.get("content-length") ?? 0) > METADATA_MAX_BYTES) {
    await response.body.cancel();
    throw new Error(`${url}: metadata larger than ${METADATA_MAX_BYTES} bytes`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > METADATA_MAX_BYTES) {
      await reader.cancel();
      throw new Error(`${url}: metadata larger than ${METADATA_MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fetchMetadataDocument(uri: string): Promise<unknown> {
  const path = ipfsPath(uri);
  if (!path) throw new Error(`metadata URI is not IPFS content on a known gateway: ${uri}`);
  let lastError: unknown = new Error("no gateway answered");
  for (const gateway of [PUMP_GATEWAY, IPFS_IO]) {
    try {
      return await fetchCappedJson(gateway + path);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Pull the coin's name, symbol and image into the read model.
 *
 * pump.fun's `create_v2` writes name/symbol/uri into the Token-2022 metadata
 * extension on the mint itself (no Metaplex account), so the on-chain part is
 * one account read; the image, description and socials are in the document
 * the URI points at. Only for coins that already have a pool row.
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
  await sql`
    UPDATE pools SET name = ${onChain.name}, symbol = ${onChain.symbol}, metadata_uri = ${onChain.uri},
      updated_at = NOW()
    WHERE mint = ${mint}
  `;
  try {
    const meta = TokenMetadata.parse(await fetchMetadataDocument(onChain.uri));
    await sql`
      UPDATE pools SET
        image_url = ${meta.image ? gatewayUrl(meta.image) : null},
        description = ${meta.description ?? null},
        twitter = ${webLink(meta.twitter)}, telegram = ${webLink(meta.telegram)},
        website = ${webLink(meta.website)}, updated_at = NOW()
      WHERE mint = ${mint}
    `;
  } catch {
    // The document is cosmetic; a dead or refused gateway must not stall indexing.
  }
}

async function subscribe() {
  connection.onLogs(
    VISE_PROGRAM_ID,
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
          for (const event of parseViseEvents(log.logs)) {
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
  console.log("subscribed to", VISE_PROGRAM_ID.toBase58());
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

/** Discover pools created while the indexer was offline. */
async function discover() {
  const accounts = await connection.getProgramAccounts(VISE_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(DISCRIMINATOR.pool) } }],
  });
  for (const { account } of accounts) {
    const pool = decodePool(account.data);
    await upsertPoolFromChain(pool.mint);
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
 * from the tables that feed the activity feed, the reward chart and APR. The
 * cursor was always being written; this is the half that reads it.
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
    const batch = await connection.getSignaturesForAddress(
      VISE_PROGRAM_ID,
      { until, before, limit: 1000 },
      "confirmed",
    );
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
    for (const event of parseViseEvents(logs)) {
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

export { bondingCurvePda, handleEvent, parseViseEvents, reconcile };
