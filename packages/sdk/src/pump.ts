import { PublicKey } from "@solana/web3.js";
import { BPS, PUMP_CURVE } from "./constants.ts";
import { bondingCurvePda, rewardVaultPda } from "./pda.ts";

/**
 * pump.fun integration.
 *
 * VISE never CPIs into pump. It plugs into pump's own fee-sharing program: a
 * coin's `sharing_config` names the pool's reward vault PDA as a shareholder,
 * and pump's permissionless `distribute_creator_fees_v2` pays that address
 * directly. Because `update_fee_shares_v2` revokes its own admin after the
 * first call, the split becomes immutable — the creator cannot redirect the
 * stream later, and neither can we.
 *
 * https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md
 */

export interface Shareholder {
  address: PublicKey;
  shareBps: number;
}

/**
 * The immutable shareholder list to install on a new coin.
 *
 * The whole creator-fee stream is pointed at the lock pool, and the pool's own
 * frozen terms decide how it is split between lockers, creator, and treasury.
 * Routing everything through one place keeps a single, auditable split rather
 * than two that can disagree.
 */
export function lockPoolShareholders(mint: PublicKey): Shareholder[] {
  return [{ address: rewardVaultPda(mint), shareBps: Number(BPS) }];
}

export interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

/**
 * Lamport market cap of a curve, matching pump's `bondingCurveMarketCap`.
 * This is the input to their dynamic fee tiers.
 */
export function bondingCurveMarketCap(curve: BondingCurveState): bigint {
  if (curve.virtualTokenReserves === 0n) return 0n;
  return (
    (curve.virtualSolReserves * curve.tokenTotalSupply) /
    curve.virtualTokenReserves
  );
}

/** Spot price of one whole token, in lamports. */
export function curveSpotPrice(curve: BondingCurveState): number {
  if (curve.virtualTokenReserves === 0n) return 0;
  const perBaseUnit =
    Number(curve.virtualSolReserves) / Number(curve.virtualTokenReserves);
  return perBaseUnit * 10 ** PUMP_CURVE.tokenDecimals;
}

/**
 * Fraction of the curve sold, for the graduation progress bar.
 *
 * `initialRealTokenReserves` must come from the live pump `Global` account, not
 * a constant: devnet seeds its curves with very different reserves than
 * mainnet, and hardcoding either one silently mis-reports progress on the other.
 */
export function curveProgress(
  curve: BondingCurveState,
  initialRealTokenReserves: bigint,
): number {
  if (curve.complete) return 1;
  if (initialRealTokenReserves <= 0n) return 0;
  const sold = initialRealTokenReserves - curve.realTokenReserves;
  const fraction = Number(sold) / Number(initialRealTokenReserves);
  return Math.min(Math.max(fraction, 0), 1);
}

/**
 * Constant-product quote against the curve's virtual reserves.
 *
 * `solIn` is the amount reaching the curve *after* pump's own protocol and
 * creator fees, so callers must net those out first.
 */
export function quoteBuy(curve: BondingCurveState, solIn: bigint): bigint {
  if (solIn <= 0n) return 0n;
  const k = curve.virtualSolReserves * curve.virtualTokenReserves;
  const newSol = curve.virtualSolReserves + solIn;
  const newTokens = k / newSol;
  const out = curve.virtualTokenReserves - newTokens;
  return out > curve.realTokenReserves ? curve.realTokenReserves : out;
}

export function quoteSell(curve: BondingCurveState, tokensIn: bigint): bigint {
  if (tokensIn <= 0n) return 0n;
  const k = curve.virtualSolReserves * curve.virtualTokenReserves;
  const newTokens = curve.virtualTokenReserves + tokensIn;
  const newSol = k / newTokens;
  return curve.virtualSolReserves - newSol;
}

/**
 * VISE's own app fee on a routed swap, in lamports.
 *
 * Charged on the SOL leg: what the buyer spends, or what the seller receives.
 * Every lamport of it lands in the coin's own lock pool — this is the fee the
 * front-end appends as a `deposit_reward` instruction in the same transaction.
 */
export function appFeeLamports(solLegLamports: bigint, tradeFeeBps: number): bigint {
  return (solLegLamports * BigInt(tradeFeeBps)) / BPS;
}

export function pumpAccountsFor(mint: PublicKey): {
  bondingCurve: PublicKey;
  rewardVault: PublicKey;
} {
  return { bondingCurve: bondingCurvePda(mint), rewardVault: rewardVaultPda(mint) };
}
