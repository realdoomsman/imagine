import { BN } from "@coral-xyz/anchor";
import {
  canonicalPumpPoolPda,
  creatorVaultPda,
  feeSharingConfigPda,
  OnlinePumpSdk,
  PUMP_SDK,
  type Global,
  type SharingConfig,
} from "@pump-fun/pump-sdk";
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type AccountInfo,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ammVaultsFor,
  appFeeLamports,
  bondingCurvePda,
  curveSpotPrice,
  PUMP_CURVE,
  PUMP_PROGRAM_ID,
  FeeKind,
  rewardVaultPda,
  type BondingCurveState,
} from "@imagine/sdk";
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
  // Anyone can send lamports to the PDA before pump creates it, leaving a
  // system-owned empty account there; only a pump-owned account is a curve.
  if (!accountInfo || !accountInfo.owner.equals(PUMP_PROGRAM_ID)) return null;
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
 * Remaining accounts VISE needs to price a lock on `mint`: nothing while the
 * coin is on its bonding curve (the program reads the curve), the canonical
 * pump AMM pool's vaults once it has graduated.
 */
export async function priceAccounts(
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_2022_PROGRAM_ID,
): Promise<[PublicKey, PublicKey] | undefined> {
  const curve = await fetchCurve(mint);
  return curve?.state.complete ? ammVaultsFor(mint, tokenProgram) : undefined;
}

/**
 * Spot price of one whole token in lamports, wherever the coin trades now:
 * its bonding curve, or once graduated the canonical pump AMM pool, where the
 * curve's own reserves read zero. Null when neither can be read.
 */
export async function spotPriceLamports(
  mint: PublicKey,
  curve: { state: BondingCurveState } | null,
  tokenProgram: PublicKey = TOKEN_2022_PROGRAM_ID,
): Promise<number | null> {
  if (!curve) return null;
  if (!curve.state.complete) return curveSpotPrice(curve.state);
  const [base, quote] = await connection.getMultipleAccountsInfo(ammVaultsFor(mint, tokenProgram));
  if (!base || !quote) return null;
  const baseAmount = AccountLayout.decode(base.data.subarray(0, AccountLayout.span)).amount;
  const quoteAmount = AccountLayout.decode(quote.data.subarray(0, AccountLayout.span)).amount;
  if (baseAmount === 0n) return null;
  return (Number(quoteAmount) / Number(baseAmount)) * 10 ** PUMP_CURVE.tokenDecimals;
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

/** Slippage allowed on a launch's dev buy, in percent (pump-sdk's unit). */
export const DEV_BUY_SLIPPAGE_PERCENT = 2;

/**
 * A launch's first two moves as one instruction set: `create_v2`, the
 * creator's Token-2022 account, and the dev buy (`buy_v2`) against the curve
 * `create_v2` is about to write. Sent in one transaction, nothing can land
 * between the create and the buy, so nobody can buy ahead of the creator.
 *
 * `tokensOut` is priced on the fresh curve
 * (`getBuyTokenAmountFromSolAmount` with `bondingCurve: null`). pump-sdk's own
 * `createV2AndBuyV2Instructions` builds the same set but fixes slippage at 1%;
 * this uses `DEV_BUY_SLIPPAGE_PERCENT` and picks the fee recipient from
 * `global`, as `buyV2Instructions` does for a live curve.
 */
export async function createAndBuyInstructions(params: {
  global: Global;
  mint: PublicKey;
  creator: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  devBuyLamports: bigint;
  tokensOut: BN;
}): Promise<TransactionInstruction[]> {
  const { global, mint, creator } = params;
  const create = await PUMP_SDK.createV2Instruction({
    mint,
    name: params.name,
    symbol: params.symbol,
    uri: params.uri,
    creator,
    user: creator,
    mayhemMode: false,
    holderReward: false,
  });
  const ata = getAssociatedTokenAddressSync(mint, creator, true, TOKEN_2022_PROGRAM_ID);
  const recipients = [global.feeRecipient, ...global.feeRecipients];
  const maxCost = params.devBuyLamports + (params.devBuyLamports * BigInt(DEV_BUY_SLIPPAGE_PERCENT)) / 100n;
  const buy = await PUMP_SDK.getBuyV2InstructionRaw({
    user: creator,
    mint,
    creator,
    amount: params.tokensOut,
    quoteAmount: new BN(maxCost.toString()),
    feeRecipient: recipients[Math.floor(Math.random() * recipients.length)],
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    quoteMint: NATIVE_MINT,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
  });
  return [
    create,
    createAssociatedTokenAccountIdempotentInstruction(creator, ata, creator, mint, TOKEN_2022_PROGRAM_ID),
    buy,
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
  /** The curve completed and the coin trades on its canonical AMM pool. */
  graduated: boolean;
}): Promise<TransactionInstruction[]> {
  const vault = rewardVaultPda(params.mint);
  const create = await PUMP_SDK.createFeeSharingConfig({
    creator: params.creator,
    mint: params.mint,
    pool: params.graduated ? canonicalPumpPoolPda(params.mint) : null,
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
 * Whether a coin's pump fee-sharing config sends its whole creator-fee stream
 * to the VISE pool, permanently: exactly one shareholder, the pool's reward
 * vault, at 10,000 bps, with the admin revoked so nobody can ever change it.
 *
 * This is what makes a sweep worth paying for. A config that routes anywhere
 * else turns the keeper into a free crank for someone else's wallet — and a
 * creator who routes to themselves can donate dust to the vault every minute
 * and have the keeper pay a transaction fee to send it straight back.
 */
export function routesEntirelyToPool(mint: PublicKey, config: SharingConfig): boolean {
  const [only, ...rest] = config.shareholders;
  return (
    config.adminRevoked &&
    config.mint.equals(mint) &&
    only !== undefined &&
    rest.length === 0 &&
    only.shareBps === 10_000 &&
    only.address.equals(rewardVaultPda(mint))
  );
}

/** The coin's decoded sharing config, or null if it never opted in. */
export async function fetchSharingConfig(mint: PublicKey): Promise<SharingConfig | null> {
  const info = await connection.getAccountInfo(feeSharingConfigPda(mint));
  return info ? PUMP_SDK.decodeSharingConfig(info) : null;
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
  /** Already fetched (and, by the keeper, verified); saves a read. */
  sharingConfig?: SharingConfig;
}): Promise<TransactionInstruction[]> {
  const sharingConfigAddress = feeSharingConfigPda(params.mint);
  const sharingConfig = params.sharingConfig ?? (await fetchSharingConfig(params.mint));
  if (!sharingConfig) return []; // coin never opted into fee sharing

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
