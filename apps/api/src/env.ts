import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

/**
 * A 32-byte key from an env string. Accepts 64 hex chars exactly; anything
 * else is hashed, so a long random passphrase also works. Absent in
 * development only: accounts then run on a throwaway key that will not
 * survive a restart, and the log says so.
 */
function keyFromEnv(name: string): Buffer {
  const raw = process.env[name];
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error(`missing required env var ${name}`);
    console.warn(`${name} not set; using an ephemeral development key`);
    return createHash("sha256").update(`dev:${name}:${process.pid}`).digest();
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}
/**
 * Config is read once at boot and validated eagerly: a bad treasury address or
 * fee value should crash the process on deploy, not produce a broken
 * transaction for a user hours later.
 */
export const env = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "",
  rpcUrl: process.env.RPC_URL ?? "https://api.devnet.solana.com",
  wsUrl: process.env.RPC_WS_URL ?? "",
  cluster: (process.env.CLUSTER ?? "devnet") as "devnet" | "mainnet-beta",
  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
  pinataJwt: process.env.PINATA_JWT ?? "",
  /**
   * The keeper signs the permissionless cranks — pump fee distribution and
   * pool syncs. Optional: without it the indexer runs read-only and someone
   * else has to crank, which nobody does promptly.
   */
  keeperKeypair: process.env.KEEPER_KEYPAIR ?? "",
  /** Only sweep a coin once its pump vault holds at least this much. */
  sweepMinLamports: BigInt(process.env.SWEEP_MIN_LAMPORTS ?? 5_000_000),
  keeperIntervalMs: Number(process.env.KEEPER_INTERVAL_MS ?? 60_000),

  /** Google OAuth web client; the ID token audience. */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  /** Must match an authorised redirect URI on the OAuth client, exactly. */
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:8080/api/auth/google/callback",
  /** Where the browser is sent after a login completes; the site's origin. */
  siteOrigin: process.env.SITE_ORIGIN ?? "http://localhost:3000",
  /** Encrypts account wallet secrets at rest. Losing it loses the wallets. */
  walletMasterKey: keyFromEnv("WALLET_MASTER_KEY"),
  /** Signs session cookies. */
  sessionSecret: keyFromEnv("SESSION_SECRET"),
  /** Cross-site cookies need Secure, which needs HTTPS; off for the local rig. */
  cookieSecure: (process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === "production" ? "1" : "0")) === "1",
} as const;


export { required };
