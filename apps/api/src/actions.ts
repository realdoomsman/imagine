import {
  PUMP_SDK,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
} from "@pump-fun/pump-sdk";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  DAY,
  HOUR,
  VISE_IDL,
  appFeeLamports,
  decodePosition,
  formatDuration,
  positionPda,
  type PoolTerms,
} from "@imagine/sdk";
import { z } from "zod";
import { env } from "./env.ts";
import { distributable } from "./keeper.ts";
import {
  appFeeInstruction,
  budgetInstructions,
  fetchCurve,
  onlinePump,
  priceAccounts,
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
/**
 * A lock term in seconds. The bounds are the program's own hard limits; each
 * pool's frozen window is narrower and is checked against the pool itself.
 */
export const lockDuration = z.number().int().min(HOUR).max(4 * 365 * DAY);

export const ActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lock"),
    mint: pubkey,
    index,
    amount: lamports,
    durationSecs: lockDuration,
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
    durationSecs: lockDuration,
    priorityFeeMicroLamports: priority.default(100_000),
  }),
  z.object({ kind: z.literal("claim"), mint: pubkey, index }),
  z.object({ kind: z.literal("renounce"), mint: pubkey, index }),
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

/** Refuse a term outside the pool's frozen window before anything is signed. */
export function assertInWindow(durationSecs: number, terms: Pick<PoolTerms, "minLockSecs" | "maxLockSecs">): void {
  if (durationSecs < terms.minLockSecs || durationSecs > terms.maxLockSecs) {
    throw new ActionError(
      400,
      `this pool takes locks from ${formatDuration(terms.minLockSecs)} to ${formatDuration(terms.maxLockSecs)}`,
    );
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
      const pool = await vise.fetchPool(mint);
      if (!pool) throw new ActionError(404, "this coin has no VISE pool");
      assertInWindow(action.durationSecs, pool.terms);
      const ix = await vise.lock({
        owner,
        mint,
        index: action.index,
        amount: BigInt(action.amount),
        durationSecs: action.durationSecs,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        ammVaults: await priceAccounts(mint),
      });
      return {
        instructions: [...budgetInstructions(action.priorityFeeMicroLamports, 200_000), ix],
        meta: {},
      };
    }

    case "increase": {
      // The program reprices the whole position against the term still to
      // run, and refuses when that is below the pool's minimum lock. Say so
      // before signing rather than after a failed transaction.
      const [positionInfo, pool] = await Promise.all([
        connection.getAccountInfo(positionPda(mint, owner, action.index)),
        vise.fetchPool(mint),
      ]);
      if (!positionInfo || !pool) throw new ActionError(404, "that lock does not exist");
      const remaining = decodePosition(positionInfo.data).lockEnd - Math.floor(Date.now() / 1000);
      if (remaining < pool.terms.minLockSecs) {
        throw new ActionError(
          409,
          `less than ${formatDuration(pool.terms.minLockSecs)} is left on this lock, so it cannot be added to; extend it first, or open a new lock`,
        );
      }
      const ix = await vise.increase({
        owner,
        mint,
        index: action.index,
        amount: BigInt(action.amount),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        ammVaults: await priceAccounts(mint),
      });
      return {
        instructions: [...budgetInstructions(action.priorityFeeMicroLamports, 200_000), ix],
        meta: {},
      };
    }

    case "extend": {
      const pool = await vise.fetchPool(mint);
      if (!pool) throw new ActionError(404, "this coin has no VISE pool");
      assertInWindow(action.durationSecs, pool.terms);
      const ix = await vise.extend({
        owner,
        mint,
        index: action.index,
        durationSecs: action.durationSecs,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        ammVaults: await priceAccounts(mint),
      });
      return {
        instructions: [...budgetInstructions(action.priorityFeeMicroLamports, 200_000), ix],
        meta: {},
      };
    }

    case "claim": {
      const ix = await vise.claim({ owner, mint, index: action.index });
      return { instructions: [...budgetInstructions(100_000, 120_000), ix], meta: {} };
    }

    case "renounce": {
      const position = await vise.fetchPosition(mint, owner, action.index);
      if (!position) throw new ActionError(404, "no such lock");
      if (position.renounced) throw new ActionError(409, "this lock already gave up its earnings");
      const ix = await vise.renounce({ owner, mint, index: action.index });
      return { instructions: [...budgetInstructions(100_000, 120_000), ix], meta: {} };
    }

    case "unlock": {
      // The program pays principal only into the owner's canonical ATA, which
      // the owner may have closed since locking; recreate it idempotently.
      const ixs = await vise.unlockInstructions({
        owner,
        mint,
        index: action.index,
        early: action.early,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      });
      return { instructions: [...budgetInstructions(100_000, 200_000), ...ixs], meta: {} };
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

  // A buy's fee was already netted out of the stated budget above, so it is
  // 2% of that budget; charging it on the smaller curve leg would take 1.96%
  // and leave the rest of the budget unspent.
  const fee = await appFeeInstruction({
    payer: user,
    mint,
    solLegLamports: action.side === "buy" ? amount : solLeg,
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

/**
 * Turn a raw RPC or program failure into a sentence a person can act on.
 *
 * Program errors arrive as `custom program error: 0x1779`; VISE's own codes
 * are named in the IDL, so those become their message. The common Solana
 * failures get plain words. Anything else is passed through, trimmed of the
 * simulation-log noise.
 */
export function friendlyChainError(raw: string): string {
  // Simulation reports `custom program error: 0x1772`; a transaction that
  // passed simulation but failed on chain reports `{"Custom":6002}`.
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(raw);
  const dec = /"Custom":(\d+)/.exec(raw);
  const code = hex ? Number.parseInt(hex[1], 16) : dec ? Number(dec[1]) : null;
  if (code !== null) {
    const known = (VISE_IDL.errors ?? []).find((e) => e.code === code);
    if (known) return known.msg ?? known.name;
    // Anchor's own codes: the ones a user can actually run into.
    if (code === 3012) return "that position no longer exists; it was already unlocked. Refresh the page";
    if (code === 3007 || code === 2006) return "the accounts in this transaction do not match; refresh the page and try again";
    if (code >= 6000) return `the program refused the transaction (error ${code})`;
  }
  if (/insufficient lamports|insufficient funds|Attempt to debit an account/i.test(raw)) {
    return "not enough SOL in the wallet to cover this; the fee and rent come out of the same balance";
  }
  if (/block height exceeded|blockhash not found|Blockhash not found/i.test(raw)) {
    return "the network dropped the transaction before it confirmed; nothing was charged, try again";
  }
  if (/slippage|TooMuchSolRequired|TooLittleSolReceived/i.test(raw)) {
    return "the price moved more than the slippage allowed; try again";
  }
  return raw.replace(/\s*Logs:[\s\S]*$/i, "").replace(/\s+/g, " ").slice(0, 240);
}
