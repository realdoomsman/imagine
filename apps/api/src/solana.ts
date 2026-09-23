import { Connection } from "@solana/web3.js";
import { ViseClient } from "@vise/sdk";
import { env } from "./env.ts";

export const connection = new Connection(env.rpcUrl, {
  commitment: "confirmed",
  wsEndpoint: env.wsUrl || undefined,
});

export const vise = new ViseClient(connection);
