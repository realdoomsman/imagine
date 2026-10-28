import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getPausableConfig,
  getPermanentDelegate,
  getScaledUiAmountConfig,
  getTransferFeeConfig,
  getTransferHook,
  unpackMint,
} from "@solana/spl-token";
import mainnetQuotes from "./quotes/mainnet.json" with { type: "json" };

/**
 * Quote assets IMAGINE coins raise in and trade against on LaunchLab (one GlobalConfig each): names,
 * logos, picker category, issuer risk flags and the Pyth fallback feed. `quotes/mainnet.json` is the
 * registry; what was left out and why is in `quotes/mainnet-excluded.json`.
 */

/** Who stands behind the token: drives the issuer chip. `other` = no issuer chip (crypto, community tokens). */
export type QuoteIssuer = "native" | "stable" | "xstocks" | "ondo" | "backpack" | "other";
export const QUOTE_ISSUERS: readonly QuoteIssuer[] = ["native", "stable", "xstocks", "ondo", "backpack", "other"];

/** Picker tab of a quote (tokenized ETFs and commodities split out of stocks). */
export type QuoteCategory = "crypto" | "currencies" | "stocks" | "etfs" | "commodities" | "leverage" | "baskets" | "collectibles" | "community";
/** Every category in picker order, with its tab label. */
export const QUOTE_CATEGORIES: readonly { id: QuoteCategory; label: string }[] = [
  { id: "crypto", label: "Crypto" },
  { id: "currencies", label: "Currencies" },
  { id: "stocks", label: "Stocks" },
  { id: "etfs", label: "ETFs" },
  { id: "commodities", label: "Commodities" },
  { id: "leverage", label: "Leverage" },
  { id: "baskets", label: "Baskets" },
  { id: "collectibles", label: "Collectibles" },
  { id: "community", label: "Community" },
];

/** Issuer powers over every holder's balance, vaults included. */
export interface QuoteRisk {
  /** The issuer can move or burn tokens out of any account. */
  permanentDelegate: boolean;
  /** The issuer can halt every transfer (trades and payouts fail while paused). */
  pausable: boolean;
  /** The issuer can freeze a single account. */
  freezable: boolean;
}

export interface QuoteToken {
  /** Base58 addresses throughout, so the registry round-trips through JSON. */
  mint: string;
  /** Display symbol ("SOL" for the WSOL quote). */
  symbol: string;
  name: string;
  decimals: number;
  /** Owner program of the mint: SPL Token or Token-2022. */
  tokenProgram: string;
  /** LaunchLab GlobalConfig (curve type 0, index 0) of this quote. */
  globalConfig: string;
  issuer: QuoteIssuer;
  category: QuoteCategory;
  /** Jupiter lists the token as verified. */
  verified: boolean;
  /** The issuer's or Jupiter's logo image; null when the registry has none. */
  logoUrl: string | null;
  /**
   * ScaledUiAmount multiplier (UI = raw × multiplier) when the registry was written; 1 for mints
   * without the extension. Read the live value with `readUiMultiplier` — all accounting stays raw.
   */
  uiMultiplier: number;
  /** Pyth Hermes feed id (hex, no 0x) of this mint's per-UI-token USD price, used when Jupiter has no price. */
  pythFeedId?: string;
  /** Mint whose USD price stands in for this quote's, raw unit for raw unit (same decimals). */
  priceMint?: string;
  risk: QuoteRisk;
}

export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const WSOL = WSOL_MINT.toBase58();
const T22 = TOKEN_2022_PROGRAM_ID.toBase58();
const SPL = TOKEN_PROGRAM_ID.toBase58();
const CATEGORY_IDS: readonly string[] = QUOTE_CATEGORIES.map((c) => c.id);

/** Category of an entry without one: stables are currencies, issuer-backed equities are stocks, the rest crypto. */
function defaultCategory(issuer: QuoteIssuer): QuoteCategory {
  if (issuer === "stable") return "currencies";
  if (issuer === "xstocks" || issuer === "ondo" || issuer === "backpack") return "stocks";
  return "crypto";
}

/**
 * Validates a registry (an array of `QuoteToken`-shaped entries; `logo` or `logoUrl` for the image):
 * addresses must be valid pubkeys, the token program SPL Token or Token-2022, decimals and multiplier
 * sane, issuer and category known, mints unique.
 */
function parseQuotes(raw: unknown, source: string): QuoteToken[] {
  if (!Array.isArray(raw)) throw new Error(`${source} must be a JSON array`);
  const seen = new Set<string>();
  return raw.map((q: Record<string, unknown>, i) => {
    const where = `${source}[${i}]`;
    const str = (k: string) => {
      const v = q[k];
      if (typeof v !== "string" || v === "") throw new Error(`${where}.${k} must be a non-empty string`);
      return v;
    };
    const key = (k: string) => new PublicKey(str(k)).toBase58();
    const mint = key("mint");
    if (seen.has(mint)) throw new Error(`${where}: duplicate mint ${mint}`);
    seen.add(mint);
    const tokenProgram = key("tokenProgram");
    if (tokenProgram !== SPL && tokenProgram !== T22) throw new Error(`${where}.tokenProgram must be SPL Token or Token-2022`);
    const decimals = q.decimals;
    if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error(`${where}.decimals invalid`);
    const uiMultiplier = q.uiMultiplier ?? 1;
    if (typeof uiMultiplier !== "number" || !(uiMultiplier > 0)) throw new Error(`${where}.uiMultiplier must be positive`);
    const issuer = str("issuer") as QuoteIssuer;
    if (!QUOTE_ISSUERS.includes(issuer)) throw new Error(`${where}.issuer must be one of ${QUOTE_ISSUERS.join(", ")}`);
    const category = (q.category ?? defaultCategory(issuer)) as QuoteCategory;
    if (!CATEGORY_IDS.includes(category)) throw new Error(`${where}.category must be one of ${CATEGORY_IDS.join(", ")}`);
    const risk = (q.risk ?? {}) as Record<string, unknown>;
    const logo = q.logoUrl ?? q.logo;
    return {
      mint,
      symbol: str("symbol"),
      name: str("name"),
      decimals,
      tokenProgram,
      globalConfig: key("globalConfig"),
      issuer,
      category,
      verified: q.verified === true,
      logoUrl: typeof logo === "string" && logo !== "" ? logo : null,
      uiMultiplier,
      pythFeedId: typeof q.pythFeedId === "string" && q.pythFeedId !== "" ? q.pythFeedId.replace(/^0x/, "") : undefined,
      priceMint: typeof q.priceMint === "string" && q.priceMint !== "" ? new PublicKey(q.priceMint).toBase58() : undefined,
      risk: { permanentDelegate: risk.permanentDelegate === true, pausable: risk.pausable === true, freezable: risk.freezable === true },
    };
  });
}

/** Parses and validates a JSON registry override (see `parseQuotes`). */
export function parseQuotesJson(text: string): QuoteToken[] {
  return parseQuotes(JSON.parse(text), "QUOTES_JSON");
}

/** The mainnet registry. */
export const QUOTES: readonly QuoteToken[] = parseQuotes(mainnetQuotes, "quotes/mainnet.json");

const byMint = new WeakMap<readonly QuoteToken[], Map<string, QuoteToken>>();

/** Registry lookup by mint (indexed once per registry array; registries are never mutated). */
export function findQuote(registry: readonly QuoteToken[], mint: PublicKey | string): QuoteToken | undefined {
  let index = byMint.get(registry);
  if (!index || index.size !== registry.length) {
    index = new Map(registry.map((q) => [q.mint, q]));
    byMint.set(registry, index);
  }
  return index.get(typeof mint === "string" ? mint : mint.toBase58());
}

/** `QUOTES` lookup by mint. */
export function quoteByMint(mint: PublicKey | string): QuoteToken | undefined {
  return findQuote(QUOTES, mint);
}

/** WSOL as a quote: deposits and buys wrap SOL first. */
export function isNativeQuote(mint: PublicKey | string): boolean {
  return (typeof mint === "string" ? mint : mint.toBase58()) === WSOL;
}

function mintOf(data: Buffer | Uint8Array) {
  const info: AccountInfo<Buffer> = {
    data: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    owner: data.byteLength > 82 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    lamports: 0,
    executable: false,
  };
  return unpackMint(PublicKey.default, info, info.owner);
}

/**
 * Effective ScaledUiAmount multiplier of a mint account (`now ≥ newMultiplierEffectiveTimestamp ?
 * newMultiplier : multiplier`); 1 for mints without the extension (SPL Token mints included).
 */
export function readUiMultiplier(mintAccountData: Buffer | Uint8Array, nowSec = Math.floor(Date.now() / 1000)): number {
  const cfg = getScaledUiAmountConfig(mintOf(mintAccountData));
  if (!cfg) return 1;
  return BigInt(nowSec) >= cfg.newMultiplierEffectiveTimestamp ? cfg.newMultiplier : cfg.multiplier;
}

/** Live issuer powers of a mint, plus the transfer behaviours that break plain transfers. */
export interface MintRisk extends QuoteRisk {
  /** A transfer-hook program is set: transfers would need its accounts. */
  transferHookActive: boolean;
  /** Current transfer fee, basis points (0 without the extension). */
  transferFeeBps: number;
  /** The issuer has paused the mint right now. */
  paused: boolean;
}

export function readMintRisk(mintAccountData: Buffer | Uint8Array): MintRisk {
  const mint = mintOf(mintAccountData);
  const pausable = getPausableConfig(mint);
  const hook = getTransferHook(mint);
  const fee = getTransferFeeConfig(mint);
  return {
    permanentDelegate: getPermanentDelegate(mint) !== null,
    pausable: pausable !== null,
    freezable: mint.freezeAuthority !== null,
    transferHookActive: hook !== null && !hook.programId.equals(PublicKey.default),
    transferFeeBps: fee ? Math.max(fee.olderTransferFee.transferFeeBasisPoints, fee.newerTransferFee.transferFeeBasisPoints) : 0,
    paused: pausable?.paused ?? false,
  };
}

/**
 * Why a mint fails plain transfers (by raw TLV scan): a transfer fee (older or newer rate) or a fee
 * config authority, an active transfer-hook program, frozen-by-default accounts, non-transferable.
 * Empty = plain.
 */
export function quoteMintViolations(mintAccountData: Buffer | Uint8Array): string[] {
  const d = mintAccountData;
  const out: string[] = [];
  if (d.length <= 82) return out;
  const u16 = (at: number) => (d[at] ?? 0) | ((d[at + 1] ?? 0) << 8);
  const nonZero = (from: number, to: number) => d.subarray(from, to).some((b) => b !== 0);
  for (let at = 166; at + 4 <= d.length; ) {
    const type = u16(at);
    const len = u16(at + 2);
    if (type === 0) break;
    const v = at + 4;
    if (v + len > d.length) return [...out, "malformed extension data"];
    if (type === 1) {
      // TransferFeeConfig { config authority 32, withdraw authority 32, withheld 8, older { epoch 8, max 8, bps 2 }, newer { … } }
      const bps = Math.max(u16(v + 88), u16(v + 106));
      if (nonZero(v, v + 32) || bps > 0) out.push(`transfer fee ${bps} bps${nonZero(v, v + 32) ? " (fee authority set)" : ""}`);
    } else if (type === 14 && nonZero(v + 32, v + 64)) out.push("transfer hook program active");
    else if (type === 6 && d[v] === 2) out.push("new accounts frozen by default");
    else if (type === 9) out.push("non-transferable");
    at = v + len;
  }
  return out;
}
