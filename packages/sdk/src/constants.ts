import { PublicKey } from "@solana/web3.js";

/** IMAGINE program (mainnet; local forks run the same id). */
export const IMAGINE_PROGRAM_ID = new PublicKey(
  "imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa",
);

export const SEED = {
  config: Buffer.from("config"),
  pool: Buffer.from("pool"),
  vault: Buffer.from("vault"),
  tokenVault: Buffer.from("token-vault"),
  position: Buffer.from("position"),
} as const;

/**
 * The only metadata URI `launch` accepts (`constants::METADATA_URI_PREFIX` /
 * `METADATA_URI_SUFFIX` in the program): the document the IMAGINE API hosts
 * for the mint, whose website is the coin's IMAGINE page.
 */
export const METADATA_URI_PREFIX = "https://api.imagine.fun/files/meta/";
export const METADATA_URI_SUFFIX = ".json";
export const metadataUri = (mint: PublicKey | string): string =>
  `${METADATA_URI_PREFIX}${mint.toString()}${METADATA_URI_SUFFIX}`;

/** Fixed-point scalar mirroring `constants::SCALE` in the program. */
export const SCALE = 1_000_000_000_000n;
export const BPS = 10_000n;

export const HOUR = 3_600;
export const DAY = 86_400;

/**
 * The least `compound` spends, quote base units (`constants::MIN_COMPOUND_QUOTE`):
 * 0.001 SOL for a SOL quote, the same base-unit floor for any other.
 */
export const MIN_COMPOUND_QUOTE = 1_000_000n;
/** How far below the venue's spot price before the buy a compound may fill (`constants::COMPOUND_SLIPPAGE_BPS`). */
export const COMPOUND_SLIPPAGE_BPS = 300n;
/**
 * The IMAGINE keeper (`constants::KEEPER_AUTHORITY`): besides a lock's owner, the only payer
 * `compound` accepts, only on opted-in locks and only with a non-zero `minTokensOut`.
 */
export const KEEPER_AUTHORITY = new PublicKey("6mgSanvKanCvzMnbyYa5dyWQGZ5wx36rSwybP1WTNh4M");

/**
 * The economics, in one place. `init-config` writes these on-chain, the e2e
 * and integration suites open pools with them, and the UI previews with them;
 * a number that lives anywhere else is a number that will drift.
 *
 * Fees into the pool: every curve trade anywhere pays the IMAGINE platform's
 * LaunchLab creator fee, 0.5% (`poolFeeBps`, the LaunchLab maximum), on-chain
 * to the coin's reward vault (the coin's LaunchLab "creator"); trades routed
 * through imagine.fun add a 1.5% app fee (`tradeFeeBps`, deposited in the
 * same transaction; advisory on chain, the API applies it) — 2% in all. The
 * pool-creation fee is charged in SOL.
 *
 * Split: lockers 90%, treasury 10%, creator 0%. The creator's reward is the
 * coin having a reason to be held, not a cut of its lockers.
 *
 * Duration: a sqrt curve from 1.0x at four hours to 4.0x at a year. The
 * shortest lock still earns at full 1.0x weight; a day is 1.14x, a week 1.41x,
 * a month 1.86x, ninety days 2.49x.
 *
 * Release: fees stream to lockers over one hour. Shorter than the shortest
 * lock, so any locker is present for the whole release of what arrived while
 * they were in, and a backlog cannot be sniped without holding through it.
 *
 * Size: +10% at 0.1% of supply, +25% at 0.5%, +50% at 1%. A serious position
 * is paid like one; the ceiling stays under the accumulator's 10x bound.
 */
export interface Economics {
  tradeFeeBps: number;
  /** LaunchLab creator fee of the IMAGINE platform, in bps (informational). */
  poolFeeBps: number;
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
  tradeFeeBps: 150,
  poolFeeBps: 50,
  treasuryShareBps: 1_000,
  maxCreatorShareBps: 0,
  minLockSecs: 4 * HOUR,
  maxLockSecs: 365 * DAY,
  maxMultiplierBps: 40_000,
  earlyUnlockPenaltyBps: 2_500,
  minLockAmount: 1_000_000n,
  rewardStreamSecs: HOUR,
  durationCurve: 1, // CURVE_SQRT
  sizeTierBps: [10, 50, 100],
  sizeBonusBps: [1_000, 2_500, 5_000],
  poolCreationFeeLamports: 50_000_000n,
};

/**
 * Lock presets surfaced in the UI, shortest first. Durations are seconds; a
 * pool shows only the ones inside its own frozen window.
 */
export const LOCK_PRESETS = [
  { label: "4h", seconds: 4 * HOUR },
  { label: "1d", seconds: DAY },
  { label: "7d", seconds: 7 * DAY },
  { label: "30d", seconds: 30 * DAY },
  { label: "90d", seconds: 90 * DAY },
  { label: "180d", seconds: 180 * DAY },
  { label: "365d", seconds: 365 * DAY },
] as const;

/** Reward-source tags carried by `FeeDeposited.kind`. */
export const FeeKind = {
  Buy: 0,
  Sell: 1,
  CreatorShare: 2,
  Donation: 3,
} as const;
export type FeeKind = (typeof FeeKind)[keyof typeof FeeKind];
