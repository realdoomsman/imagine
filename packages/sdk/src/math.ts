import { BPS, SCALE } from "./constants.ts";

/**
 * Exact mirror of `programs/vise/src/math.rs`. Every function here must agree
 * with the program bit-for-bit: the UI quotes numbers from these, and a
 * divergence would show users a reward they cannot actually claim.
 */

export interface PoolTerms {
  treasuryShareBps: number;
  creatorShareBps: number;
  minLockSecs: number;
  maxLockSecs: number;
  maxMultiplierBps: number;
  earlyUnlockPenaltyBps: number;
  minLockAmount: bigint;
  rewardStreamSecs: number;
}

/** Linear ramp: `minLock` → 1.0x, `maxLock` → `maxMultiplierBps`. */
export function multiplierBps(durationSecs: number, terms: PoolTerms): number {
  const { minLockSecs, maxLockSecs, maxMultiplierBps } = terms;
  if (durationSecs < minLockSecs || durationSecs > maxLockSecs) {
    throw new RangeError(
      `duration ${durationSecs}s outside [${minLockSecs}, ${maxLockSecs}]`,
    );
  }
  if (maxLockSecs === minLockSecs) return maxMultiplierBps;
  const span = BigInt(maxLockSecs - minLockSecs);
  const travelled = BigInt(durationSecs - minLockSecs);
  const headroom = BigInt(maxMultiplierBps) - BPS;
  return Number(BPS + (headroom * travelled) / span);
}

export function weightOf(amount: bigint, multiplier: number): bigint {
  return (amount * BigInt(multiplier)) / BPS;
}

/**
 * Lamports a position can claim right now.
 *
 * `rewardDebt` is in scaled units and keeps the unpaid sub-lamport residue,
 * which is what stops the pool from ever owing more than it holds.
 */
export function accrued(
  weight: bigint,
  accRewardPerWeight: bigint,
  rewardDebt: bigint,
): bigint {
  const credit = weight * accRewardPerWeight;
  return credit > rewardDebt ? (credit - rewardDebt) / SCALE : 0n;
}

/** Scaled credit line used when a position opens or changes weight. */
export function rewardDebtFor(weight: bigint, accRewardPerWeight: bigint): bigint {
  return weight * accRewardPerWeight;
}

/** Advance a scaled debt by lamports paid, preserving the residue. */
export function settleDebt(rewardDebt: bigint, paid: bigint): bigint {
  return rewardDebt + paid * SCALE;
}

/**
 * Split an inflow the way `Pool::sync` does.
 *
 * Order matters and is not commutative: the treasury is taken off the top, the
 * creator's cut comes out of what is left, and lockers receive the remainder.
 */
export function splitInflow(
  lamports: bigint,
  terms: Pick<PoolTerms, "treasuryShareBps" | "creatorShareBps">,
): { toTreasury: bigint; toCreator: bigint; toLockers: bigint } {
  const toTreasury = (lamports * BigInt(terms.treasuryShareBps)) / BPS;
  const afterTreasury = lamports - toTreasury;
  const toCreator = (afterTreasury * BigInt(terms.creatorShareBps)) / BPS;
  return { toTreasury, toCreator, toLockers: afterTreasury - toCreator };
}

export function earlyExitPenalty(
  amount: bigint,
  lockStart: number,
  lockEnd: number,
  now: number,
  penaltyBps: number,
): bigint {
  if (now >= lockEnd || penaltyBps === 0) return 0n;
  const term = lockEnd - lockStart;
  if (term <= 0) return 0n;
  const remaining = BigInt(Math.min(Math.max(lockEnd - now, 0), term));
  const full = (amount * BigInt(penaltyBps)) / BPS;
  return (full * remaining) / BigInt(term);
}

/**
 * Annualised return on a pool, from realised fees over a trailing window.
 *
 * Expressed against *locked value*, so it answers "what did a locked token
 * earn", and deliberately uses realised inflow rather than projected volume —
 * a projected APR on a memecoin is fiction.
 */
export function estimateApr(params: {
  /** Lamports paid to lockers during the window. */
  lockerRewardsLamports: bigint;
  windowSeconds: number;
  totalLocked: bigint;
  /** Price of one whole token in lamports. */
  tokenPriceLamports: number;
  tokenDecimals: number;
}): number | null {
  const { lockerRewardsLamports, windowSeconds, totalLocked } = params;
  if (windowSeconds <= 0 || totalLocked === 0n) return null;
  const lockedWhole =
    Number(totalLocked) / 10 ** params.tokenDecimals;
  const lockedValueLamports = lockedWhole * params.tokenPriceLamports;
  if (lockedValueLamports <= 0) return null;
  const yearly =
    (Number(lockerRewardsLamports) * (365 * 86_400)) / windowSeconds;
  return yearly / lockedValueLamports;
}

/**
 * Share of the fee stream a hypothetical lock would capture, for the UI's
 * "what if" slider. Returns a fraction of the locker pot.
 */
export function projectedShare(
  amount: bigint,
  durationSecs: number,
  terms: PoolTerms,
  currentTotalWeight: bigint,
): { weight: bigint; multiplier: number; share: number } {
  const multiplier = multiplierBps(durationSecs, terms);
  const weight = weightOf(amount, multiplier);
  const total = currentTotalWeight + weight;
  return {
    weight,
    multiplier,
    share: total === 0n ? 0 : Number(weight) / Number(total),
  };
}
