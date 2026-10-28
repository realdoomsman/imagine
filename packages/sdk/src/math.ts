import type { PublicKey } from "@solana/web3.js";
import { BPS, SCALE } from "./constants.ts";
import { isNativeQuote } from "./quotes.ts";

/**
 * Exact mirror of `programs/imagine/src/math.rs` and the reward accounting in
 * `state.rs`. Every function here must agree
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
  durationCurve: number;
  sizeTierBps: [number, number, number];
  sizeBonusBps: [number, number, number];
}

export const CURVE_LINEAR = 0;
export const CURVE_SQRT = 1;

/** Integer square root, floor. Exact at every integer, like the program's. */
export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) / 2n;
    if (y >= x) return x;
    x = y;
  }
}

/**
 * Duration multiplier along the pool's curve: `minLock` → 1.0x, `maxLock` →
 * `maxMultiplierBps`. The sqrt curve is front-loaded: on the shipped 4h–365d,
 * 4.0x window thirty days is 1.86x, not the 1.25x a straight line pays.
 */
export function durationMultiplierBps(
  durationSecs: number,
  terms: Pick<PoolTerms, "minLockSecs" | "maxLockSecs" | "maxMultiplierBps" | "durationCurve">,
): number {
  const { minLockSecs, maxLockSecs, maxMultiplierBps, durationCurve } = terms;
  if (durationSecs < minLockSecs || durationSecs > maxLockSecs) {
    throw new RangeError(
      `duration ${durationSecs}s outside [${minLockSecs}, ${maxLockSecs}]`,
    );
  }
  if (maxLockSecs === minLockSecs) return maxMultiplierBps;
  const span = BigInt(maxLockSecs - minLockSecs);
  const travelled = BigInt(durationSecs - minLockSecs);
  const headroom = BigInt(maxMultiplierBps) - BPS;
  const progress = durationCurve === CURVE_SQRT ? isqrt(travelled * span) : travelled;
  return Number(BPS + (headroom * progress) / span);
}

/**
 * Bonus for the share of supply one position commits: the highest tier it
 * clears applies. Measured against supply, so nobody else's lock changes it.
 */
export function sizeBonusBps(
  amount: bigint,
  supply: bigint,
  terms: Pick<PoolTerms, "sizeTierBps" | "sizeBonusBps">,
): number {
  if (supply === 0n) return 0;
  const shareBps = (amount * BPS) / supply;
  let bonus = 0;
  for (let i = 0; i < 3; i++) {
    const tier = terms.sizeTierBps[i];
    if (tier > 0 && shareBps >= BigInt(tier)) bonus = terms.sizeBonusBps[i];
  }
  return bonus;
}

/** Duration multiplier scaled by size tier — what a position actually earns. */
export function combinedMultiplierBps(durationBps: number, sizeBonus: number): number {
  return Number((BigInt(durationBps) * (BPS + BigInt(sizeBonus))) / BPS);
}

/** The multiplier a position of `amount` locked for `durationSecs` earns. */
export function multiplierBps(
  durationSecs: number,
  terms: PoolTerms,
  amount: bigint = 0n,
  supply: bigint = 0n,
): number {
  return combinedMultiplierBps(
    durationMultiplierBps(durationSecs, terms),
    sizeBonusBps(amount, supply, terms),
  );
}

export function weightOf(amount: bigint, multiplier: number): bigint {
  return (amount * BigInt(multiplier)) / BPS;
}

/**
 * Quote base units a position has accrued on the accumulator.
 *
 * `rewardDebt` is in scaled units and keeps the unpaid sub-unit residue,
 * which is what stops the pool from ever owing more than it holds. A claim
 * pays at most `claimableFor`; use that for display.
 */
export function accrued(
  weight: bigint,
  accRewardPerWeight: bigint,
  rewardDebt: bigint,
): bigint {
  const credit = weight * accRewardPerWeight;
  return credit > rewardDebt ? (credit - rewardDebt) / SCALE : 0n;
}

/**
 * What a claim would pay a position right now: its accrual, limited to what
 * is left of its cap (`Pool::apply_cap`).
 */
export function claimableFor(
  position: { weight: bigint; rewardDebt: bigint; rewardCap: bigint; claimed: bigint },
  pool: { accRewardPerWeight: bigint },
): bigint {
  const pending = accrued(position.weight, pool.accRewardPerWeight, position.rewardDebt);
  const room = position.rewardCap > position.claimed ? position.rewardCap - position.claimed : 0n;
  return pending < room ? pending : room;
}

/** A lock's earnings cap: quote value when locked × multiplier (`reward_cap_for`). */
export function rewardCapFor(value: bigint, multiplierBps: number): bigint {
  return (value * BigInt(multiplierBps)) / BPS;
}
/** Scaled credit line used when a position opens or changes weight. */
export function rewardDebtFor(weight: bigint, accRewardPerWeight: bigint): bigint {
  return weight * accRewardPerWeight;
}

/** Advance a scaled debt by quote paid, preserving the residue. */
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
  amount: bigint,
  terms: Pick<PoolTerms, "treasuryShareBps" | "creatorShareBps">,
): { toTreasury: bigint; toCreator: bigint; toLockers: bigint } {
  const toTreasury = (amount * BigInt(terms.treasuryShareBps)) / BPS;
  const afterTreasury = amount - toTreasury;
  const toCreator = (afterTreasury * BigInt(terms.creatorShareBps)) / BPS;
  return { toTreasury, toCreator, toLockers: afterTreasury - toCreator };
}

/**
 * Spread quote across weight the way the program does.
 *
 * Returns the scaled accumulator increment, the quote the pool commits to
 * lockers (rounded up from the credit actually handed out, so the sum of every
 * floored claim can never exceed it) and the remainder carried forward.
 */
export function distribute(
  amount: bigint,
  totalWeight: bigint,
): { increment: bigint; committed: bigint; remainder: bigint } {
  if (totalWeight === 0n || amount === 0n) {
    return { increment: 0n, committed: 0n, remainder: amount };
  }
  const increment = (amount * SCALE) / totalWeight;
  const scaledCredit = increment * totalWeight;
  const committed = (scaledCredit + SCALE - 1n) / SCALE;
  return { increment, committed, remainder: amount - committed };
}

/**
 * A pool's distributable reward balance, as `Rewards::balance` reads it:
 * reward-vault lamports above the rent reserve for a WSOL-quoted pool, the
 * reward token account's amount otherwise. Pass whichever balance the pool's
 * quote uses; the other is ignored.
 */
export function distributableBalance(
  pool: { quoteMint: PublicKey; vaultReserve: bigint },
  balances: { vaultLamports?: bigint; rewardTokenAmount?: bigint },
): bigint {
  if (isNativeQuote(pool.quoteMint)) {
    const lamports = balances.vaultLamports ?? 0n;
    return lamports > pool.vaultReserve ? lamports - pool.vaultReserve : 0n;
  }
  return balances.rewardTokenAmount ?? 0n;
}

/** The subset of a pool the stream projection reads and rewrites. */
export interface StreamState {
  totalWeight: bigint;
  accRewardPerWeight: bigint;
  rewardRemainder: bigint;
  lastVaultBalance: bigint;
  vaultReserve: bigint;
  founded: boolean;
  undistributed: bigint;
  streamRate: bigint;
  streamEnd: number;
  lastStreamAt: number;
  creatorClaimable: bigint;
  treasuryClaimable: bigint;
  lifetimeInflow: bigint;
  lifetimeRewards: bigint;
  lifetimeCreator: bigint;
  lifetimeTreasury: bigint;
  rewardCapacity: bigint;
  terms: Pick<PoolTerms, "treasuryShareBps" | "creatorShareBps"> & {
    rewardStreamSecs: number;
  };
}

/**
 * What `Pool::sync` would leave behind if it ran right now.
 *
 * The on-chain accumulator only moves when some instruction touches the pool.
 * Between touches the stream keeps releasing and fees keep landing in the
 * vault, so a balance read straight from the account under-reports what a
 * claim would pay. This replays the program's exact arithmetic — release the
 * elapsed share of the stream, then fold in any unsynced inflow and restart
 * the window — against the live distributable balance
 * (`distributableBalance`), without sending anything. A no-op before the pool
 * is founded, like the program.
 *
 * Pure: returns a new state and leaves the input untouched.
 */
export function projectSync<T extends StreamState>(
  pool: T,
  balance: bigint,
  now: number,
): T & { released: bigint; inflow: bigint } {
  const next = { ...pool, released: 0n, inflow: 0n };
  if (!pool.founded) return next;

  const payTreasury = (amount: bigint) => {
    next.treasuryClaimable += amount;
    next.lifetimeTreasury += amount;
  };
  const sub = (a: bigint, b: bigint) => (a > b ? a - b : 0n);

  // credit_lockers: with nothing locked the share goes to the treasury, and
  // only what open locks may still earn is credited.
  const credit = (amount: bigint) => {
    if (amount === 0n) return;
    if (next.totalWeight === 0n) {
      payTreasury(amount);
      return;
    }
    const room = sub(next.rewardCapacity, next.rewardRemainder);
    const take = amount < room ? amount : room;
    payTreasury(amount - take);
    if (take === 0n) return;
    const pot = take + next.rewardRemainder;
    const { increment, committed, remainder } = distribute(pot, next.totalWeight);
    next.accRewardPerWeight += increment;
    next.rewardRemainder = remainder;
    next.lifetimeRewards += committed;
    next.rewardCapacity = sub(next.rewardCapacity, committed);
  };

  // release(now)
  const until = Math.min(now, next.streamEnd);
  const elapsed = BigInt(Math.max(until - next.lastStreamAt, 0));
  next.lastStreamAt = now;
  if (elapsed > 0n && next.undistributed > 0n) {
    const due = (next.streamRate * elapsed) / SCALE;
    next.released = due < next.undistributed ? due : next.undistributed;
    next.undistributed -= next.released;
    credit(next.released);
  }

  // Unsynced inflow: quote that landed since the last touch.
  if (balance > pool.lastVaultBalance) {
    next.inflow = balance - pool.lastVaultBalance;
    next.lifetimeInflow += next.inflow;
    const { toTreasury, toCreator, toLockers } = splitInflow(next.inflow, pool.terms);
    const overflow = sub(
      toLockers,
      sub(sub(next.rewardCapacity, next.undistributed), next.rewardRemainder),
    );
    next.treasuryClaimable += toTreasury + overflow;
    next.creatorClaimable += toCreator;
    next.lifetimeTreasury += toTreasury + overflow;
    next.lifetimeCreator += toCreator;
    next.undistributed += toLockers - overflow;
    // restart_stream(now)
    next.streamRate = (next.undistributed * SCALE) / BigInt(pool.terms.rewardStreamSecs);
    next.streamEnd = now + pool.terms.rewardStreamSecs;
    next.lastStreamAt = now;
    next.lastVaultBalance = balance;
  }

  return next;
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
  /** Quote base units paid to lockers during the window. */
  lockerRewards: bigint;
  windowSeconds: number;
  totalLocked: bigint;
  /** Price of one whole token in quote base units. */
  tokenPrice: number;
  tokenDecimals: number;
}): number | null {
  const { lockerRewards, windowSeconds, totalLocked } = params;
  if (windowSeconds <= 0 || totalLocked === 0n) return null;
  const lockedWhole =
    Number(totalLocked) / 10 ** params.tokenDecimals;
  const lockedValue = lockedWhole * params.tokenPrice;
  if (lockedValue <= 0) return null;
  const yearly =
    (Number(lockerRewards) * (365 * 86_400)) / windowSeconds;
  return yearly / lockedValue;
}

/**
 * Share of the fee stream a hypothetical lock would capture, for the UI's
 * "what if" slider. Returns a fraction of the locker pot. `supply` sets the
 * size tier; pass the mint's total supply.
 */
export function projectedShare(
  amount: bigint,
  durationSecs: number,
  terms: PoolTerms,
  currentTotalWeight: bigint,
  supply: bigint,
): { weight: bigint; multiplier: number; share: number } {
  const multiplier = multiplierBps(durationSecs, terms, amount, supply);
  const weight = weightOf(amount, multiplier);
  const total = currentTotalWeight + weight;
  return {
    weight,
    multiplier,
    share: total === 0n ? 0 : Number(weight) / Number(total),
  };
}

/**
 * IMAGINE's app fee on a routed trade, in quote base units.
 *
 * Charged on the quote leg: what the buyer spends, or what the seller
 * receives. All of it lands in the coin's own pool — this is the fee the
 * front-end appends as a `deposit_reward` instruction in the same transaction.
 */
export function appFeeAmount(quoteLeg: bigint, tradeFeeBps: number): bigint {
  return (quoteLeg * BigInt(tradeFeeBps)) / BPS;
}
