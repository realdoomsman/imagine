import { createHash, randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

/**
 * A missing auth secret is fatal, not replaced with a throwaway one, in any
 * production process and in anything pointed at mainnet whatever NODE_ENV
 * says: an ephemeral key there would create wallets nobody can decrypt after
 * the next restart.
 */
const secretsRequired = process.env.NODE_ENV === "production" || process.env.CLUSTER === "mainnet-beta";

const keys = new Map<string, Buffer>();

/**
 * A 32-byte key from an env string, read on first use so the roles that never
 * touch accounts (indexer, migrate) never need it. Accepts 64 hex chars
 * exactly; anything else is hashed, so a long random passphrase also works.
 * Absent in development only: accounts then run on a random key that will not
 * survive a restart, and the log says so. Memoised, so that key is at least
 * stable for the life of the process.
 */
function keyFromEnv(name: string): Buffer {
  const cached = keys.get(name);
  if (cached) return cached;
  const raw = process.env[name];
  let key: Buffer;
  if (!raw) {
    if (secretsRequired) throw new Error(`missing required env var ${name}`);
    console.warn(`${name} not set; using an ephemeral development key`);
    key = randomBytes(32);
  } else if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = createHash("sha256").update(raw).digest();
  }
  keys.set(name, key);
  return key;
}

/** A string secret, read on first use; required where `secretsRequired`. */
function secretFromEnv(name: string): string {
  const raw = process.env[name];
  if (!raw && secretsRequired) throw new Error(`missing required env var ${name}`);
  return raw ?? "";
}

/** An absolute http(s) origin with no trailing slash. */
function origin(name: string, fallback: string): string {
  const raw = (process.env[name] ?? fallback).trim().replace(/\/+$/, "");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must be an http(s) origin`);
  return url.origin;
}

/**
 * Config is read once at boot and validated eagerly: a bad treasury address or
 * fee value should crash the process on deploy, not produce a broken
 * transaction for a user hours later. The auth secrets are the exception:
 * they load on first use, and the API checks them at its own boot
 * (`assertApiEnv`).
 */
export const env = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "",
  rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8999",
  wsUrl: process.env.RPC_WS_URL ?? "",
  /**
   * StonkFun is mainnet-only, so IMAGINE runs on mainnet-beta or on a local
   * mainnet fork (scripts/mainnet-fork.sh), which carries the same programs
   * and accounts at the same addresses.
   */
  cluster: (process.env.CLUSTER ?? "localnet") as "localnet" | "mainnet-beta",
  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
  /**
   * Where this API is reachable from the public internet. Coin metadata and
   * images are served from here, and their URIs are written on chain into the
   * mint at launch, so this must be the stable public origin
   * (https://api.imagine.fun in production).
   */
  apiPublicOrigin: origin("API_PUBLIC_ORIGIN", "http://localhost:8080"),
  /** StonkFun's public API (launchable pairs, curve pricing). */
  stonkfunApi: origin("STONKFUN_API", "https://www.stonkfun.xyz"),
  /** Jupiter Swap API v1 (SOL → quote swaps for buyers paying in SOL). */
  jupiterSwapUrl: (process.env.JUPITER_SWAP_URL ?? "https://lite-api.jup.ag/swap/v1").replace(/\/+$/, ""),
  /** Jupiter Price API v3 (USD prices of quote assets). */
  jupiterPriceUrl: (process.env.JUPITER_PRICE_URL ?? "https://lite-api.jup.ag/price/v3").replace(/\/+$/, ""),
  /** Required only with an api.jup.ag base URL; the lite API is keyless. */
  jupiterApiKey: process.env.JUPITER_API_KEY ?? "",
  /**
   * The keeper signs the permissionless cranks — pool syncs, matured unlocks,
   * capped-lock harvests, treasury claims. Optional: without it the indexer
   * runs read-only and someone else has to crank, which nobody does promptly.
   */
  keeperKeypair: process.env.KEEPER_KEYPAIR ?? "",
  /** Sync a pool once its unsynced reward balance is worth at least this many USD. */
  syncMinUsd: Number(process.env.SYNC_MIN_USD ?? 1),
  keeperIntervalMs: Number(process.env.KEEPER_INTERVAL_MS ?? 60_000),
  /**
   * Address lookup table holding the static accounts of a launch (programs,
   * StonkFun platform, per-quote LaunchLab configs; scripts/create-alt.ts).
   * It lets imagine.launch, the dev buy and imagine.found share one
   * transaction. Unset: the launch is split in two and the dev buy is exposed
   * to anyone buying between them.
   */
  launchAlt: process.env.LAUNCH_ALT ? new PublicKey(process.env.LAUNCH_ALT) : null,

  /** Google OAuth web client; the ID token audience. */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  get googleClientSecret(): string {
    return secretFromEnv("GOOGLE_CLIENT_SECRET");
  },
  /** Must match an authorised redirect URI on the OAuth client, exactly. */
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:8080/api/auth/google/callback",
  /** Where the browser is sent after a login completes; the site's origin. */
  siteOrigin: process.env.SITE_ORIGIN ?? "http://localhost:3000",
  /** Encrypts account wallet secrets at rest. Losing it loses the wallets. */
  get walletMasterKey(): Buffer {
    return keyFromEnv("WALLET_MASTER_KEY");
  },
  /** Signs session cookies. */
  get sessionSecret(): Buffer {
    return keyFromEnv("SESSION_SECRET");
  },
  /** Cross-site cookies need Secure, which needs HTTPS; off for the local rig. */
  cookieSecure: (process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === "production" ? "1" : "0")) === "1",
} as const;

/**
 * What only the HTTP role needs, checked when it boots so a misconfigured
 * deploy crashes there instead of at the first sign-in.
 */
export function assertApiEnv() {
  void env.walletMasterKey;
  void env.sessionSecret;
  void env.googleClientSecret;
  if (env.cluster === "mainnet-beta" && (!process.env.CORS_ORIGINS?.trim() || env.corsOrigins.includes("*"))) {
    throw new Error("CORS_ORIGINS must list the site's origins on mainnet-beta; unset or * is refused");
  }
  if (env.cluster === "mainnet-beta" && !env.apiPublicOrigin.startsWith("https://")) {
    throw new Error("API_PUBLIC_ORIGIN must be an https origin on mainnet-beta: coin metadata URIs point at it");
  }
}

export { required };
