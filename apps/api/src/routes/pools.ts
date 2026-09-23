import { PublicKey } from "@solana/web3.js";
import { accrued, curveProgress, curveSpotPrice, estimateApr } from "@vise/sdk";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.ts";
import { fetchCurve, onlinePump } from "../pump.ts";
import { vise } from "../solana.ts";

const SORTS = {
  new: sql`created_at DESC`,
  rewards: sql`lifetime_rewards DESC`,
  locked: sql`total_weight DESC`,
  lockers: sql`open_positions DESC`,
} as const;

export async function poolRoutes(app: FastifyInstance) {
  app.get("/pools", async (request) => {
    const query = z
      .object({
        sort: z.enum(["new", "rewards", "locked", "lockers"]).default("new"),
        limit: z.coerce.number().int().min(1).max(100).default(48),
        offset: z.coerce.number().int().min(0).default(0),
        search: z.string().max(64).optional(),
      })
      .parse(request.query);

    const filter = query.search
      ? sql`WHERE (name ILIKE ${`%${query.search}%`} OR symbol ILIKE ${`%${query.search}%`} OR mint = ${query.search})`
      : sql``;

    const rows = await sql`
      SELECT mint, symbol, name, image_url, creator, total_locked, total_weight,
             token_supply, token_decimals, lifetime_rewards, lifetime_inflow,
             open_positions, creator_share_bps, treasury_share_bps,
             max_multiplier_bps, price_lamports, market_cap_lamports,
             curve_progress, graduated, created_at
      FROM pools
      ${filter}
      ORDER BY ${SORTS[query.sort]}
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;

    // APR is computed from fees actually paid in the last 7 days, never from
    // projected volume. A memecoin's projected anything is fiction.
    const windowSeconds = 7 * 86_400;
    const recent = await sql`
      SELECT mint, COALESCE(SUM(to_lockers), 0)::BIGINT AS lockers_7d
      FROM fee_events
      WHERE at > NOW() - INTERVAL '7 days'
      GROUP BY mint
    `;
    const byMint: Record<string, string> = {};
    for (const row of recent) byMint[row.mint as string] = row.lockers_7d as string;

    return {
      pools: rows.map((row) => {
        const price = (row.price_lamports as number | null) ?? 0;
        return {
          ...row,
          lockedFraction:
            row.token_supply && Number(row.token_supply) > 0
              ? Number(row.total_locked) / Number(row.token_supply)
              : 0,
          apr: estimateApr({
            lockerRewardsLamports: BigInt(byMint[row.mint as string] ?? "0"),
            windowSeconds,
            totalLocked: BigInt(row.total_locked as string),
            tokenPriceLamports: price,
            tokenDecimals: row.token_decimals as number,
          }),
        };
      }),
    };
  });

  app.get("/pools/:mint", async (request, reply) => {
    const { mint } = z.object({ mint: z.string() }).parse(request.params);
    let key: PublicKey;
    try {
      key = new PublicKey(mint);
    } catch {
      return reply.code(400).send({ error: "invalid mint" });
    }

    // Chain is authoritative for anything a user will act on; the database only
    // supplies metadata and history the chain does not carry.
    const [onChain, meta, curve, global] = await Promise.all([
      vise.fetchPool(key),
      sql`SELECT * FROM pools WHERE mint = ${mint}`,
      fetchCurve(key),
      onlinePump.fetchGlobal(),
    ]);
    if (!onChain) return reply.code(404).send({ error: "pool not found" });

    const row = meta[0];
    return {
      mint,
      metadata: row
        ? {
            name: row.name,
            symbol: row.symbol,
            imageUrl: row.image_url,
            description: row.description,
            twitter: row.twitter,
            telegram: row.telegram,
            website: row.website,
          }
        : null,
      pool: {
        creator: onChain.creator.toBase58(),
        rewardVault: onChain.rewardVault.toBase58(),
        tokenVault: onChain.tokenVault.toBase58(),
        tokenProgram: onChain.tokenProgram.toBase58(),
        terms: {
          ...onChain.terms,
          minLockAmount: onChain.terms.minLockAmount.toString(),
        },
        totalLocked: onChain.totalLocked.toString(),
        totalWeight: onChain.totalWeight.toString(),
        accRewardPerWeight: onChain.accRewardPerWeight.toString(),
        lifetimeInflow: onChain.lifetimeInflow.toString(),
        lifetimeRewards: onChain.lifetimeRewards.toString(),
        lifetimeBurned: onChain.lifetimeBurned.toString(),
        creatorClaimable: onChain.creatorClaimable.toString(),
        treasuryClaimable: onChain.treasuryClaimable.toString(),
        openPositions: Number(onChain.openPositions),
        createdAt: onChain.createdAt,
      },
      curve: curve
        ? {
            complete: curve.state.complete,
            progress: curveProgress(
              curve.state,
              BigInt(global.initialRealTokenReserves.toString()),
            ),
            priceLamports: curveSpotPrice(curve.state),
            virtualSolReserves: curve.state.virtualSolReserves.toString(),
            realSolReserves: curve.state.realSolReserves.toString(),
          }
        : null,
    };
  });

  /** Locker table for a coin, largest weight first. */
  app.get("/pools/:mint/lockers", async (request, reply) => {
    const { mint } = z.object({ mint: z.string() }).parse(request.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(request.query);

    let key: PublicKey;
    try {
      key = new PublicKey(mint);
    } catch {
      return reply.code(400).send({ error: "invalid mint" });
    }

    const [pool, positions] = await Promise.all([
      vise.fetchPool(key),
      vise.fetchPositionsByPool(key),
    ]);
    if (!pool) return reply.code(404).send({ error: "pool not found" });

    const rows = positions
      .map((position) => ({
        owner: position.owner.toBase58(),
        index: position.index,
        amount: position.amount.toString(),
        weight: position.weight.toString(),
        multiplierBps: position.multiplierBps,
        lockEnd: position.lockEnd,
        claimed: position.claimed.toString(),
        pending: accrued(
          position.weight,
          pool.accRewardPerWeight,
          position.rewardDebt,
        ).toString(),
        share:
          pool.totalWeight > 0n
            ? Number(position.weight) / Number(pool.totalWeight)
            : 0,
      }))
      .sort((a, b) => Number(BigInt(b.weight) - BigInt(a.weight)))
      .slice(0, query.limit);

    return { lockers: rows, totalWeight: pool.totalWeight.toString() };
  });

  /** Fee inflow history, bucketed for the reward chart. */
  app.get("/pools/:mint/rewards", async (request) => {
    const { mint } = z.object({ mint: z.string() }).parse(request.params);
    const rows = await sql`
      SELECT date_trunc('hour', at) AS bucket,
             SUM(amount)::BIGINT AS inflow,
             SUM(to_lockers)::BIGINT AS to_lockers,
             COUNT(*)::INT AS events
      FROM fee_events
      WHERE mint = ${mint} AND at > NOW() - INTERVAL '7 days'
      GROUP BY bucket
      ORDER BY bucket
    `;
    return { buckets: rows };
  });

  app.get("/pools/:mint/activity", async (request) => {
    const { mint } = z.object({ mint: z.string() }).parse(request.params);
    const rows = await sql`
      (SELECT 'lock' AS type, owner, amount::TEXT, at, signature FROM lock_events WHERE mint = ${mint})
      UNION ALL
      (SELECT 'claim' AS type, owner, amount::TEXT, at, signature FROM claim_events WHERE mint = ${mint})
      ORDER BY at DESC
      LIMIT 40
    `;
    return { activity: rows };
  });
}
