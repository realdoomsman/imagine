import { PublicKey } from "@solana/web3.js";
import { claimableFor } from "@imagine/sdk";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.ts";
import { vise } from "../solana.ts";

export async function portfolioRoutes(app: FastifyInstance) {
  /**
   * Every live position for a wallet, priced from chain state.
   *
   * Pending rewards come from the pool *projected to now* — the stream released
   * and any unsynced vault inflow folded in, with the program's own arithmetic
   * — so the number shown is the number the claim instruction will pay, not
   * the number from whenever someone last touched the pool. RPC per position,
   * so a tighter limit than the global one.
   */
  app.get("/portfolio/:owner", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { owner } = z.object({ owner: z.string() }).parse(request.params);
    let key: PublicKey;
    try {
      key = new PublicKey(owner);
    } catch {
      return reply.code(400).send({ error: "invalid owner" });
    }

    const positions = await vise.fetchPositionsByOwner(key);
    if (positions.length === 0) {
      return { positions: [], totals: { pending: "0", claimed: "0", positions: 0 } };
    }

    const poolAddresses = [...new Set(positions.map((p) => p.pool.toBase58()))];
    const meta = await sql`
      SELECT mint, pool, symbol, name, image_url, token_decimals, price_lamports
      FROM pools WHERE pool = ANY(${poolAddresses})
    `;
    const byPool: Record<string, (typeof meta)[number]> = {};
    for (const row of meta) byPool[row.pool as string] = row;

    // One fetch per distinct pool: the accumulator is pool-level, so positions
    // in the same pool share it.
    const pools = await Promise.all(
      [...new Set(positions.map((p) => byPool[p.pool.toBase58()]?.mint as string))]
        .filter(Boolean)
        .map(async (mint) => [mint, await vise.fetchProjectedPool(new PublicKey(mint))] as const),
    );
    const poolByMint = Object.fromEntries(pools);

    let pending = 0n;
    let claimed = 0n;
    const rows = positions.map((position) => {
      const info = byPool[position.pool.toBase58()];
      const mint = info?.mint as string | undefined;
      const pool = mint ? poolByMint[mint] : null;
      const due = pool ? claimableFor(position, pool) : 0n;
      pending += due;
      claimed += position.claimed;
      return {
        address: position.address.toBase58(),
        mint: mint ?? null,
        symbol: info?.symbol ?? null,
        name: info?.name ?? null,
        imageUrl: info?.image_url ?? null,
        decimals: (info?.token_decimals as number | undefined) ?? 6,
        index: position.index,
        amount: position.amount.toString(),
        weight: position.weight.toString(),
        multiplierBps: position.multiplierBps,
        lockStart: position.lockStart,
        lockEnd: position.lockEnd,
        claimed: position.claimed.toString(),
        pending: due.toString(),
        poolTotalWeight: pool ? pool.totalWeight.toString() : "0",
        share:
          pool && pool.totalWeight > 0n
            ? Number(position.weight) / Number(pool.totalWeight)
            : 0,
        minLockSecs: pool?.terms.minLockSecs ?? null,
        maxLockSecs: pool?.terms.maxLockSecs ?? null,
        /** Capped pools: the most this lock may ever be paid, in lamports. */
        rewardCap: pool?.capped ? position.rewardCap.toString() : null,
        /** Gave up its earnings for good: tokens locked, earns nothing. */
        renounced: position.renounced,
      };
    });

    return {
      positions: rows,
      totals: {
        pending: pending.toString(),
        claimed: claimed.toString(),
        positions: rows.length,
      },
    };
  });

  /**
   * Leaderboards ranked on realised SOL, not on paper weight — the only number
   * that cannot be gamed by locking a worthless coin against itself.
   */
  app.get("/leaderboard", async (request) => {
    const query = z
      .object({
        board: z.enum(["earners", "coins", "diamond"]).default("earners"),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);

    if (query.board === "earners") {
      const rows = await sql`
        SELECT owner,
               SUM(amount)::NUMERIC::TEXT AS earned,
               COUNT(DISTINCT mint)::INT AS coins,
               MAX(at) AS last_claim
        FROM claim_events
        WHERE mint NOT IN (SELECT mint FROM pools WHERE hidden)
        GROUP BY owner
        ORDER BY SUM(amount) DESC
        LIMIT ${query.limit}
      `;
      return { board: "earners", rows };
    }

    if (query.board === "coins") {
      const rows = await sql`
        SELECT mint, symbol, name, image_url, lifetime_rewards, lifetime_inflow,
               open_positions, total_locked, token_supply
        FROM pools
        WHERE NOT hidden
        ORDER BY lifetime_rewards DESC
        LIMIT ${query.limit}
      `;
      return { board: "coins", rows };
    }

    // Diamond hands: longest live commitment still outstanding.
    const rows = await sql`
      SELECT p.owner, p.mint, po.symbol, po.image_url, p.amount::TEXT,
             p.multiplier_bps, p.lock_end,
             EXTRACT(EPOCH FROM (p.lock_end - p.lock_start))::INT AS term_secs
      FROM positions p
      JOIN pools po ON po.mint = p.mint
      WHERE NOT p.closed AND p.lock_end > NOW() AND NOT po.hidden
      ORDER BY term_secs DESC, p.weight DESC
      LIMIT ${query.limit}
    `;
    return { board: "diamond", rows };
  });

  /** Platform-wide counters for the landing page ticker. */
  app.get("/stats", async () => {
    const [totals] = await sql`
      SELECT COUNT(*)::INT AS pools,
             COALESCE(SUM(lifetime_rewards), 0)::NUMERIC::TEXT AS paid_to_lockers,
             COALESCE(SUM(lifetime_inflow), 0)::NUMERIC::TEXT AS total_inflow,
             COALESCE(SUM(open_positions), 0)::INT AS open_positions
      FROM pools
      WHERE NOT hidden
    `;
    const [day] = await sql`
      SELECT COALESCE(SUM(to_lockers), 0)::NUMERIC::TEXT AS lockers_24h,
             -- Trades are the app fee deposits (buy 0, sell 1); sync rows
             -- re-count the same lamports and are not trades.
             COUNT(*) FILTER (WHERE kind IN (0, 1))::INT AS trades_24h
      FROM fee_events
      WHERE at > NOW() - INTERVAL '24 hours'
        AND mint NOT IN (SELECT mint FROM pools WHERE hidden)
    `;
    return { ...totals, ...day };
  });
}
