import { PublicKey } from "@solana/web3.js";
import { claimableFor, type PoolAccount, type PositionAccount } from "@imagine/sdk";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.ts";
import { rawToUsd, type QuoteInfo } from "../quotes.ts";
import { imagine } from "../solana.ts";
import { pricesFor, QUOTE_COLUMNS, quoteFromRow, RECONSTRUCTED_KIND } from "../views.ts";

type Row = Record<string, unknown>;

type LivePosition = PositionAccount & { address: PublicKey };

/**
 * Positions joined to their pools' read-model rows and projected on-chain
 * state: what a portfolio and the account dashboard both show. Pending
 * rewards come from the pool *projected to now* — the stream released and
 * any unsynced vault inflow folded in, with the program's own arithmetic —
 * so the number shown is what a claim would pay.
 */
export async function describePositions(positions: LivePosition[]): Promise<{
  rows: Array<{
    position: LivePosition;
    info: Row | undefined;
    pool: PoolAccount | null;
    quote: QuoteInfo | null;
    pending: bigint;
  }>;
  pendingUsd: number;
  claimedUsd: number;
}> {
  if (positions.length === 0) return { rows: [], pendingUsd: 0, claimedUsd: 0 };
  const poolAddresses = [...new Set(positions.map((p) => p.pool.toBase58()))];
  const meta = await sql`
    SELECT mint, pool, symbol, name, image_url, token_decimals, price_quote,
           early_unlock_penalty_bps, ${sql([...QUOTE_COLUMNS])}
    FROM pools WHERE pool = ANY(${poolAddresses})
  `;
  const byPool = new Map(meta.map((row) => [row.pool as string, row as Row]));
  const prices = await pricesFor(meta);
  // One fetch per distinct pool: the accumulator is pool-level.
  const projected = new Map(
    await Promise.all(
      meta.map(async (row) => [row.mint as string, await imagine.fetchProjectedPool(new PublicKey(row.mint as string))] as const),
    ),
  );

  let pendingUsd = 0;
  let claimedUsd = 0;
  const rows = positions.map((position) => {
    const info = byPool.get(position.pool.toBase58());
    const pool = info ? (projected.get(info.mint as string) ?? null) : null;
    const quote = info ? quoteFromRow(info, prices) : null;
    const pending = pool ? claimableFor(position, pool) : 0n;
    if (quote) {
      pendingUsd += rawToUsd(pending, quote.decimals, quote.usdPrice) ?? 0;
      claimedUsd += rawToUsd(position.claimed, quote.decimals, quote.usdPrice) ?? 0;
    }
    return { position, info, pool, quote, pending };
  });
  return { rows, pendingUsd, claimedUsd };
}

export async function portfolioRoutes(app: FastifyInstance) {
  /** Every live position for a wallet, priced from chain state. RPC per pool, so a tighter limit. */
  app.get("/portfolio/:owner", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { owner } = z.object({ owner: z.string() }).parse(request.params);
    let key: PublicKey;
    try {
      key = new PublicKey(owner);
    } catch {
      return reply.code(400).send({ error: "invalid owner" });
    }

    const described = await describePositions(await imagine.fetchPositionsByOwner(key));
    const rows = described.rows.map(({ position, info, pool, quote, pending }) => ({
      address: position.address.toBase58(),
      mint: (info?.mint as string | undefined) ?? null,
      symbol: (info?.symbol as string | null | undefined) ?? null,
      name: (info?.name as string | null | undefined) ?? null,
      imageUrl: (info?.image_url as string | null | undefined) ?? null,
      decimals: Number(info?.token_decimals ?? 6),
      quote,
      index: position.index,
      amount: position.amount.toString(),
      weight: position.weight.toString(),
      multiplierBps: position.multiplierBps,
      lockStart: position.lockStart,
      lockEnd: position.lockEnd,
      claimed: position.claimed.toString(),
      pending: pending.toString(),
      poolTotalWeight: pool ? pool.totalWeight.toString() : "0",
      share: pool && pool.totalWeight > 0n ? Number(position.weight) / Number(pool.totalWeight) : 0,
      minLockSecs: pool?.terms.minLockSecs ?? null,
      maxLockSecs: pool?.terms.maxLockSecs ?? null,
      /** The most this lock may ever be paid, quote base units. */
      rewardCap: position.rewardCap.toString(),
      /** Gave up its earnings for good: tokens locked, earns nothing. */
      renounced: position.renounced,
    }));

    return {
      positions: rows,
      totals: { pendingUsd: described.pendingUsd, claimedUsd: described.claimedUsd, positions: rows.length },
    };
  });

  /**
   * Leaderboards ranked on realised value, not on paper weight — the only
   * number that cannot be gamed by locking a worthless coin against itself.
   * Pools pay in different quotes, so earnings rank by their USD value now.
   */
  app.get("/leaderboard", async (request) => {
    const query = z
      .object({
        board: z.enum(["earners", "coins", "diamond"]).default("earners"),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);

    if (query.board === "earners") {
      // Per owner and coin first (each coin has one quote), then the coin's quote.
      const sums = await sql`
        SELECT s.owner, s.mint, s.earned, s.last_claim, ${sql(QUOTE_COLUMNS.map((c) => `p.${c}`))}
        FROM (
          SELECT owner, mint, SUM(amount)::TEXT AS earned, MAX(at) AS last_claim
          FROM claim_events GROUP BY owner, mint
        ) s
        JOIN pools p ON p.mint = s.mint
        WHERE NOT p.hidden
      `;
      const prices = await pricesFor(sums);
      const owners = new Map<
        string,
        { owner: string; earned_usd: number; coins: Set<string>; last_claim: Date; earned: Map<string, { quote: QuoteInfo; amount: bigint }> }
      >();
      for (const row of sums) {
        const quote = quoteFromRow(row, prices);
        const owner = row.owner as string;
        const entry =
          owners.get(owner) ??
          { owner, earned_usd: 0, coins: new Set<string>(), last_claim: row.last_claim as Date, earned: new Map() };
        const amount = BigInt(row.earned as string);
        entry.earned_usd += rawToUsd(amount, quote.decimals, quote.usdPrice) ?? 0;
        entry.coins.add(row.mint as string);
        if ((row.last_claim as Date) > entry.last_claim) entry.last_claim = row.last_claim as Date;
        const byQuote = entry.earned.get(quote.mint) ?? { quote, amount: 0n };
        byQuote.amount += amount;
        entry.earned.set(quote.mint, byQuote);
        owners.set(owner, entry);
      }
      const rows = [...owners.values()]
        .sort((a, b) => b.earned_usd - a.earned_usd)
        .slice(0, query.limit)
        .map((entry) => ({
          owner: entry.owner,
          earned_usd: entry.earned_usd,
          coins: entry.coins.size,
          last_claim: entry.last_claim,
          earned: [...entry.earned.values()].map(({ quote, amount }) => ({ quote, amount: amount.toString() })),
        }));
      return { board: "earners", rows };
    }

    if (query.board === "coins") {
      const pools = await sql`
        SELECT mint, symbol, name, image_url, lifetime_rewards::TEXT, lifetime_inflow::TEXT,
               open_positions, total_locked::TEXT, token_supply::TEXT, token_decimals, ${sql([...QUOTE_COLUMNS])}
        FROM pools
        WHERE NOT hidden
      `;
      const prices = await pricesFor(pools);
      const rows = pools
        .map((row) => {
          const quote = quoteFromRow(row, prices);
          const rest: Row = { ...row };
          for (const column of QUOTE_COLUMNS) delete rest[column];
          return {
            ...rest,
            quote,
            lifetime_rewards_usd: rawToUsd(row.lifetime_rewards as string, quote.decimals, quote.usdPrice) ?? 0,
          };
        })
        .sort((a, b) => b.lifetime_rewards_usd - a.lifetime_rewards_usd)
        .slice(0, query.limit);
      return { board: "coins", rows };
    }

    // Diamond hands: longest live commitment still outstanding.
    const rows = await sql`
      SELECT p.owner, p.mint, po.symbol, po.image_url, po.token_decimals, p.amount::TEXT,
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

  /** Platform-wide counters for the landing page ticker; money figures in USD. */
  app.get("/stats", async () => {
    const perQuote = await sql`
      SELECT p.quote_mint, p.quote_decimals,
             COUNT(*)::INT AS pools,
             COALESCE(SUM(p.lifetime_rewards), 0)::TEXT AS paid_to_lockers,
             COALESCE(SUM(p.lifetime_inflow), 0)::TEXT AS total_inflow,
             COALESCE(SUM(p.open_positions), 0)::INT AS open_positions,
             COALESCE((SELECT SUM(f.to_lockers) FROM fee_events f
                       JOIN pools q ON q.mint = f.mint
                       WHERE q.quote_mint = p.quote_mint AND NOT q.hidden
                         AND f.kind <> ${RECONSTRUCTED_KIND}
                         AND f.at > NOW() - INTERVAL '24 hours'), 0)::TEXT AS lockers_24h
      FROM pools p
      WHERE NOT p.hidden
      GROUP BY p.quote_mint, p.quote_decimals
    `;
    const [day] = await sql`
      SELECT COUNT(*) FILTER (WHERE kind IN (0, 1))::INT AS trades_24h
      FROM fee_events
      WHERE at > NOW() - INTERVAL '24 hours'
        AND mint NOT IN (SELECT mint FROM pools WHERE hidden)
    `;
    const prices = await pricesFor(perQuote);
    const usd = (row: Row, column: string) =>
      rawToUsd(row[column] as string, Number(row.quote_decimals), prices.get(row.quote_mint as string) ?? null) ?? 0;
    return {
      pools: perQuote.reduce((sum, row) => sum + Number(row.pools), 0),
      open_positions: perQuote.reduce((sum, row) => sum + Number(row.open_positions), 0),
      trades_24h: day?.trades_24h ?? 0,
      paid_to_lockers_usd: perQuote.reduce((sum, row) => sum + usd(row, "paid_to_lockers"), 0),
      total_inflow_usd: perQuote.reduce((sum, row) => sum + usd(row, "total_inflow"), 0),
      lockers_24h_usd: perQuote.reduce((sum, row) => sum + usd(row, "lockers_24h"), 0),
    };
  });
}
