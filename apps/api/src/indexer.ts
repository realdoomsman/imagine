import { pathToFileURL } from "node:url";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";
import {
  bondingCurvePda,
  curveProgress,
  curveSpotPrice,
  decodeEvent,
  decodePool,
  decodePosition,
  DISCRIMINATOR,
  poolPda,
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
 * account, not from here.
 */

type EventPayload = Record<string, { toString(): string } & PublicKey & number>;

const seenSignatures = new Set<string>();

function asBigint(value: unknown): bigint {
  return BigInt((value as { toString(): string }).toString());
}

function asDate(unixSeconds: unknown): Date {
  return new Date(Number(asBigint(unixSeconds)) * 1000);
}

async function handleEvent(
  name: string,
  data: EventPayload,
  signature: string,
  slot: number,
) {
  switch (name) {
    case "PoolCreated": {
      const mint = data.mint.toBase58();
      await upsertPoolFromChain(new PublicKey(mint));
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
                ${slot}, ${asDate(data.timestamp)})
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
                ${slot}, ${asDate(data.timestamp)})
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
      await syncPosition(new PublicKey(mint), data.position.toBase58());
      await sql`
        INSERT INTO lock_events (signature, mint, owner, kind, amount, weight, lock_end, slot, at)
        VALUES (${signature}, ${mint}, ${data.owner.toBase58()}, ${name},
                ${asBigint(data.amount ?? data.added ?? 0).toString()}::NUMERIC,
                ${asBigint(data.weight ?? 0).toString()}::NUMERIC,
                ${data.lock_end ? asDate(data.lock_end) : null},
                ${slot}, ${asDate(data.timestamp)})
        ON CONFLICT DO NOTHING
      `;
      break;
    }

    case "Claimed": {
      const pool = data.pool.toBase58();
      const [row] = await sql`SELECT mint FROM pools WHERE pool = ${pool}`;
      if (!row) break;
      await sql`
        INSERT INTO claim_events (signature, mint, owner, amount, slot, at)
        VALUES (${signature}, ${row.mint as string}, ${data.owner.toBase58()},
                ${asBigint(data.amount).toString()}::BIGINT, ${slot}, ${asDate(data.timestamp)})
        ON CONFLICT DO NOTHING
      `;
      await sql`
        UPDATE positions SET claimed = ${asBigint(data.lifetime_claimed).toString()}::BIGINT,
                             updated_at = NOW()
        WHERE address = ${data.position.toBase58()}
      `;
      break;
    }

    case "Unlocked": {
      const pool = data.pool.toBase58();
      await sql`
        UPDATE positions SET closed = TRUE, updated_at = NOW()
        WHERE address = ${data.position.toBase58()}
      `;
      const [row] = await sql`SELECT mint FROM pools WHERE pool = ${pool}`;
      if (row) {
        await upsertPoolFromChain(new PublicKey(row.mint as string));
        await sql`
          INSERT INTO lock_events (signature, mint, owner, kind, amount, slot, at)
          VALUES (${signature}, ${row.mint as string}, ${data.owner.toBase58()},
                  ${data.early ? "EarlyUnlocked" : "Unlocked"},
                  ${asBigint(data.returned).toString()}::NUMERIC, ${slot}, ${asDate(data.timestamp)})
          ON CONFLICT DO NOTHING
        `;
      }
      break;
    }

    default:
      break;
  }
}

async function syncPosition(mint: PublicKey, address: string) {
  const info = await connection.getAccountInfo(new PublicKey(address));
  if (!info) {
    await sql`UPDATE positions SET closed = TRUE WHERE address = ${address}`;
    return;
  }
  const position = decodePosition(info.data);
  await sql`
    INSERT INTO positions (address, mint, owner, idx, amount, weight, multiplier_bps,
                           lock_start, lock_end, claimed, closed, updated_at)
    VALUES (${address}, ${mint.toBase58()}, ${position.owner.toBase58()}, ${position.index},
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
    image: z.string().url().max(500).optional(),
    description: z.string().max(2_000).optional(),
    twitter: z.string().max(300).optional(),
    telegram: z.string().max(300).optional(),
    website: z.string().max(300).optional(),
  })
  .catchall(z.unknown());

/** Pull coin name/symbol/image from the metadata URI recorded on pump. */
export async function backfillMetadata(mint: string, uri: string) {
  try {
    const response = await fetch(uri, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return;
    const meta = TokenMetadata.parse(await response.json());
    await sql`
      UPDATE pools SET name = ${meta.name ?? null}, symbol = ${meta.symbol ?? null},
        image_url = ${meta.image ?? null}, description = ${meta.description ?? null},
        twitter = ${meta.twitter ?? null}, telegram = ${meta.telegram ?? null},
        website = ${meta.website ?? null}, metadata_uri = ${uri}, updated_at = NOW()
      WHERE mint = ${mint}
    `;
  } catch {
    // Metadata is cosmetic; a dead IPFS gateway must not stall indexing.
  }
}

function decodeLogs(logs: string[]): Array<{ name: string; data: EventPayload }> {
  const events: Array<{ name: string; data: EventPayload }> = [];
  for (const line of logs) {
    const marker = "Program data: ";
    const at = line.indexOf(marker);
    if (at === -1) continue;
    try {
      const decoded = decodeEvent(line.slice(at + marker.length).trim());
      if (decoded) {
        events.push({ name: decoded.name, data: decoded.data as EventPayload });
      }
    } catch {
      // Not one of ours, or a log line from another program in the same tx.
    }
  }
  return events;
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

      void (async () => {
        try {
          for (const event of decodeLogs(log.logs)) {
            await handleEvent(event.name, event.data, log.signature, context.slot);
          }
          await sql`UPDATE indexer_cursor SET slot = ${context.slot},
                    signature = ${log.signature}, updated_at = NOW() WHERE id = 1`;
        } catch (error) {
          console.error("event handling failed", log.signature, error);
        }
      })();
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
    for (const event of decodeLogs(logs)) {
      await handleEvent(event.name, event.data, signature, slot);
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

export { bondingCurvePda, decodeLogs, handleEvent, reconcile };
