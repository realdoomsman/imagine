import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { claimableFor, FeeKind, raydiumTokenUrl } from "@imagine/sdk";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.ts";
import { launchableQuotes, quoteInfo, rawToUsd, usdPrices } from "../quotes.ts";
import { chainConfig, connection, imagine } from "../solana.ts";
import { marketCapQuote, readMarket, uncollectedFees, unsyncedRewards } from "../raydium.ts";
import { poolSummary, pricesFor, SUMMARY_COLUMNS } from "../views.ts";

/** `fee_events.kind` for a `RewardsSynced` row: what the pool actually took in. */
const SYNCED = 4;

const HISTORY_MIN_SECS = 3600;
const HISTORY_MAX_SECS = 7 * 86_400;
const HISTORY_MAX_BARS = 48;
const HISTORY_BUCKETS = [300, 900, 1800, 3600, 3 * 3600, 6 * 3600];

/** USD per quote base unit for every quote any pool uses, as SQL-joinable arrays. */
async function quoteUsdTable(): Promise<{ mints: string[]; perUnit: number[] }> {
  const rows = await sql`SELECT DISTINCT quote_mint, quote_decimals FROM pools`;
  const prices = await usdPrices(rows.map((row) => row.quote_mint as string));
  return {
    mints: rows.map((row) => row.quote_mint as string),
    perUnit: rows.map((row) => (prices.get(row.quote_mint as string) ?? 0) / 10 ** Number(row.quote_decimals)),
  };
}

export async function poolRoutes(app: FastifyInstance) {
  // A hidden (unlisted) pool is off the site entirely: its page and every read
  // of it answer 404. Its lockers still claim and unlock from their portfolio,
  // and nothing on chain changes.
  app.addHook("preHandler", async (request, reply) => {
    const { mint } = request.params as { mint?: string };
    if (!mint) return;
    const [row] = await sql`SELECT 1 FROM pools WHERE mint = ${mint} AND hidden`;
    if (row) return reply.code(404).send({ error: "pool not found" });
  });

  /** The pairs a coin can launch against: every LaunchLab quote in the registry Jupiter can price. */
  app.get("/quotes", async () => launchableQuotes());

  app.get("/pools", async (request) => {
    const query = z
      .object({
        sort: z.enum(["new", "rewards", "locked", "lockers", "mcap"]).default("new"),
        limit: z.coerce.number().int().min(1).max(100).default(48),
        offset: z.coerce.number().int().min(0).default(0),
        search: z.string().max(64).optional(),
        category: z.string().max(32).optional(),
      })
      .parse(request.query);

    const conditions = [sql`NOT p.hidden`];
    if (query.search) {
      conditions.push(
        sql`(p.name ILIKE ${`%${query.search}%`} OR p.symbol ILIKE ${`%${query.search}%`} OR p.mint = ${query.search})`,
      );
    }
    if (query.category) conditions.push(sql`p.quote_category = ${query.category}`);
    const where = conditions.reduce((acc, condition) => sql`${acc} AND ${condition}`);

    // Rewards and market caps are in each pool's own quote, so ranking across
    // pools goes through USD.
    const usd = await quoteUsdTable();
    const order = {
      new: sql`p.created_at DESC`,
      rewards: sql`p.lifetime_rewards * COALESCE(u.per_unit, 0) DESC, p.created_at DESC`,
      locked: sql`p.total_weight DESC`,
      lockers: sql`p.open_positions DESC`,
      mcap: sql`COALESCE(p.market_cap_quote, 0) * COALESCE(u.per_unit, 0) DESC, p.created_at DESC`,
    }[query.sort];

    const rows = await sql`
      SELECT ${sql(SUMMARY_COLUMNS.map((column) => `p.${column}`))}
      FROM pools p
      LEFT JOIN unnest(${usd.mints}::text[], ${usd.perUnit}::float8[]) AS u(quote_mint, per_unit)
        ON u.quote_mint = p.quote_mint
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;

    const mints = rows.map((row) => row.mint as string);
    const recent = mints.length
      ? await sql`
          SELECT mint, COALESCE(SUM(to_lockers), 0)::TEXT AS lockers_7d
          FROM fee_events
          WHERE at > NOW() - INTERVAL '7 days' AND mint = ANY(${mints})
          GROUP BY mint
        `
      : [];
    const byMint = new Map(recent.map((row) => [row.mint as string, BigInt(row.lockers_7d as string)]));
    const prices = await pricesFor(rows);

    return { pools: rows.map((row) => poolSummary(row, prices, byMint.get(row.mint as string) ?? 0n)) };
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
    const [onChain, pool] = await Promise.all([imagine.fetchProjectedPool(key), imagine.fetchPool(key)]);
    if (!onChain || !pool || !pool.founded) return reply.code(404).send({ error: "pool not found" });

    const [meta, market, supply, [day], unsynced, config, quote] = await Promise.all([
      sql`SELECT * FROM pools WHERE mint = ${mint}`,
      readMarket(key, pool.quoteMint),
      connection.getTokenSupply(key).catch(() => null),
      // Synced rows are what the pool took in (every source, once); deposit
      // rows are the app fee legs, so they also count trades routed here.
      sql`
        SELECT COALESCE(SUM(to_lockers) FILTER (WHERE kind = ${SYNCED}), 0)::TEXT AS to_lockers,
               COALESCE(SUM(amount) FILTER (WHERE kind = ${SYNCED}), 0)::TEXT AS inflow,
               COALESCE(SUM(amount) FILTER (WHERE kind IN (${FeeKind.Buy}, ${FeeKind.Sell})), 0)::TEXT AS app_fees,
               COUNT(*) FILTER (WHERE kind IN (${FeeKind.Buy}, ${FeeKind.Sell}))::INT AS trades
        FROM fee_events
        WHERE mint = ${mint} AND at > NOW() - INTERVAL '24 hours'
      `,
      unsyncedRewards(pool).catch(() => 0n),
      chainConfig(),
      quoteInfo(pool.quoteMint.toBase58()),
    ]);
    const row = meta[0];
    const uncollected = await uncollectedFees(pool, market).catch(() => 0n);
    const totalSupply = supply ? BigInt(supply.value.amount) : null;
    const priceUsd =
      market?.priceQuote != null && quote.usdPrice !== null ? market.priceQuote * quote.usdPrice : null;
    const graduated = market?.status === "graduated";
    const marketCap = market && totalSupply !== null ? marketCapQuote(market, totalSupply) : null;

    return {
      mint,
      quote,
      links: {
        raydium: raydiumTokenUrl(mint),
        raydiumSwap: graduated ? `https://raydium.io/swap/?inputMint=${quote.mint}&outputMint=${mint}` : null,
      },
      // Size tiers are a share of total supply, so the panel needs it exactly.
      tokenSupply: supply?.value.amount ?? (row?.token_supply as string | null) ?? null,
      tokenDecimals: supply?.value.decimals ?? (row?.token_decimals as number | undefined) ?? 6,
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
        rewardTokenAccount: pool.quoteMint.equals(NATIVE_MINT) ? null : onChain.rewardTokenAccount.toBase58(),
        tokenVault: onChain.tokenVault.toBase58(),
        tokenProgram: onChain.tokenProgram.toBase58(),
        launchlabPool: onChain.launchlabPool.toBase58(),
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
        // What is queued for lockers and when the current window closes, so
        // the page can show a stream in progress rather than a static total.
        undistributed: onChain.undistributed.toString(),
        streamEnd: onChain.streamEnd,
        openPositions: Number(onChain.openPositions),
        createdAt: onChain.createdAt,
        /** Quote base units open locks can still earn; fees beyond go to the treasury. */
        rewardCapacity: onChain.rewardCapacity.toString(),
      },
      rewardRate: {
        /** Quote that reached lockers' streams in the last 24 hours. */
        lockersPerDay: day!.to_lockers as string,
        /** Everything the pool took in over the last 24 hours, before the treasury cut. */
        feesPerDay: day!.inflow as string,
        /** The pool's on-chain trading fee still held by LaunchLab (and CPMM after graduation), not yet collected. */
        uncollected: uncollected.toString(),
        /** Already in the vault (collected fees, donations), not yet synced. */
        unsynced: unsynced.toString(),
        /** Quote traded through IMAGINE in the window, from the app fee it paid. */
        siteVolume:
          config.tradeFeeBps > 0
            ? ((BigInt(day!.app_fees as string) * 10_000n) / BigInt(config.tradeFeeBps)).toString()
            : "0",
        trades: day!.trades as number,
      },
      curve: market
        ? {
            status: market.status,
            progress: market.progress,
            priceQuote: market.priceQuote ?? 0,
            priceUsd,
            realQuote: market.state.realQuote.toString(),
            fundRaising: market.state.totalQuoteFundRaising.toString(),
          }
        : null,
      marketCapQuote: marketCap?.toString() ?? null,
      marketCapUsd: marketCap === null ? null : rawToUsd(marketCap, quote.decimals, quote.usdPrice),
    };
  });

  /** Locker table for a coin, largest lock first. RPC-backed, so a tighter limit. */
  app.get("/pools/:mint/lockers", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
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

    // A pool first: the position scan is the expensive read, and is never
    // worth making for a mint that has no pool.
    const pool = await imagine.fetchProjectedPool(key);
    if (!pool) return reply.code(404).send({ error: "pool not found" });
    const positions = await imagine.fetchPositionsByPool(key);

    const rows = positions
      .map((position) => ({
        owner: position.owner.toBase58(),
        index: position.index,
        amount: position.amount.toString(),
        weight: position.weight.toString(),
        multiplierBps: position.multiplierBps,
        lockEnd: position.lockEnd,
        claimed: position.claimed.toString(),
        pending: claimableFor(position, pool).toString(),
        /** The most this lock may ever be paid, quote base units. */
        rewardCap: position.rewardCap.toString(),
        /** Gave up its earnings for good: tokens locked, earns nothing. */
        renounced: position.renounced,
        share: pool.totalWeight > 0n ? Number(position.weight) / Number(pool.totalWeight) : 0,
      }))
      // By tokens locked, so a lock that renounced its earnings still shows
      // where its size puts it.
      .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)))
      .slice(0, query.limit);

    return { lockers: rows, totalWeight: pool.totalWeight.toString() };
  });

  /**
   * Lockers' share of fee inflow, bucketed for the reward chart. The window
   * runs from the pool's creation (at least 1 hour, at most 7 days) and the
   * bucket width is picked so it holds at most 48 bars: a coin a few hours old
   * gets a readable chart rather than one sliver at the edge of a week.
   * Amounts are in the pool's quote base units.
   */
  app.get("/pools/:mint/rewards", async (request) => {
    const { mint } = z.object({ mint: z.string() }).parse(request.params);
    const [pool] = await sql`SELECT created_at FROM pools WHERE mint = ${mint}`;
    const now = Math.floor(Date.now() / 1000);
    const created = pool ? Math.floor(new Date(pool.created_at as string).getTime() / 1000) : now - HISTORY_MAX_SECS;
    const span = Math.min(Math.max(now - created, HISTORY_MIN_SECS), HISTORY_MAX_SECS);
    const bucketSecs = HISTORY_BUCKETS.find((secs) => span / secs <= HISTORY_MAX_BARS) ?? HISTORY_BUCKETS.at(-1)!;
    const since = Math.floor((now - span) / bucketSecs) * bucketSecs;
    const rows = await sql`
      SELECT to_timestamp(FLOOR(EXTRACT(EPOCH FROM at) / ${bucketSecs}) * ${bucketSecs}) AS bucket,
             SUM(amount) FILTER (WHERE kind = ${SYNCED})::TEXT AS inflow,
             SUM(to_lockers)::TEXT AS to_lockers,
             COUNT(*) FILTER (WHERE kind = ${SYNCED})::INT AS events
      FROM fee_events
      WHERE mint = ${mint} AND at >= to_timestamp(${since})
      GROUP BY bucket
      ORDER BY bucket
    `;
    return { since, bucketSecs, createdAt: pool ? created : null, buckets: rows };
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
