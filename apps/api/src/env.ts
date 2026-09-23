import { PublicKey } from "@solana/web3.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
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
  /** Where the platform's share of pool inflow is swept. */
  treasury: new PublicKey(
    process.env.TREASURY_PUBKEY ?? "MZRpiuK2Lyc5SKNXaqBitbmNafou66EvuGYMKdQ6DEu",
  ),
  /** App fee on routed swaps, in bps of the SOL leg. Mirrors on-chain config. */
  tradeFeeBps: Number(process.env.TRADE_FEE_BPS ?? 200),
  pinataJwt: process.env.PINATA_JWT ?? "",
} as const;

if (env.tradeFeeBps < 0 || env.tradeFeeBps > 1_000) {
  throw new Error(`TRADE_FEE_BPS ${env.tradeFeeBps} outside 0..1000`);
}

export { required };
