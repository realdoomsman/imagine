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

/**
 * The economics, in one place. `init-config` writes these on-chain, the e2e
 * and integration suites open pools with them, and the UI previews with them;
 * a number that lives anywhere else is a number that will drift.
 *
 * Split: lockers 90%, treasury 10%, creator 0%. The creator's reward is the
 * coin having a reason to be held, not a cut of its lockers.
 *
 * Duration: a sqrt curve from 1.0x at a week to 4.0x at a year, so a month is
 * 1.76x and ninety days 2.44x — short commitments are worth making.
 *
 * Size: +10% at 0.1% of supply, +25% at 0.5%, +50% at 1%. A serious position
 * is paid like one; the ceiling stays under the accumulator's 10x bound.
 */
export interface Economics {
  tradeFeeBps: number;
  treasuryShareBps: number;
  maxCreatorShareBps: number;
  minLockSecs: number;
  maxLockSecs: number;
  maxMultiplierBps: number;
  earlyUnlockPenaltyBps: number;
  minLockAmount: bigint;
  rewardStreamSecs: number;
  durationCurve: number;
  sizeTierBps: [number, number, number];
  sizeBonusBps: [number, number, number];
  poolCreationFeeLamports: bigint;
}

export const ECONOMICS: Readonly<Economics> = {
  tradeFeeBps: 200,
  treasuryShareBps: 1_000,
  maxCreatorShareBps: 0,
  minLockSecs: 7 * DAY,
  maxLockSecs: 365 * DAY,
  maxMultiplierBps: 40_000,
  earlyUnlockPenaltyBps: 2_500,
  minLockAmount: 1_000_000n,
  rewardStreamSecs: 24 * 3_600,
  durationCurve: 1, // CURVE_SQRT
  sizeTierBps: [10, 50, 100],
  sizeBonusBps: [1_000, 2_500, 5_000],
  poolCreationFeeLamports: 50_000_000n,
};

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
