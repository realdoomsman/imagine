import { PUMP_SDK, feeSharingConfigPda, getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { DAY, poolPda } from "@vise/sdk";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ActionError, ActionSchema, buildAction, lamports, pubkey } from "../actions.ts";
import { env } from "../env.ts";
import { budgetInstructions, fetchCurve, onlinePump, routeCreatorFeesToPool } from "../pump.ts";
import { chainConfig, connection, vise } from "../solana.ts";

/**
 * Serialise an unsigned transaction for the browser to sign.
 *
 * These routes never hold a key. They assemble instructions, set the payer and
 * a fresh blockhash, and hand the bytes back; the user's wallet is the signer.
 * (VISE accounts — Google sign-in — go through /me/tx instead, where the
 * server signs with the account's own wallet.)
 */
export async function serialize(
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

export const LaunchSchema = z.object({
  mint: pubkey,
  stage: z.enum(["create", "finish"]).default("create"),
  name: z.string().min(1).max(32),
  symbol: z.string().min(1).max(13),
  uri: z.string().url().max(200),
  devBuyLamports: lamports,
  /** Share of the dev buy the creator locks, 10–100%. */
  lockPercent: z.number().int().min(10).max(100).default(50),
  lockDurationDays: z.number().int().min(7).max(365),
  priorityFeeMicroLamports: z.number().int().min(0).max(10_000_000).default(200_000),
});

export type LaunchRequest = z.infer<typeof LaunchSchema>;

/**
 * Launch, as an ordered set of transactions signed back to back.
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
 * Steps 2–4 are built against state that step 1 creates, so `stage` selects
 * which half to build; callers ask for the second once the first confirmed.
 */
export async function buildLaunch(
  creator: PublicKey,
  body: LaunchRequest,
): Promise<{
  mint: string;
  pool: string;
  expectedTokens?: string;
  lockAmount?: string;
  steps: Array<{ label: string; instructions: TransactionInstruction[] }>;
}> {
  const mint = new PublicKey(body.mint);
  const devBuy = BigInt(body.devBuyLamports);
  if (devBuy <= 0n) {
    throw new ActionError(400, "a launch needs a dev buy: the creator must lock coins to open the pool");
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
      steps: [{ label: "Create the coin", instructions: [...budget, createIx] }],
    };
  }

  // Stage two: the curve exists, so the buy can be priced against it.
  //
  // Every step here is skipped if the chain already shows it done, so a launch
  // that stopped halfway (a dropped connection, a stale blockhash) resumes
  // with the same mint instead of buying twice or minting a second coin.
  const curve = await fetchCurve(mint);
  if (!curve) throw new ActionError(409, "coin not created yet; run the create stage first");
  const decoded = PUMP_SDK.decodeBondingCurve(curve.accountInfo);
  const supply = await connection.getTokenSupply(mint);
  const ata = getAssociatedTokenAddressSync(mint, creator, true, TOKEN_2022_PROGRAM_ID);
  const [ataInfo, held, existingPool, sharing] = await Promise.all([
    connection.getAccountInfo(ata),
    connection.getTokenAccountBalance(ata).then((b) => BigInt(b.value.amount)).catch(() => 0n),
    vise.fetchPool(mint),
    connection.getAccountInfo(feeSharingConfigPda(mint)),
  ]);

  const steps: Array<{ label: string; instructions: TransactionInstruction[] }> = [];
  let expected: bigint;
  if (held > 0n) {
    // The dev buy already landed; the bag in the wallet is the founding lock's basis.
    expected = held;
  } else {
    const expectedTokens = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: new BN(supply.value.amount),
      bondingCurve: decoded,
      amount: new BN(devBuy.toString()),
      quoteMint: PublicKey.default,
    });
    expected = BigInt(expectedTokens.toString());
    const buyIxs = await PUMP_SDK.buyV2Instructions({
      global,
      bondingCurveAccountInfo: curve.accountInfo,
      bondingCurve: decoded,
      associatedUserAccountInfo: ataInfo,
      mint,
      user: creator,
      amount: expectedTokens,
      quoteAmount: new BN(devBuy.toString()),
      slippage: 10,
    });
    steps.push({ label: "Buy the first bag", instructions: [...budget, ...buyIxs] });
  }
  const lockAmount = existingPool
    ? existingPool.totalLocked
    : (expected * BigInt(body.lockPercent)) / 100n;

  if (!existingPool) {
    const poolIx = await vise.createPool({
      creator,
      mint,
      treasury: (await chainConfig()).treasury,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      // Creators take no cut of their lockers; the split is 90 / 10 / 0.
      creatorShareBps: 0,
      initialLockAmount: lockAmount,
      initialLockDuration: body.lockDurationDays * DAY,
    });
    steps.push({ label: "Open the pool and clamp your bag", instructions: [...budget, poolIx] });
  }
  if (!sharing) {
    const routeIxs = await routeCreatorFeesToPool({ creator, mint });
    steps.push({ label: "Lock the fee stream to holders", instructions: [...budget, ...routeIxs] });
  }
  if (steps.length === 0) throw new ActionError(409, "this coin is already launched and its fees are already routed");

  return {
    mint: mint.toBase58(),
    pool: poolPda(mint).toBase58(),
    expectedTokens: expected.toString(),
    lockAmount: lockAmount.toString(),
    steps,
  };
}

export async function txRoutes(app: FastifyInstance) {
  app.post("/tx/launch", async (request, reply) => {
    const body = LaunchSchema.extend({ creator: pubkey }).parse(request.body);
    const creator = new PublicKey(body.creator);
    try {
      const launch = await buildLaunch(creator, body);
      return {
        mint: launch.mint,
        pool: launch.pool,
        expectedTokens: launch.expectedTokens,
        lockAmount: launch.lockAmount,
        transactions: await Promise.all(
          launch.steps.map(async (step) => ({
            label: step.label,
            ...(await serialize(step.instructions, creator)),
          })),
        ),
      };
    } catch (error) {
      if (error instanceof ActionError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  /**
   * Every other action: one route, one schema, one builder. The `owner` field
   * names the wallet that will sign; the response is that wallet's unsigned
   * transaction plus whatever figures the action produced.
   */
  app.post("/tx/action", async (request, reply) => {
    const body = z.object({ owner: pubkey }).and(ActionSchema).parse(request.body);
    const owner = new PublicKey(body.owner);
    try {
      const built = await buildAction(owner, body);
      return { ...(await serialize(built.instructions, owner)), ...built.meta };
    } catch (error) {
      if (error instanceof ActionError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  /*
   * The named routes the web app already calls. Each is the action route with
   * the kind filled in; kept so a client built against them keeps working.
   */
  const alias = (kind: "lock" | "claim" | "unlock" | "extend" | "swap" | "sweep" | "increase", ownerField: string) =>
    app.post(`/tx/${kind}`, async (request, reply) => {
      const raw = request.body as Record<string, unknown>;
      const ownerValue = raw[ownerField];
      const body = z.object({ owner: pubkey }).and(ActionSchema).parse({ ...raw, kind, owner: ownerValue });
      const owner = new PublicKey(body.owner);
      try {
        const built = await buildAction(owner, body);
        return { ...(await serialize(built.instructions, owner)), ...built.meta };
      } catch (error) {
        if (error instanceof ActionError) return reply.code(error.status).send({ error: error.message });
        throw error;
      }
    });
  alias("lock", "owner");
  alias("increase", "owner");
  alias("claim", "owner");
  alias("unlock", "owner");
  alias("extend", "owner");
  alias("swap", "user");
  alias("sweep", "payer");
}
