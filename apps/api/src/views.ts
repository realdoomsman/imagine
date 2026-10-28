import { rawToUsd, usdPrices, type QuoteInfo } from "./quotes.ts";

/**
 * Shared shaping of read-model rows into the Web⇄API contract. Every row that
 * carries amounts carries its quote, so the client always knows the unit.
 */

type Row = Record<string, unknown>;

/**
 * `fee_events.kind` beyond the program's `FeeKind` (0–3): 4 a sync — what the
 * pool actually took in (`RewardsSynced`); 5 synced inflow the read model has
 * no transaction for (history from before its cursor), reconstructed from the
 * pool's lifetime counters so the reward chart is never blank for a pool that
 * has paid out. 5 is shown in the chart but never counted in a 24h/7d rate.
 */
export const SYNCED_KIND = 4;
export const RECONSTRUCTED_KIND = 5;

/** Columns that hold a pool's quote display fields (select them as-is). */
export const QUOTE_COLUMNS = [
  "quote_mint",
  "quote_symbol",
  "quote_name",
  "quote_decimals",
  "quote_token_program",
  "quote_category",
  "quote_logo_url",
] as const;

/** Live USD prices for every quote the rows reference, in one request. */
export function pricesFor(rows: readonly Row[]): Promise<Map<string, number | null>> {
  return usdPrices(rows.map((row) => row.quote_mint as string).filter(Boolean));
}

export function quoteFromRow(row: Row, prices: Map<string, number | null>): QuoteInfo {
  const mint = row.quote_mint as string;
  return {
    mint,
    symbol: row.quote_symbol as string,
    name: row.quote_name as string,
    decimals: Number(row.quote_decimals),
    tokenProgram: row.quote_token_program as string,
    category: row.quote_category as string,
    logoUrl: (row.quote_logo_url as string | null) ?? null,
    usdPrice: prices.get(mint) ?? null,
  };
}

/** Strip the flat quote columns once they are folded into `quote`. */
function withoutQuoteColumns(row: Row): Row {
  const rest: Row = { ...row };
  for (const column of QUOTE_COLUMNS) delete rest[column];
  return rest;
}

/**
 * Annualised return from fees actually paid to lockers over a trailing
 * window, against the quote value of what is locked; null without a price or
 * with nothing locked. Realised, never projected: a memecoin's projected
 * anything is fiction.
 */
export function realisedApr(params: {
  lockerRewards: bigint;
  windowSeconds: number;
  totalLocked: bigint;
  tokenDecimals: number;
  priceQuote: number | null;
  quoteDecimals: number;
}): number | null {
  if (params.priceQuote === null || params.totalLocked === 0n || params.windowSeconds <= 0) return null;
  const lockedValue = (Number(params.totalLocked) / 10 ** params.tokenDecimals) * params.priceQuote * 10 ** params.quoteDecimals;
  if (!(lockedValue > 0)) return null;
  return (Number(params.lockerRewards) * 365 * 86_400) / params.windowSeconds / lockedValue;
}

/** Columns a pool summary row is built from. */
export const SUMMARY_COLUMNS = [
  "mint",
  "symbol",
  "name",
  "image_url",
  "creator",
  "total_locked",
  "total_weight",
  "token_supply",
  "token_decimals",
  "lifetime_rewards",
  "lifetime_inflow",
  "open_positions",
  "creator_share_bps",
  "treasury_share_bps",
  "max_multiplier_bps",
  "price_quote",
  "market_cap_quote",
  "curve_progress",
  "graduated",
  "created_at",
  ...QUOTE_COLUMNS,
] as const;

/** PoolSummary: the snake_case list row with its quote and USD figures. */
export function poolSummary(row: Row, prices: Map<string, number | null>, lockerRewards7d: bigint) {
  const quote = quoteFromRow(row, prices);
  const priceQuote = (row.price_quote as number | null) ?? null;
  const marketCap = (row.market_cap_quote as string | null) ?? null;
  return {
    ...withoutQuoteColumns(row),
    quote,
    price_quote: priceQuote,
    market_cap_quote: marketCap,
    price_usd: priceQuote !== null && quote.usdPrice !== null ? priceQuote * quote.usdPrice : null,
    market_cap_usd: marketCap !== null ? rawToUsd(marketCap, quote.decimals, quote.usdPrice) : null,
    lockedFraction:
      row.token_supply && Number(row.token_supply) > 0 ? Number(row.total_locked) / Number(row.token_supply) : 0,
    apr: realisedApr({
      lockerRewards: lockerRewards7d,
      windowSeconds: 7 * 86_400,
      totalLocked: BigInt(row.total_locked as string),
      tokenDecimals: Number(row.token_decimals),
      priceQuote,
      quoteDecimals: quote.decimals,
    }),
  };
}
