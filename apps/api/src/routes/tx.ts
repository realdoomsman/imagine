import { PUMP_SDK, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount } from "@pump-fun/pump-sdk";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { DAY, appFeeLamports, poolPda } from "@vise/sdk";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.ts";
import {
  appFeeInstruction,
  budgetInstructions,
  fetchCurve,
  onlinePump,
  routeCreatorFeesToPool,
  sweepCreatorFees,
} from "../pump.ts";
import { connection, vise } from "../solana.ts";

const pubkey = z.string().refine((value) => {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}, "invalid base58 public key");

const lamportsSchema = z
  .string()
  .regex(/^\d+$/, "expected an integer string")
  .refine((v) => BigInt(v) <= 10_000_000n * 1_000_000_000n, "amount too large");

/**
 * Serialise an unsigned transaction for the browser to sign.
 *
 * The API never holds a key. It assembles instructions, sets the payer and a
 * fresh blockhash, and hands the bytes back; the wallet is the only signer.
 */
async function serialize(
  instructions: TransactionInstruction[],
  payer: PublicKey,
): Promise<{ transaction: string; blockhash: string; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
  tx.add(...instructions);
  return {
    transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
    blockhash,
    lastValidBlockHeight,
  };
}

export async function txRoutes(app: FastifyInstance) {
  /**
   * Launch, as an ordered set of transactions the wallet signs back to back.
   *
   * They are split because the work does not fit in one 1232-byte packet, and
   * because the order is load-bearing:
   *   1. `create_v2` — the mint and bonding curve must exist before anything
   *      can reference them.
   *   2. the dev buy — the creator holds no coins until this lands, and a pool
   *      cannot open without the creator's founding lock.
   *   3. `create_pool` — opens the pool and locks the creator's share. It
   *      proves the signer launched the coin by reading pump's
   *      `BondingCurve::creator`, so it must run before step 4 rewrites that
   *      field to the sharing config.
   *   4. fee sharing — points the coin's creator-fee stream at the lock pool
   *      and revokes its own admin, making the routing permanent.
   *
   * Steps 2–4 are built against state that step 1 creates, so the client asks
   * for them once the previous step has confirmed. `stage` selects which.
   */
  app.post("/tx/launch", async (request, reply) => {
    const body = z
      .object({
        creator: pubkey,
        mint: pubkey,
        stage: z.enum(["create", "finish"]).default("create"),
        name: z.string().min(1).max(32),
        symbol: z.string().min(1).max(13),
        uri: z.string().url().max(200),
        devBuyLamports: lamportsSchema,
        /** Share of the dev buy the creator locks, 10–100%. */
        lockPercent: z.number().int().min(10).max(100).default(50),
        lockDurationDays: z.number().int().min(7).max(365),
        creatorShareBps: z.number().int().min(0).max(3000),
        priorityFeeMicroLamports: z.number().int().min(0).max(10_000_000).default(200_000),
      })
      .parse(request.body);

    const creator = new PublicKey(body.creator);
    const mint = new PublicKey(body.mint);
    const devBuy = BigInt(body.devBuyLamports);
    if (devBuy <= 0n) {
      return reply.code(400).send({
        error: "a launch needs a dev buy: the creator must lock coins to open the pool",
      });
    }

    const global = await onlinePump.fetchGlobal();
    const feeConfig = await onlinePump.fetchFeeConfig().catch(() => null);
    const budget = budgetInstructions(body.priorityFeeMicroLamports, 400_000);

    if (body.stage === "create") {
      const createIx = await PUMP_SDK.createV2Instruction({
        mint,
        name: body.name,
        symbol: body.symbol,
        uri: body.uri,
        creator,
        user: creator,
        mayhemMode: false,
        holderReward: false,
      });
      return {
        mint: mint.toBase58(),
        pool: poolPda(mint).toBase58(),
        transactions: [
          { label: "Create the coin", ...(await serialize([...budget, createIx], creator)) },
        ],
      };
    }

    // Stage two: the curve exists, so the buy can be priced against it.
    const curve = await fetchCurve(mint);
    if (!curve) {
      return reply.code(409).send({ error: "coin not created yet; run the create stage first" });
    }
    const decoded = PUMP_SDK.decodeBondingCurve(curve.accountInfo);
    const supply = await connection.getTokenSupply(mint);
    const expectedTokens = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: new BN(supply.value.amount),
      bondingCurve: decoded,
      amount: new BN(devBuy.toString()),
      quoteMint: PublicKey.default,
    });
    const expected = BigInt(expectedTokens.toString());
    const lockAmount = (expected * BigInt(body.lockPercent)) / 100n;

    const buyIxs = await PUMP_SDK.buyV2Instructions({
      global,
      bondingCurveAccountInfo: curve.accountInfo,
      bondingCurve: decoded,
      associatedUserAccountInfo: await connection.getAccountInfo(
        getAssociatedTokenAddressSync(mint, creator, true, TOKEN_2022_PROGRAM_ID),
      ),
      mint,
      user: creator,
      amount: expectedTokens,
      quoteAmount: new BN(devBuy.toString()),
      slippage: 10,
    });
    const routeIxs = await routeCreatorFeesToPool({ creator, mint });
    const poolIx = await vise.createPool({
      creator,
      mint,
      treasury: env.treasury,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      creatorShareBps: body.creatorShareBps,
      initialLockAmount: lockAmount,
      initialLockDuration: body.lockDurationDays * DAY,
    });

    return {
      mint: mint.toBase58(),
      pool: poolPda(mint).toBase58(),
      expectedTokens: expected.toString(),
      lockAmount: lockAmount.toString(),
      transactions: [
        { label: "Buy the first bag", ...(await serialize([...budget, ...buyIxs], creator)) },
        {
          label: "Open the pool and clamp your bag",
          ...(await serialize([...budget, poolIx], creator)),
        },
        {
          label: "Lock the fee stream to holders",
          ...(await serialize([...budget, ...routeIxs], creator)),
        },
      ],
    };
  });

  /**
   * Swap through pump with the VISE app fee attached.
   *
   * The fee instruction rides in the same transaction as the trade, so a trader
   * cannot be charged for a swap that did not happen, and lockers are credited
   * the instant the trade confirms.
   */
  app.post("/tx/swap", async (request, reply) => {
    const body = z
      .object({
        user: pubkey,
        mint: pubkey,
        side: z.enum(["buy", "sell"]),
        amount: lamportsSchema,
        slippageBps: z.number().int().min(10).max(5_000).default(300),
        priorityFeeMicroLamports: z.number().int().min(0).max(10_000_000).default(150_000),
      })
      .parse(request.body);

    const user = new PublicKey(body.user);
    const mint = new PublicKey(body.mint);
    const amount = BigInt(body.amount);

    const curve = await fetchCurve(mint);
    if (!curve) return reply.code(404).send({ error: "bonding curve not found" });
    if (curve.state.complete) {
      return reply
        .code(409)
        .send({ error: "coin has graduated; route this trade through PumpSwap" });
    }

    const global = await onlinePump.fetchGlobal();
    const feeConfig = await onlinePump.fetchFeeConfig().catch(() => null);
    const decoded = PUMP_SDK.decodeBondingCurve(curve.accountInfo);
    const mintSupply = new BN(curve.state.tokenTotalSupply.toString());
    const slippage = body.slippageBps / 100;

    const userAta = getAssociatedTokenAddressSync(mint, user, true, TOKEN_2022_PROGRAM_ID);
    const userAtaInfo = await connection.getAccountInfo(userAta);

    let swapIxs: TransactionInstruction[];
    let solLeg: bigint;

    if (body.side === "buy") {
      // `amount` is SOL in. Net the app fee out first so the user's stated
      // budget is what actually leaves their wallet.
      const fee = appFeeLamports(amount, env.tradeFeeBps);
      const toCurve = amount - fee;
      if (toCurve <= 0n) return reply.code(400).send({ error: "amount too small" });
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
    }

    const fee = await appFeeInstruction({
      payer: user,
      mint,
      solLegLamports: solLeg,
      side: body.side,
    });

    const instructions = [
      ...budgetInstructions(body.priorityFeeMicroLamports),
      ...swapIxs,
      ...(fee ? [fee.instruction] : []),
    ];

    return {
      ...(await serialize(instructions, user)),
      appFeeLamports: (fee?.lamports ?? 0n).toString(),
      appFeeBps: fee ? env.tradeFeeBps : 0,
      solLegLamports: solLeg.toString(),
    };
  });

  app.post("/tx/lock", async (request) => {
    const body = z
      .object({
        owner: pubkey,
        mint: pubkey,
        index: z.number().int().min(0).max(4_294_967_295),
        amount: lamportsSchema,
        durationDays: z.number().int().min(7).max(365),
        priorityFeeMicroLamports: z.number().int().min(0).max(10_000_000).default(100_000),
      })
      .parse(request.body);

    const owner = new PublicKey(body.owner);
    const mint = new PublicKey(body.mint);
    const ix = await vise.lock({
      owner,
      mint,
      index: body.index,
      amount: BigInt(body.amount),
      durationSecs: body.durationDays * DAY,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    return serialize([...budgetInstructions(body.priorityFeeMicroLamports, 150_000), ix], owner);
  });

  app.post("/tx/claim", async (request) => {
    const body = z
      .object({ owner: pubkey, mint: pubkey, index: z.number().int().min(0) })
      .parse(request.body);
    const owner = new PublicKey(body.owner);
    const ix = await vise.claim({
      owner,
      mint: new PublicKey(body.mint),
      index: body.index,
    });
    return serialize([...budgetInstructions(100_000, 120_000), ix], owner);
  });

  app.post("/tx/unlock", async (request) => {
    const body = z
      .object({
        owner: pubkey,
        mint: pubkey,
        index: z.number().int().min(0),
        early: z.boolean().default(false),
      })
      .parse(request.body);
    const owner = new PublicKey(body.owner);
    const ix = await vise.unlock({
      owner,
      mint: new PublicKey(body.mint),
      index: body.index,
      early: body.early,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    return serialize([...budgetInstructions(100_000, 200_000), ix], owner);
  });

  app.post("/tx/extend", async (request) => {
    const body = z
      .object({
        owner: pubkey,
        mint: pubkey,
        index: z.number().int().min(0),
        durationDays: z.number().int().min(7).max(365),
      })
      .parse(request.body);
    const owner = new PublicKey(body.owner);
    const ix = await vise.extend({
      owner,
      mint: new PublicKey(body.mint),
      index: body.index,
      durationSecs: body.durationDays * DAY,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    return serialize([...budgetInstructions(100_000, 150_000), ix], owner);
  });

  /** Permissionless crank anyone can run to pull pump creator fees into a pool. */
  app.post("/tx/sweep", async (request, reply) => {
    const body = z
      .object({ payer: pubkey, mint: pubkey, graduated: z.boolean().default(false) })
      .parse(request.body);
    const payer = new PublicKey(body.payer);
    const ixs = await sweepCreatorFees({
      payer,
      mint: new PublicKey(body.mint),
      graduated: body.graduated,
    });
    if (ixs.length === 0) {
      return reply.code(404).send({ error: "coin has no pump fee-sharing config" });
    }
    return serialize([...budgetInstructions(150_000, 400_000), ...ixs], payer);
  });
}
