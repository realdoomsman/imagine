import { Connection, type PublicKey } from "@solana/web3.js";
import { ImagineClient } from "@imagine/sdk";
import { env } from "./env.ts";

export const connection = new Connection(env.rpcUrl, {
  commitment: "confirmed",
  wsEndpoint: env.wsUrl || undefined,
});

export const imagine = new ImagineClient(connection);

/**
 * The parts of the on-chain `Config` the API builds transactions against.
 *
 * The program pins the treasury, the fee and the StonkFun platform, so the API
 * reads them from the chain rather than carrying a copy in its environment
 * that can drift. Refreshed every minute; the admin instructions that change
 * these are rare and deliberate.
 */
export interface ChainConfig {
  treasury: PublicKey;
  tradeFeeBps: number;
  launchlabPlatform: PublicKey;
  paused: boolean;
}

const CONFIG_TTL_MS = 60_000;
let cached: { at: number; value: ChainConfig } | null = null;
let inflight: Promise<ChainConfig> | null = null;

export async function chainConfig(): Promise<ChainConfig> {
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.value;
  if (inflight) return inflight;
  inflight = imagine
    .fetchConfig()
    .then((config) => {
      if (!config) throw new Error("IMAGINE config is not initialised on this cluster; run scripts/init-config.ts");
      const value = {
        treasury: config.treasury,
        tradeFeeBps: config.tradeFeeBps,
        launchlabPlatform: config.launchlabPlatform,
        paused: config.paused,
      };
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
