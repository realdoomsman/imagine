import type { QuoteInfo } from "./api.ts";

/**
 * Formatting for amounts in a coin's pair asset.
 *
 * Every reward, fee and price on IMAGINE is denominated in whatever the coin
 * is paired with — 9-decimal SOL, 6-decimal USDC, 8-decimal xStocks — so
 * nothing here assumes lamports. A share of NVDAx is worth hundreds of
 * dollars, so small amounts keep significant digits rather than rounding to 0.
 */

type Amount = bigint | number | string;

function toWhole(base: Amount, decimals: number): number {
  return Number(typeof base === "string" ? BigInt(base) : base) / 10 ** decimals;
}

/** A plain number for display: grouped, compact above a million, 4 significant digits below 1. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1_000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs < 1e-9) return "<0.000000001";
  return value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

/** Base units of a `decimals`-place token as a display number. */
export function formatAmount(base: Amount, decimals: number): string {
  return formatNumber(toWhole(base, decimals));
}

/** "0.0421 NVDAx". */
export function formatQuote(base: Amount, quote: Pick<QuoteInfo, "decimals" | "symbol">): string {
  return `${formatAmount(base, quote.decimals)} ${quote.symbol}`;
}

/** USD value of `base` units of the pair asset, when it has a price. */
export function quoteToUsd(base: Amount, quote: Pick<QuoteInfo, "decimals" | "usdPrice">): number | null {
  if (quote.usdPrice === null) return null;
  return toWhole(base, quote.decimals) * quote.usdPrice;
}

export function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  if (abs < 0.01) return "<$0.01";
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "≈ $12.40" after a quote amount, or nothing when the asset has no price. */
export function usdSuffix(base: Amount, quote: Pick<QuoteInfo, "decimals" | "usdPrice">): string {
  const usd = quoteToUsd(base, quote);
  return usd === null ? "" : `≈ ${formatUsd(usd)}`;
}

/** A fee in bps as a percentage: 50 → "0.5%", 200 → "2%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** A per-coin price in pair units: keeps four significant digits however small. */
export function formatPrice(value: number | null, symbol: string): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "—";
  return `${value.toLocaleString("en-US", { maximumSignificantDigits: 4 })} ${symbol}`;
}

/**
 * A typed decimal ("1.25") to base units, exactly: no float on the way, extra
 * fraction digits are cut rather than rounded up. Zero for anything unparsable.
 */
export function parseAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return 0n;
  const [whole = "", fraction = ""] = trimmed.split(".");
  const digits = `${whole || "0"}${fraction.slice(0, decimals).padEnd(decimals, "0")}`;
  return BigInt(digits);
}

/** Keep only what can be part of a decimal number, one point at most. */
export function decimalInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const point = cleaned.indexOf(".");
  return point === -1 ? cleaned : `${cleaned.slice(0, point + 1)}${cleaned.slice(point + 1).replace(/\./g, "")}`;
}

const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? "mainnet-beta";
const EXPLORER_SUFFIX = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER === "localnet" ? "custom" : CLUSTER}`;

/** Solscan for a transaction. */
export const explorerTx = (signature: string) => `https://solscan.io/tx/${signature}${EXPLORER_SUFFIX}`;

/** Solscan for an account: the on-chain proof of a position's state. */
export const explorerAccount = (address: string) => `https://solscan.io/account/${address}${EXPLORER_SUFFIX}`;

/** The tooltip on every "Locked forever" badge. */
export const FOREVER_TOOLTIP = "This lock can never be unlocked or withdrawn; its earnings go to the other lockers";
