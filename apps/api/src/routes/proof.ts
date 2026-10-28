import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pubkey } from "../actions.ts";
import { sql } from "../db.ts";
import { rawToUsd, type QuoteInfo } from "../quotes.ts";
import { pricesFor, QUOTE_COLUMNS, quoteFromRow } from "../views.ts";

/**
 * The proof page: what the program has paid, read from the events it
 * emitted (`Claimed`, `Compounded`, `Unlocked`, `LockedForever`) and the
 * pools' own lifetime counters, every row carrying the signature that proves
 * it. Hidden pools are left out, as everywhere else on the site.
 */

type Row = Record<string, unknown>;

/** Coin base units valued at the pool's last price, in quote base units (display only). */
function valueInQuote(tokens: string, row: Row): bigint {
  const price = row.price_quote as number | null;
  if (price === null || price === undefined) return 0n;
  const value = (Number(tokens) / 10 ** Number(row.token_decimals)) * price * 10 ** Number(row.quote_decimals);
  return Number.isFinite(value) ? BigInt(Math.round(value)) : 0n;
}

const FEED_TYPES = {
  payouts: ["claim", "compound"],
  claims: ["claim"],
  compounds: ["compound"],
  burns: ["burn"],
} as const;

/** A feed position: the last row's time, type and id (the feed's sort key), opaque to clients. */
const Cursor = z.object({ at: z.string().datetime(), type: z.enum(["claim", "compound", "burn"]), id: z.string().regex(/^\d+$/) });

export async function proofRoutes(app: FastifyInstance) {
  /**
   * Headline totals, across every coin or for one (`mint`), per pair asset
   * and summed in USD at today's prices: paid to lockers (claims plus
   * compounds), payouts and wallets paid, fees that reached the pools, what
   * is locked now, coin burned by early exits, and locks made permanent.
   */
  app.get("/proof/summary", async (request) => {
    const { mint } = z.object({ mint: pubkey.optional() }).parse(request.query);
    const pools = await sql`
      SELECT p.mint, p.symbol, p.name, p.image_url, p.token_decimals, p.price_quote,
             p.total_locked::TEXT, p.open_positions, p.lifetime_inflow::TEXT, p.lifetime_burned::TEXT,
             ${sql([...QUOTE_COLUMNS].map((column) => `p.${column}`))},
             COALESCE(c.n, 0)::INT AS claims, COALESCE(c.amount, 0)::TEXT AS claimed,
             COALESCE(k.n, 0)::INT AS compounds, COALESCE(k.amount, 0)::TEXT AS compounded,
             COALESCE(l.early, 0)::INT AS early_exits, COALESCE(l.forever, 0)::INT AS locked_forever
      FROM pools p
      LEFT JOIN (SELECT mint, COUNT(*) AS n, SUM(amount) AS amount FROM claim_events GROUP BY mint) c ON c.mint = p.mint
      LEFT JOIN (SELECT mint, COUNT(*) AS n, SUM(quote_in) AS amount FROM compound_events GROUP BY mint) k ON k.mint = p.mint
      LEFT JOIN (
        SELECT mint, COUNT(*) FILTER (WHERE kind = 'EarlyUnlocked') AS early,
               COUNT(*) FILTER (WHERE kind = 'LockedForever') AS forever
        FROM lock_events GROUP BY mint
      ) l ON l.mint = p.mint
      WHERE NOT p.hidden ${mint ? sql`AND p.mint = ${mint}` : sql``}
    `;
    const [wallets] = await sql`
      SELECT COUNT(DISTINCT e.owner)::INT AS n
      FROM (SELECT owner, mint FROM claim_events UNION ALL SELECT owner, mint FROM compound_events) e
      JOIN pools p ON p.mint = e.mint
      WHERE NOT p.hidden ${mint ? sql`AND p.mint = ${mint}` : sql``}
    `;
    const prices = await pricesFor(pools);

    const byQuote = new Map<
      string,
      { quote: QuoteInfo; claimed: bigint; compounded: bigint; fees: bigint; locked: bigint; burned: bigint }
    >();
    const totals = { payouts: 0, claims: 0, compounds: 0, openPositions: 0, earlyExits: 0, lockedForever: 0 };
    for (const row of pools) {
      const quote = quoteFromRow(row, prices);
      const entry = byQuote.get(quote.mint) ?? { quote, claimed: 0n, compounded: 0n, fees: 0n, locked: 0n, burned: 0n };
      entry.claimed += BigInt(row.claimed as string);
      entry.compounded += BigInt(row.compounded as string);
      entry.fees += BigInt(row.lifetime_inflow as string);
      entry.locked += valueInQuote(row.total_locked as string, row);
      entry.burned += valueInQuote(row.lifetime_burned as string, row);
      byQuote.set(quote.mint, entry);
      totals.claims += Number(row.claims);
      totals.compounds += Number(row.compounds);
      totals.openPositions += Number(row.open_positions);
      totals.earlyExits += Number(row.early_exits);
      totals.lockedForever += Number(row.locked_forever);
    }
    totals.payouts = totals.claims + totals.compounds;

    const quotes = [...byQuote.values()].map((entry) => {
      const usd = (raw: bigint) => rawToUsd(raw, entry.quote.decimals, entry.quote.usdPrice);
      const paid = entry.claimed + entry.compounded;
      return {
        quote: entry.quote,
        paid: paid.toString(),
        claimed: entry.claimed.toString(),
        compounded: entry.compounded.toString(),
        fees: entry.fees.toString(),
        locked: entry.locked.toString(),
        burned: entry.burned.toString(),
        paidUsd: usd(paid),
        feesUsd: usd(entry.fees),
        lockedUsd: usd(entry.locked),
        burnedUsd: usd(entry.burned),
      };
    });
    const sum = (key: "paidUsd" | "feesUsd" | "lockedUsd" | "burnedUsd") =>
      quotes.reduce((total, entry) => total + (entry[key] ?? 0), 0);

    const coinRow = mint ? pools[0] : undefined;
    // Every listed coin for the filter, whichever one this summary is for.
    const coins = await sql`
      SELECT p.mint, p.symbol, p.image_url AS "imageUrl",
             ((SELECT COUNT(*) FROM claim_events c WHERE c.mint = p.mint)
              + (SELECT COUNT(*) FROM compound_events k WHERE k.mint = p.mint))::INT AS payouts
      FROM pools p
      WHERE NOT p.hidden
      ORDER BY payouts DESC, p.symbol
    `;

    return {
      totals: {
        ...totals,
        walletsPaid: wallets?.n ?? 0,
        paidUsd: sum("paidUsd"),
        feesUsd: sum("feesUsd"),
        lockedUsd: sum("lockedUsd"),
        burnedUsd: sum("burnedUsd"),
      },
      byQuote: quotes.sort((a, b) => (b.paidUsd ?? 0) - (a.paidUsd ?? 0)),
      coin: coinRow
        ? {
            mint: coinRow.mint as string,
            symbol: (coinRow.symbol as string | null) ?? null,
            name: (coinRow.name as string | null) ?? null,
            imageUrl: (coinRow.image_url as string | null) ?? null,
            decimals: Number(coinRow.token_decimals),
            lockedTokens: coinRow.total_locked as string,
            burnedTokens: coinRow.lifetime_burned as string,
          }
        : null,
      coins,
    };
  });

  /**
   * Every payout, newest first: claims and compounds by default, or one type
   * (`claims`, `compounds`, `burns` — early exits' burned coin), optionally
   * for one coin. Keyset-paginated: pass back `nextCursor` for the page after.
   * `amount` is pair-asset base units (claims, compounds); `tokens` is coin
   * base units (what a compound bought, what an early exit burned).
   */
  app.get("/proof/payouts", async (request, reply) => {
    const query = z
      .object({
        mint: pubkey.optional(),
        type: z.enum(["payouts", "claims", "compounds", "burns"]).default("payouts"),
        cursor: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    let cursor: z.infer<typeof Cursor> | null = null;
    if (query.cursor) {
      try {
        cursor = Cursor.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")));
      } catch {
        return reply.code(400).send({ error: "invalid cursor" });
      }
    }
    const types: readonly string[] = FEED_TYPES[query.type];
    const byMint = query.mint ? sql`WHERE mint = ${query.mint}` : sql`WHERE TRUE`;
    const parts = [
      types.includes("claim")
        ? sql`SELECT 'claim'::TEXT AS type, id, signature, at, owner, mint, amount::TEXT AS amount, NULL::TEXT AS tokens
              FROM claim_events ${byMint}`
        : null,
      types.includes("compound")
        ? sql`SELECT 'compound'::TEXT AS type, id, signature, at, owner, mint, quote_in::TEXT AS amount, tokens_out::TEXT AS tokens
              FROM compound_events ${byMint}`
        : null,
      types.includes("burn")
        ? sql`SELECT 'burn'::TEXT AS type, id, signature, at, owner, mint, NULL::TEXT AS amount, burned::TEXT AS tokens
              FROM lock_events ${byMint} AND kind = 'EarlyUnlocked' AND burned > 0`
        : null,
    ].filter((part) => part !== null);
    const union = parts.reduce((all, part) => sql`${all} UNION ALL ${part}`);
    const rows = await sql`
      SELECT e.type, e.id::TEXT AS id, e.signature, e.at, e.owner, e.mint, e.amount, e.tokens,
             p.symbol, p.image_url, p.token_decimals, ${sql([...QUOTE_COLUMNS].map((column) => `p.${column}`))}
      FROM (${union}) e
      JOIN pools p ON p.mint = e.mint
      WHERE NOT p.hidden
        ${cursor ? sql`AND (e.at, e.type, e.id) < (${cursor.at}::TIMESTAMPTZ, ${cursor.type}, ${cursor.id}::BIGINT)` : sql``}
      ORDER BY e.at DESC, e.type DESC, e.id DESC
      LIMIT ${query.limit + 1}
    `;
    const page = rows.slice(0, query.limit);
    const prices = await pricesFor(page);
    const last = page[page.length - 1];
    return {
      payouts: page.map((row) => ({
        id: `${row.type}:${row.id}`,
        type: row.type as "claim" | "compound" | "burn",
        signature: row.signature as string,
        at: row.at as Date,
        owner: row.owner as string,
        mint: row.mint as string,
        symbol: (row.symbol as string | null) ?? null,
        imageUrl: (row.image_url as string | null) ?? null,
        decimals: Number(row.token_decimals),
        quote: quoteFromRow(row, prices),
        amount: (row.amount as string | null) ?? null,
        tokens: (row.tokens as string | null) ?? null,
      })),
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(
              JSON.stringify({ at: (last.at as Date).toISOString(), type: last.type, id: last.id }),
              "utf8",
            ).toString("base64url")
          : null,
    };
  });
}
