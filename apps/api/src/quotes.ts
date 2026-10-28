import { setTimeout as sleep } from "node:timers/promises";
import { PublicKey } from "@solana/web3.js";
import { QUOTES, quoteByMint, type QuoteToken } from "@imagine/sdk";
import { z } from "zod";
import { env } from "./env.ts";
import { connection } from "./solana.ts";

/**
 * Quote assets: what a StonkFun coin is paired with, and what its lockers are
 * paid in.
 *
 * Three sources, each for what it is authoritative on:
 *  - the SDK registry (`QUOTES`): vetted quotes with their LaunchLab
 *    GlobalConfig, decimals, token program and display art;
 *  - StonkFun's public API: which pairs are launchable right now, and the
 *    curve parameters its curve rule accepts for each;
 *  - Jupiter's Price API v3: USD prices.
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

// --- StonkFun public API ---------------------------------------------------

const PairSchema = z.object({
  mint: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int(),
  logoUrl: z.string().nullable().optional(),
  category: z.string(),
  tokenProgram: z.string(),
  launchable: z.boolean().optional(),
  launchLabReady: z.boolean().optional(),
});
type StonkFunPair = z.infer<typeof PairSchema>;

const PairsResponse = z.object({ data: z.object({ pairs: z.array(PairSchema) }) });

const PAIRS_TTL_MS = 10 * 60_000;
let pairsCache: { at: number; pairs: Map<string, StonkFunPair> } | null = null;
let pairsInflight: Promise<Map<string, StonkFunPair>> | null = null;

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "imagine.fun" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`GET ${url} → ${response.status}`);
  }
  return response.json();
}

/** StonkFun's launchable, LaunchLab-ready pairs by mint (cached; the last good copy survives an outage). */
export async function stonkfunPairs(): Promise<Map<string, StonkFunPair>> {
  if (pairsCache && Date.now() - pairsCache.at < PAIRS_TTL_MS) return pairsCache.pairs;
  pairsInflight ??= getJson(`${env.stonkfunApi}/api/public/v1/pairs?launchable=true&launchLabReady=true`)
    .then((body) => {
      const pairs = new Map(PairsResponse.parse(body).data.pairs.map((pair) => [pair.mint, pair]));
      pairsCache = { at: Date.now(), pairs };
      return pairs;
    })
    .catch((error: unknown) => {
      if (pairsCache) {
        console.warn(`StonkFun pairs refresh failed, serving the copy from ${new Date(pairsCache.at).toISOString()}:`, error);
        return pairsCache.pairs;
      }
      throw error;
    })
    .finally(() => {
      pairsInflight = null;
    });
  return pairsInflight;
}

const u64String = z.string().regex(/^\d+$/);

/** What a launch needs from StonkFun's pricing endpoint. Validated: everything here goes on chain. */
const PricingResponse = z.object({
  data: z.object({
    quote: z.object({ mint: z.string(), decimals: z.number().int() }),
    raise: z.object({ raw: u64String }),
    curve: z.object({
      programId: z.string(),
      configId: z.string(),
      migrateType: z.string(),
      baseDecimals: z.number().int(),
      supply: u64String,
      totalSellA: u64String,
      vesting: z.object({ totalLockedAmount: u64String }),
    }),
    platform: z.object({ standard: z.string() }),
    allowConfig: z.object({
      available: z.object({ standard: z.boolean() }).nullable(),
      standard: z.string(),
    }),
    curveRule: z.object({ standard: z.string() }),
  }),
});

export interface LaunchPricing {
  quoteMint: PublicKey;
  /** LaunchLab GlobalConfig the coin launches under. */
  globalConfig: PublicKey;
  platform: PublicKey;
  allowConfig: PublicKey;
  curveRule: PublicKey;
  supply: bigint;
  totalSell: bigint;
  /** The raise (`total_quote_fund_raising`), quote base units. */
  fundRaising: bigint;
  baseDecimals: number;
  /** StonkFun's platform accepts this quote right now. */
  available: boolean;
}

const PRICING_TTL_MS = 60_000;
const pricingCache = new Map<string, { at: number; value: LaunchPricing }>();

/**
 * StonkFun's curve parameters for a launch paired with `quoteMint`: the raise
 * is sized there so every pair launches at the same USD value, and StonkFun's
 * on-chain curve rule only accepts parameters of that shape.
 */
export async function launchPricing(quoteMint: PublicKey): Promise<LaunchPricing> {
  const key = quoteMint.toBase58();
  const hit = pricingCache.get(key);
  if (hit && Date.now() - hit.at < PRICING_TTL_MS) return hit.value;
  const { data } = PricingResponse.parse(
    await getJson(`${env.stonkfunApi}/api/public/v1/launchlab/pricing?quoteMint=${key}`),
  );
  if (data.quote.mint !== key) throw new Error(`StonkFun priced ${data.quote.mint}, not ${key}`);
  if (data.curve.migrateType !== "cpmm") throw new Error(`StonkFun curve for ${key} migrates to ${data.curve.migrateType}, not CPMM`);
  if (data.curve.vesting.totalLockedAmount !== "0") throw new Error(`StonkFun curve for ${key} carries vesting`);
  const value: LaunchPricing = {
    quoteMint,
    globalConfig: new PublicKey(data.curve.configId),
    platform: new PublicKey(data.platform.standard),
    allowConfig: new PublicKey(data.allowConfig.standard),
    curveRule: new PublicKey(data.curveRule.standard),
    supply: BigInt(data.curve.supply),
    totalSell: BigInt(data.curve.totalSellA),
    fundRaising: BigInt(data.raise.raw),
    baseDecimals: data.curve.baseDecimals,
    available: data.allowConfig.available?.standard ?? false,
  };
  pricingCache.set(key, { at: Date.now(), value });
  return value;
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

/** Effective multiplier from Jupiter's copy of the mint's ScaledUiAmount config. */
function jupiterMultiplier(price: JupiterPrice, nowMs: number): number | null {
  const config = price.scaledUiConfig;
  if (!config?.multiplier) return null;
  const at = config.newMultiplierEffectiveAt ? Date.parse(config.newMultiplierEffectiveAt) : Number.NaN;
  return config.newMultiplier && Number.isFinite(at) && nowMs >= at ? config.newMultiplier : config.multiplier;
}

async function fetchJupiterPrices(ids: string[]): Promise<Record<string, JupiterPrice>> {
  const headers: Record<string, string> = env.jupiterApiKey ? { "x-api-key": env.jupiterApiKey } : {};
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${env.jupiterPriceUrl}?ids=${ids.join(",")}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 429 && attempt < JUPITER_RETRIES) {
      await response.body?.cancel();
      await sleep(1_000 * 2 ** attempt);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Jupiter price API ${response.status}`);
    }
    return (await response.json()) as Record<string, JupiterPrice>;
  }
}

const priceCache = new Map<string, { at: number; usdPrescaled: number | null }>();
const priceInflight = new Map<string, Promise<void>>();

/** The registry entry's price mint stands in for it raw unit for raw unit. */
function priceMintOf(mint: string): string {
  return quoteByMint(mint)?.priceMint ?? mint;
}

async function refreshPrices(mints: string[]): Promise<void> {
  const ids = [...new Set(mints.map(priceMintOf))];
  const prices: Record<string, JupiterPrice> = {};
  for (let i = 0; i < ids.length; i += JUPITER_MAX_IDS) {
    Object.assign(prices, await fetchJupiterPrices(ids.slice(i, i + JUPITER_MAX_IDS)));
  }
  const now = Date.now();
  for (const mint of mints) {
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

// --- QuoteInfo -----------------------------------------------------------

/** A StonkFun logo path is relative to its own origin. */
function absoluteLogo(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, env.stonkfunApi).href;
  } catch {
    return null;
  }
}

/** Display fields of a quote, without the price. */
export type QuoteDisplay = Omit<QuoteInfo, "usdPrice">;

function fromRegistry(token: QuoteToken, pair: StonkFunPair | undefined): QuoteDisplay {
  return {
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    tokenProgram: token.tokenProgram,
    category: token.category,
    // The registry's house art is a path on Backstock's own site; an absolute
    // URL (the registry's, else StonkFun's) is what any client can load.
    logoUrl: token.logoUrl?.startsWith("http") ? token.logoUrl : (absoluteLogo(pair?.logoUrl) ?? null),
  };
}

const displayCache = new Map<string, QuoteDisplay>();

/**
 * Display fields for any quote mint: the registry's, else StonkFun's pair
 * listing, else what the mint account itself says. Never fails for a mint
 * that exists, so a pool is always presentable.
 */
export async function quoteDisplay(mint: string): Promise<QuoteDisplay> {
  const registry = quoteByMint(mint);
  const pair = await stonkfunPairs().then((pairs) => pairs.get(mint)).catch(() => undefined);
  if (registry) return fromRegistry(registry, pair);
  if (pair) {
    return {
      mint,
      symbol: pair.symbol,
      name: pair.name,
      decimals: pair.decimals,
      tokenProgram: pair.tokenProgram,
      category: "community",
      logoUrl: absoluteLogo(pair.logoUrl),
    };
  }
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
 * The quotes a coin can launch against here: vetted registry quotes that
 * StonkFun lists as launchable and LaunchLab-ready right now. If StonkFun's
 * listing has never loaded since boot, the registry alone answers — it was
 * generated from that same listing — and the launch itself re-checks the
 * pair against the pricing endpoint before anything is signed.
 */
export async function launchableQuotes(): Promise<QuoteInfo[]> {
  const pairs = await stonkfunPairs().catch((error: unknown) => {
    console.warn("StonkFun pairs unavailable; serving the registry:", error);
    return null;
  });
  const tokens = pairs ? QUOTES.filter((token) => pairs.has(token.mint)) : [...QUOTES];
  return withPrices(tokens.map((token) => fromRegistry(token, pairs?.get(token.mint))));
}
