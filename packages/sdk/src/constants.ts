import { PublicKey } from "@solana/web3.js";

/** VISE program, identical on devnet and mainnet. */
export const VISE_PROGRAM_ID = new PublicKey(
  "VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb",
);

/**
 * pump.fun programs. Both are deployed at the same addresses on mainnet-beta
 * and devnet.
 * https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md
 */
export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);
export const PUMP_GLOBAL = new PublicKey(
  "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",
);

export const SEED = {
  config: Buffer.from("config"),
  pool: Buffer.from("pool"),
  vault: Buffer.from("vault"),
  tokenVault: Buffer.from("token-vault"),
  position: Buffer.from("position"),
} as const;

/** Fixed-point scalar mirroring `constants::SCALE` in the program. */
export const SCALE = 1_000_000_000_000n;
export const BPS = 10_000n;

export const DAY = 86_400;

/** Lock presets surfaced in the UI. Durations are seconds. */
export const LOCK_PRESETS = [
  { label: "7d", days: 7, seconds: 7 * DAY },
  { label: "30d", days: 30, seconds: 30 * DAY },
  { label: "90d", days: 90, seconds: 90 * DAY },
  { label: "180d", days: 180, seconds: 180 * DAY },
  { label: "365d", days: 365, seconds: 365 * DAY },
] as const;

/** Reward-source tags carried by `FeeDeposited.kind`. */
export const FeeKind = {
  Buy: 0,
  Sell: 1,
  CreatorSweep: 2,
  Donation: 3,
} as const;
export type FeeKind = (typeof FeeKind)[keyof typeof FeeKind];

/** pump.fun bonding-curve constants, from the on-chain `Global` account. */
export const PUMP_CURVE = {
  tokenDecimals: 6,
  totalSupply: 1_000_000_000_000_000n,
  initialVirtualTokenReserves: 1_073_000_000_000_000n,
  initialVirtualSolReserves: 30_000_000_000n,
  initialRealTokenReserves: 793_100_000_000_000n,
} as const;
