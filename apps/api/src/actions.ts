import {
  PUMP_SDK,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
} from "@pump-fun/pump-sdk";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { DAY, appFeeLamports } from "@vise/sdk";
import { z } from "zod";
import { env } from "./env.ts";
import { distributable } from "./keeper.ts";
import {
  appFeeInstruction,
  budgetInstructions,
  fetchCurve,
  onlinePump,
  sweepCreatorFees,
} from "./pump.ts";
import { chainConfig, connection, vise } from "./solana.ts";

/**
 * Every user action, as instructions.
 *
 * Two callers: the `/tx/*` routes serialise these for an external wallet to
 * sign, and the account routes sign them with a VISE wallet on the server. One
 * builder per action means the two paths can never drift — a Phantom user and
 * a Google user get byte-identical transactions.
 */

export const pubkey = z.string().refine((value) => {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}, "invalid base58 public key");

export const lamports = z
  .string()
  .regex(/^\d+$/, "expected an integer string")
  .refine((v) => BigInt(v) <= 10_000_000n * 1_000_000_000n, "amount too large");

const priority = z.number().int().min(0).max(10_000_000);
const index = z.number().int().min(0).max(4_294_967_295);
const days = z.number().int().min(7).max(365);

export const ActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lock"),
    mint: pubkey,
    index,
    amount: lamports,
    durationDays: days,
    priorityFeeMicroLamports: priority.default(100_000),
  }),
  z.object({
    kind: z.literal("increase"),
    mint: pubkey,
    index,
    amount: lamports,
    priorityFeeMicroLamports: priority.default(100_000),
  }),
  z.object({
    kind: z.literal("extend"),
    mint: pubkey,
    index,
    durationDays: days,
    priorityFeeMicroLamports: priority.default(100_000),
  }),
  z.object({ kind: z.literal("claim"), mint: pubkey, index }),
  z.object({
    kind: z.literal("unlock"),
    mint: pubkey,
    index,
    early: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("swap"),
    mint: pubkey,
    side: z.enum(["buy", "sell"]),
    amount: lamports,
    slippageBps: z.number().int().min(10).max(5_000).default(300),
    priorityFeeMicroLamports: priority.default(150_000),
  }),
  z.object({ kind: z.literal("sweep"), mint: pubkey }),
]);

export type Action = z.infer<typeof ActionSchema>;

export class ActionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface BuiltAction {
  instructions: TransactionInstruction[];
  /** Figures the caller may want to show: fees, legs, expected output. */
  meta: Record<string, string | number>;
}

export async function buildAction(owner: PublicKey, action: Action): Promise<BuiltAction> {
  const mint = new PublicKey(action.mint);

  switch (action.kind) {
    case "lock": {
      const ix = await vise.lock({
        owner,
        mint,
        index: action.index,
        amount: BigInt(action.amount),
        durationSecs: action.durationDays * DAY,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      });
      return {
        instructions: [...budgetInstructions(action.priorityFeeMicroLamports, 150_000), ix],
        meta: {},
      };
    }

    case "increase": {
      const ix = await vise.increase({
        owner,
        mint,
        index: action.index,
        amount: BigInt(action.amount),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      });
      return {
        instructions: [...budgetInstructions(action.priorityFeeMicroLamports, 150_000), ix],
        meta: {},
      };
    }

    case "extend": {
      const ix = await vise.extend({
        owner,
        mint,
        index: action.index,
        durationSecs: action.durationDays * DAY,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      });
      return {
        instructions: [...budgetInstructions(action.priorityFeeMicroLamports, 150_000), ix],
        meta: {},
      };
    }

    case "claim": {
      const ix = await vise.claim({ owner, mint, index: action.index });
      return { instructions: [...budgetInstructions(100_000, 120_000), ix], meta: {} };
    }

    case "unlock": {
      const ix = await vise.unlock({
        owner,
        mint,
        index: action.index,
        early: action.early,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      });
      return { instructions: [...budgetInstructions(100_000, 200_000), ix], meta: {} };
    }

    case "swap":
      return buildSwap(owner, mint, action);

    case "sweep": {
      const { pump, amm } = await distributable(mint);
      if (pump + amm === 0n) throw new ActionError(409, "nothing waiting at pump for this coin");
      const ixs = await sweepCreatorFees({ payer: owner, mint, includeAmm: amm > 0n });
      if (ixs.length === 0) throw new ActionError(404, "coin has no pump fee-sharing config");
      return {
        instructions: [...budgetInstructions(150_000, 400_000), ...ixs],
        meta: { waitingLamports: (pump + amm).toString() },
      };
    }
  }
}

/**
 * Swap through pump with the VISE app fee attached.
 *
 * The fee instruction rides in the same transaction as the trade, so a trader
 * cannot be charged for a swap that did not happen, and lockers are credited
 * the instant the trade confirms.
 */
async function buildSwap(
  user: PublicKey,
  mint: PublicKey,
  action: Extract<Action, { kind: "swap" }>,
): Promise<BuiltAction> {
  const amount = BigInt(action.amount);
  const curve = await fetchCurve(mint);
  if (!curve) throw new ActionError(404, "bonding curve not found");
  if (curve.state.complete) {
    throw new ActionError(409, "coin has graduated; route this trade through PumpSwap");
  }

  const global = await onlinePump.fetchGlobal();
  const feeConfig = await onlinePump.fetchFeeConfig().catch(() => null);
  const decoded = PUMP_SDK.decodeBondingCurve(curve.accountInfo);
  const mintSupply = new BN(curve.state.tokenTotalSupply.toString());
  const slippage = action.slippageBps / 100;

  const userAta = getAssociatedTokenAddressSync(mint, user, true, TOKEN_2022_PROGRAM_ID);
  const userAtaInfo = await connection.getAccountInfo(userAta);

  let swapIxs: TransactionInstruction[];
  let solLeg: bigint;
  let expectedOut: bigint;

  if (action.side === "buy") {
    // `amount` is SOL in. Net the app fee out first so the user's stated
    // budget is what actually leaves their wallet.
    const fee = appFeeLamports(amount, (await chainConfig()).tradeFeeBps);
    const toCurve = amount - fee;
    if (toCurve <= 0n) throw new ActionError(400, "amount too small");
    const tokensOut = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply,
      bondingCurve: decoded,
      amount: new BN(toCurve.toString()),
      quoteMint: PublicKey.default,
    });
    swapIxs = await PUMP_SDK.buyInstructions({
      global,
      bondingCurveAccountInfo: curve.accountInfo,
      bondingCurve: decoded,
      associatedUserAccountInfo: userAtaInfo,
      mint,
      user,
      amount: tokensOut,
      solAmount: new BN(toCurve.toString()),
      slippage,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    solLeg = toCurve;
    expectedOut = BigInt(tokensOut.toString());
  } else {
    // `amount` is tokens in; the fee is charged on the SOL that comes back.
    const solOut = getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply,
      bondingCurve: decoded,
      amount: new BN(amount.toString()),
    });
    swapIxs = await PUMP_SDK.sellInstructions({
      global,
      bondingCurveAccountInfo: curve.accountInfo,
      bondingCurve: decoded,
      mint,
      user,
      amount: new BN(amount.toString()),
      solAmount: solOut,
      slippage,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      mayhemMode: false,
    });
    solLeg = BigInt(solOut.toString());
    expectedOut = solLeg;
  }

  const fee = await appFeeInstruction({
    payer: user,
    mint,
    solLegLamports: solLeg,
    side: action.side,
  });

  return {
    instructions: [
      ...budgetInstructions(action.priorityFeeMicroLamports),
      ...swapIxs,
      ...(fee ? [fee.instruction] : []),
    ],
    meta: {
      appFeeLamports: (fee?.lamports ?? 0n).toString(),
      appFeeBps: fee ? (await chainConfig()).tradeFeeBps : 0,
      solLegLamports: solLeg.toString(),
      expectedOut: expectedOut.toString(),
    },
  };
}
