import { ECONOMICS } from "@imagine/sdk";
import { api } from "./api.ts";

/**
 * What every trade on an IMAGINE coin pays into the coin's pool, in bps.
 *
 * - `poolFeeBps`: the on-chain trading fee Raydium LaunchLab takes on every
 *   trade, wherever it happens, and sends to the coin's pool (IMAGINE's
 *   platform `creator_fee_rate`; the "creator" account is the pool vault, so
 *   the coin's creator earns nothing from it).
 * - `tradeFeeBps`: the extra app fee trades through imagine.fun add, also paid
 *   into the pool in the same transaction.
 */
export interface PoolFees {
  poolFeeBps: number;
  tradeFeeBps: number;
}

/** Raydium LaunchLab's own protocol fee on curve trades, bps. */
export const LAUNCHLAB_PROTOCOL_FEE_BPS = 25;

/** The live fees from the API's config, or the SDK's launch values if it doesn't answer. */
export function loadFees(): Promise<PoolFees> {
  return api.config().then(
    (config) => ({ poolFeeBps: config.poolFeeBps, tradeFeeBps: config.tradeFeeBps }),
    () => ({ poolFeeBps: ECONOMICS.poolFeeBps, tradeFeeBps: ECONOMICS.tradeFeeBps }),
  );
}
