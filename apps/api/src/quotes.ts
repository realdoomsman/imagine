import { setTimeout as sleep } from "node:timers/promises";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { QUOTES, decodeGlobalConfig, quoteByMint, type QuoteToken } from "@imagine/sdk";
import { z } from "zod";
import { env } from "./env.ts";
import { connection } from "./solana.ts";

/**
 * Quote assets: what an IMAGINE coin is paired with on Raydium LaunchLab, and
 * what its lockers are paid in.
 *
 * The SDK registry (`QUOTES`) lists every vetted quote with a LaunchLab
 * GlobalConfig — SOL, stablecoins, tokenized stocks like SPYx and NVDAx, … —
 * with its decimals, token program and art. Jupiter's Price API v3 prices
 * them in USD (and sizes each pair's raise); Jupiter's token API fills in a
 * logo where the registry has none.
 */

/** The Web⇄API shape of a quote asset. */
export interface QuoteInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  tokenProgram: string;
  category: string;
  logoUrl: string | null;
  /**
   * USD per 10^decimals base units (Jupiter's pre-scaled price for
   * ScaledUiAmount mints), so `usd = raw / 10^decimals × usdPrice`. Null when
   * Jupiter has no price.
   */
  usdPrice: number | null;
}

// --- USD prices (Jupiter Price API v3) ------------------------------------

interface JupiterPrice {
  usdPrice?: number;
  decimals?: number;
  scaledUiConfig?: { usdPricePrescaled?: number; multiplier?: number; newMultiplier?: number; newMultiplierEffectiveAt?: string };
}

/** Jupiter accepts at most this many ids per request. */
const JUPITER_MAX_IDS = 50;
/** Retries of a rate-limited (429) request, backing off 1 s, 2 s, 4 s. */
const JUPITER_RETRIES = 3;
const PRICE_TTL_MS = 30_000;

function jupiterHeaders(): Record<string, string> {
  return env.jupiterApiKey ? { "x-api-key": env.jupiterApiKey } : {};
}

/** GET JSON from Jupiter, backing off on 429. */
async function jupiterJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: jupiterHeaders(), signal: AbortSignal.timeout(10_000) });
    if (response.status === 429 && attempt < JUPITER_RETRIES) {
      await response.body?.cancel();
      await sleep(1_000 * 2 ** attempt);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GET ${new URL(url).pathname} → ${response.status}`);
    }
    return response.json();
  }
}

/** Effective multiplier from Jupiter's copy of the mint's ScaledUiAmount config. */
function jupiterMultiplier(price: JupiterPrice, nowMs: number): number | null {
  const config = price.scaledUiConfig;
  if (!config?.multiplier) return null;
  const at = config.newMultiplierEffectiveAt ? Date.parse(config.newMultiplierEffectiveAt) : Number.NaN;
  return config.newMultiplier && Number.isFinite(at) && nowMs >= at ? config.newMultiplier : config.multiplier;
}

const priceCache = new Map<string, { at: number; usdPrescaled: number | null }>();
const priceInflight = new Map<string, Promise<void>>();

/** The registry entry's price mint stands in for it raw unit for raw unit. */
function priceMintOf(mint: string): string {
  return quoteByMint(mint)?.priceMint ?? mint;
}

/**
 * Refreshes in batches; a batch Jupiter refuses (e.g. a 429 that outlasted the
 * retries) leaves those mints' last known prices in place instead of failing
 * every other batch with it.
 */
async function refreshPrices(mints: string[]): Promise<void> {
  const ids = [...new Set(mints.map(priceMintOf))];
  const prices: Record<string, JupiterPrice> = {};
  const answered = new Set<string>();
  for (let i = 0; i < ids.length; i += JUPITER_MAX_IDS) {
    const batch = ids.slice(i, i + JUPITER_MAX_IDS);
    try {
      Object.assign(prices, (await jupiterJson(`${env.jupiterPriceUrl}?ids=${batch.join(",")}`)) as Record<string, JupiterPrice>);
      for (const id of batch) answered.add(id);
    } catch (error) {
      console.warn(`Jupiter price batch ${i / JUPITER_MAX_IDS + 1} failed:`, error);
    }
  }
  const now = Date.now();
  for (const mint of mints) {
    if (!answered.has(priceMintOf(mint))) continue;
    const price = prices[priceMintOf(mint)];
    const registry = quoteByMint(mint);
    let usdPrescaled: number | null = null;
    if (price?.usdPrice && price.usdPrice > 0) {
      const multiplier = jupiterMultiplier(price, now) ?? registry?.uiMultiplier ?? 1;
      usdPrescaled = price.scaledUiConfig?.usdPricePrescaled ?? price.usdPrice * multiplier;
    }
    priceCache.set(mint, { at: now, usdPrescaled });
  }
}

/**
 * USD per 10^decimals base units for each mint, keyed by mint; a mint Jupiter
 * cannot price maps to null. Cached for 30 s, concurrent callers share one
 * request, and a Jupiter outage serves the last known prices (or null).
 */
export async function usdPrices(mints: readonly string[]): Promise<Map<string, number | null>> {
  const unique = [...new Set(mints)];
  const stale = unique.filter((mint) => {
    const hit = priceCache.get(mint);
    return !hit || Date.now() - hit.at > PRICE_TTL_MS;
  });
  if (stale.length > 0) {
    const key = stale.sort().join(",");
    let job = priceInflight.get(key);
    if (!job) {
      job = refreshPrices(stale)
        .catch((error: unknown) => console.warn("Jupiter price refresh failed:", error))
        .finally(() => priceInflight.delete(key));
      priceInflight.set(key, job);
    }
    await job;
  }
  return new Map(unique.map((mint) => [mint, priceCache.get(mint)?.usdPrescaled ?? null]));
}

export async function usdPrice(mint: string): Promise<number | null> {
  return (await usdPrices([mint])).get(mint) ?? null;
}

/** `raw` base units of a quote in USD, or null without a price. */
export function rawToUsd(raw: bigint | string | number, decimals: number, usdPrice: number | null): number | null {
  if (usdPrice === null) return null;
  return (Number(BigInt(raw.toString())) / 10 ** decimals) * usdPrice;
}

// --- logos (Jupiter token API) ---------------------------------------------

const TokenSearch = z.array(z.object({ id: z.string(), icon: z.string().nullable().optional() }));
const LOGO_TTL_MS = 24 * 60 * 60_000;
let logoCache: { at: number; logos: Map<string, string> } | null = null;
let logoInflight: Promise<Map<string, string>> | null = null;

const httpsUrl = (url: string | null | undefined) => (url && /^https:\/\//.test(url) ? url : null);

/** Jupiter's icon for every registry quote whose own logo is not an absolute https URL. */
async function jupiterLogos(): Promise<Map<string, string>> {
  if (logoCache && Date.now() - logoCache.at < LOGO_TTL_MS) return logoCache.logos;
  logoInflight ??= (async () => {
    const missing = QUOTES.filter((token) => !httpsUrl(token.logoUrl)).map((token) => token.mint);
    const logos = new Map<string, string>();
    for (let i = 0; i < missing.length; i += JUPITER_MAX_IDS) {
      const batch = missing.slice(i, i + JUPITER_MAX_IDS);
      const found = TokenSearch.parse(await jupiterJson(`https://lite-api.jup.ag/tokens/v2/search?query=${batch.join(",")}`));
      for (const token of found) {
        const icon = httpsUrl(token.icon);
        if (icon) logos.set(token.id, icon);
      }
    }
    logoCache = { at: Date.now(), logos };
    return logos;
  })()
    .catch((error: unknown) => {
      console.warn("Jupiter token logos unavailable:", error);
      return logoCache?.logos ?? new Map<string, string>();
    })
    .finally(() => {
      logoInflight = null;
    });
  return logoInflight;
}

// --- QuoteInfo -----------------------------------------------------------

/** Display fields of a quote, without the price. */
export type QuoteDisplay = Omit<QuoteInfo, "usdPrice">;

function fromRegistry(token: QuoteToken, logos: Map<string, string>): QuoteDisplay {
  return {
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    tokenProgram: token.tokenProgram,
    category: token.category,
    logoUrl: httpsUrl(token.logoUrl) ?? logos.get(token.mint) ?? null,
  };
}

const displayCache = new Map<string, QuoteDisplay>();

/**
 * Display fields for any quote mint: the registry's, else what the mint
 * account itself says. Never fails for a mint that exists, so a pool is
 * always presentable.
 */
export async function quoteDisplay(mint: string): Promise<QuoteDisplay> {
  const registry = quoteByMint(mint);
  if (registry) return fromRegistry(registry, await jupiterLogos());
  const cached = displayCache.get(mint);
  if (cached) return cached;
  const info = await connection.getAccountInfo(new PublicKey(mint));
  if (!info) throw new Error(`quote mint ${mint} does not exist`);
  const display: QuoteDisplay = {
    mint,
    symbol: `${mint.slice(0, 4)}…`,
    name: mint,
    decimals: info.data[44] ?? 0,
    tokenProgram: info.owner.toBase58(),
    category: "community",
    logoUrl: null,
  };
  displayCache.set(mint, display);
  return display;
}

/** Attach live USD prices to display rows. */
export async function withPrices(displays: readonly QuoteDisplay[]): Promise<QuoteInfo[]> {
  const prices = await usdPrices(displays.map((display) => display.mint));
  return displays.map((display) => ({ ...display, usdPrice: prices.get(display.mint) ?? null }));
}

export async function quoteInfo(mint: string): Promise<QuoteInfo> {
  const [info] = await withPrices([await quoteDisplay(mint)]);
  return info!;
}

/**
 * The quotes a coin can launch against: every registry quote with a LaunchLab
 * GlobalConfig that Jupiter can price (the raise of a non-SOL pair is sized
 * from it). SOL is always launchable.
 */
export async function launchableQuotes(): Promise<QuoteInfo[]> {
  const logos = await jupiterLogos();
  const quotes = await withPrices(QUOTES.map((token) => fromRegistry(token, logos)));
  return quotes.filter((quote) => quote.mint === NATIVE_MINT.toBase58() || quote.usdPrice !== null);
}

// --- curve parameters ----------------------------------------------------

/** Every IMAGINE coin: 1,000,000,000 tokens at 6 decimals… */
export const CURVE_SUPPLY = 1_000_000_000_000_000n;
/** …79.31% of them sold on the curve; the rest seed the CPMM pool at graduation. */
export const CURVE_TOTAL_SELL = 793_100_000_000_000n;
/** A SOL pair raises 85 SOL; every other pair raises the same USD value at launch time. */
export const SOL_RAISE_LAMPORTS = 85_000_000_000n;
const COIN_DECIMALS = 6;

export interface LaunchCurve {
  quoteMint: PublicKey;
  /** The quote's LaunchLab GlobalConfig. */
  globalConfig: PublicKey;
  supply: bigint;
  totalSell: bigint;
  /** `total_quote_fund_raising`, quote base units. */
  fundRaising: bigint;
  baseDecimals: number;
}

/** Keep the top four significant digits: a raise of 1,114,174,332 becomes 1,114,000,000. */
function roundSignificant(value: bigint, digits = 4): bigint {
  const length = value.toString().length;
  if (length <= digits) return value;
  const unit = 10n ** BigInt(length - digits);
  return ((value + unit / 2n) / unit) * unit;
}

/**
 * The curve a coin paired with `quoteMint` launches on: our fixed shape
 * (supply, 79.31% sold), and a raise of 85 SOL — or, for any other quote, the
 * USD value of 85 SOL right now in that quote, rounded and never below the
 * GlobalConfig's own minimum. LaunchLab validates the rest at `initialize`.
 */
export async function launchCurve(quoteMint: PublicKey): Promise<LaunchCurve> {
  const registry = quoteByMint(quoteMint);
  if (!registry) throw new Error(`${quoteMint.toBase58()} is not a LaunchLab quote in the registry`);
  const globalConfig = new PublicKey(registry.globalConfig);
  const info = await connection.getAccountInfo(globalConfig);
  if (!info) throw new Error(`LaunchLab GlobalConfig ${globalConfig.toBase58()} for ${registry.symbol} not found`);
  const global = decodeGlobalConfig(info.data);
  if (!global.quoteMint.equals(quoteMint)) throw new Error(`GlobalConfig ${globalConfig.toBase58()} is for another quote`);

  let fundRaising: bigint;
  if (quoteMint.equals(NATIVE_MINT)) {
    fundRaising = SOL_RAISE_LAMPORTS;
  } else {
    const prices = await usdPrices([NATIVE_MINT.toBase58(), quoteMint.toBase58()]);
    const sol = prices.get(NATIVE_MINT.toBase58());
    const quote = prices.get(quoteMint.toBase58());
    if (!sol || !quote) throw new Error(`no USD price for ${registry.symbol} right now; the raise cannot be sized`);
    const usd = (Number(SOL_RAISE_LAMPORTS) / 1e9) * sol;
    fundRaising = roundSignificant(BigInt(Math.round((usd / quote) * 10 ** registry.decimals)));
  }
  if (fundRaising < global.minQuoteFundRaising) fundRaising = global.minQuoteFundRaising;
  return {
    quoteMint,
    globalConfig,
    supply: CURVE_SUPPLY,
    totalSell: CURVE_TOTAL_SELL,
    fundRaising,
    baseDecimals: COIN_DECIMALS,
  };
}
