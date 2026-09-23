import {
  creatorVaultPda,
  feeSharingConfigPda,
  OnlinePumpSdk,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type AccountInfo,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  appFeeLamports,
  bondingCurvePda,
  FeeKind,
  rewardVaultPda,
  type BondingCurveState,
} from "@vise/sdk";
import { env } from "./env.ts";
import { chainConfig, connection, vise } from "./solana.ts";

export const onlinePump = new OnlinePumpSdk(connection);

/** Quote mint for every coin VISE launches: plain SOL-paired. */
export const QUOTE_MINT = NATIVE_MINT;
export const QUOTE_TOKEN_PROGRAM = TOKEN_PROGRAM_ID;

export async function fetchCurve(
  mint: PublicKey,
): Promise<{ state: BondingCurveState; accountInfo: AccountInfo<Buffer> } | null> {
  const accountInfo = await connection.getAccountInfo(bondingCurvePda(mint));
  if (!accountInfo) return null;
  const curve = PUMP_SDK.decodeBondingCurve(accountInfo);
  return {
    accountInfo,
    state: {
      virtualTokenReserves: BigInt(curve.virtualTokenReserves.toString()),
      virtualSolReserves: BigInt(curve.virtualQuoteReserves.toString()),
      realTokenReserves: BigInt(curve.realTokenReserves.toString()),
      realSolReserves: BigInt(curve.realQuoteReserves.toString()),
      tokenTotalSupply: BigInt(curve.tokenTotalSupply.toString()),
      complete: curve.complete,
    },
  };
}

/**
 * The VISE app fee, as an instruction appended to a swap.
 *
 * It lands in the coin's own lock pool, so the fee a trader pays is exactly the
 * money that coin's lockers are paid. It settles atomically with the swap: if
 * the trade fails, the fee is never taken.
 *
 * Coins with no pool trade fee-free rather than having SOL sent to a dead
 * address.
 */
export async function appFeeInstruction(params: {
  payer: PublicKey;
  mint: PublicKey;
  solLegLamports: bigint;
  side: "buy" | "sell";
}): Promise<{ instruction: TransactionInstruction; lamports: bigint } | null> {
  const { tradeFeeBps } = await chainConfig();
  const lamports = appFeeLamports(params.solLegLamports, tradeFeeBps);
  if (lamports <= 0n) return null;
  const vault = await connection.getAccountInfo(rewardVaultPda(params.mint));
  if (!vault) return null;

  const instruction = await vise.depositReward({
    payer: params.payer,
    mint: params.mint,
    lamports,
    kind: params.side === "buy" ? FeeKind.Buy : FeeKind.Sell,
  });
  return { instruction, lamports };
}

export function budgetInstructions(
  microLamports: number,
  units = 300_000,
): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
}

/**
 * Point a coin's entire pump.fun creator-fee stream at its VISE lock pool.
 *
 * `update_fee_shares_v2` revokes its own admin after the first call, so once
 * this lands the routing is permanent: neither the creator nor VISE can ever
 * redirect it. The pool's own frozen terms then decide how that stream splits
 * between lockers, creator, and treasury — one split, in one place, auditable.
 */
export async function routeCreatorFeesToPool(params: {
  creator: PublicKey;
  mint: PublicKey;
}): Promise<TransactionInstruction[]> {
  const vault = rewardVaultPda(params.mint);
  const create = await PUMP_SDK.createFeeSharingConfig({
    creator: params.creator,
    mint: params.mint,
    pool: null, // pre-graduation; the AMM pool does not exist yet
  });
  const update = await PUMP_SDK.updateFeeSharesV2({
    authority: params.creator,
    mint: params.mint,
    currentShareholders: [params.creator],
    newShareholders: [{ address: vault, shareBps: 10_000 }],
    quoteMint: QUOTE_MINT,
    quoteTokenProgram: QUOTE_TOKEN_PROGRAM,
  });

  // Migrating hands the coin's creator fees to a brand-new pump vault keyed on
  // the sharing config. The first trade credits that vault, and if the creator
  // fee on it is smaller than the rent-exempt minimum the runtime rejects the
  // whole transaction — so the very first buy on a freshly launched coin would
  // fail. Seeding the vault once, here, removes that cliff for good.
  const pumpCreatorVault = creatorVaultPda(feeSharingConfigPda(params.mint));
  const seed = SystemProgram.transfer({
    fromPubkey: params.creator,
    toPubkey: pumpCreatorVault,
    lamports: await connection.getMinimumBalanceForRentExemption(0),
  });

  return [create, update, seed];
}

/**
 * Permissionless crank that pushes a coin's accrued pump.fun creator fees into
 * its lock pool. Anyone may call it; the keeper runs it so lockers do not
 * have to.
 *
 * Two sources feed the sharing-config vault: the bonding curve credits it
 * directly, and after graduation the AMM keeps its cut in a WSOL vault that
 * `transfer_creator_fees_to_pump_v2` moves across first. That leg is included
 * only when the AMM vault holds something — not merely because the curve is
 * complete, since a coin can finish its curve without an AMM pool existing
 * yet, and the instruction fails on the missing accounts.
 */
export async function sweepCreatorFees(params: {
  payer: PublicKey;
  mint: PublicKey;
  includeAmm: boolean;
}): Promise<TransactionInstruction[]> {
  const sharingConfigAddress = feeSharingConfigPda(params.mint);
  const info = await connection.getAccountInfo(sharingConfigAddress);
  if (!info) return []; // coin never opted into fee sharing
  const sharingConfig = PUMP_SDK.decodeSharingConfig(info);

  const instructions: TransactionInstruction[] = [];
  if (params.includeAmm) {
    instructions.push(
      await PUMP_SDK.transferCreatorFeesToPumpV2({
        payer: params.payer,
        mint: params.mint,
        quoteMint: QUOTE_MINT,
        quoteTokenProgram: QUOTE_TOKEN_PROGRAM,
      }),
    );
  }
  instructions.push(
    await PUMP_SDK.distributeCreatorFeesV2({
      mint: params.mint,
      sharingConfig,
      sharingConfigAddress,
      quoteMint: QUOTE_MINT,
      payer: params.payer,
      shouldInitializeAta: false,
      quoteTokenProgram: QUOTE_TOKEN_PROGRAM,
    }),
  );
  // Fold the newly arrived lamports into the accumulator in the same
  // transaction, so every pending balance updates at once.
  instructions.push(await vise.sync(params.mint));
  return instructions;
}
