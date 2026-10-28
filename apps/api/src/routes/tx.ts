import { PublicKey } from "@solana/web3.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ActionError, ActionSchema, baseUnits, buildAction, lockDuration, pubkey } from "../actions.ts";
import { quoteInfo } from "../quotes.ts";
import { buildLaunch } from "../stonk.ts";
import { serialize } from "../transactions.ts";

export const LaunchSchema = z.object({
  mint: pubkey,
  name: z.string().min(1).max(32),
  symbol: z.string().min(1).max(10),
  uri: z.string().url().max(200),
  quoteMint: pubkey,
  /** Quote base units, or lamports with `payWithSol`. */
  devBuy: baseUnits,
  /** Pay the dev buy in SOL on a coin paired with something else. */
  payWithSol: z.boolean().default(false),
  /** Share of the dev buy the creator locks, 10–100%. */
  lockPercent: z.number().int().min(10).max(100).default(50),
  /** The founding lock's term in seconds, inside the config's default window. */
  lockDurationSecs: lockDuration,
  slippageBps: z.number().int().min(10).max(5_000).default(300),
  priorityFeeMicroLamports: z.number().int().min(0).max(10_000_000).default(200_000),
});

export type LaunchBody = z.infer<typeof LaunchSchema>;

/** The launch request the builder takes, from a parsed body. */
export function launchRequest(creator: PublicKey, body: LaunchBody) {
  return {
    creator,
    mint: new PublicKey(body.mint),
    name: body.name,
    symbol: body.symbol,
    uri: body.uri,
    quoteMint: new PublicKey(body.quoteMint),
    devBuy: BigInt(body.devBuy),
    payWithSol: body.payWithSol,
    lockPercent: body.lockPercent,
    lockDurationSecs: body.lockDurationSecs,
    slippageBps: body.slippageBps,
    priorityFeeMicroLamports: body.priorityFeeMicroLamports,
  };
}

export async function txRoutes(app: FastifyInstance) {
  /**
   * A launch as unsigned transactions, in order. The launch step is signed by
   * the mint keypair as well as the creator (`mintSigns`).
   */
  app.post("/tx/launch", async (request, reply) => {
    const body = LaunchSchema.extend({ creator: pubkey }).parse(request.body);
    const creator = new PublicKey(body.creator);
    try {
      const plan = await buildLaunch(launchRequest(creator, body));
      return {
        mint: plan.mint,
        pool: plan.pool,
        quote: await quoteInfo(plan.quote.mint),
        expectedTokens: plan.expectedTokens,
        lockAmount: plan.lockAmount,
        transactions: await Promise.all(
          plan.steps.map(async (step) => ({
            label: step.label,
            mintSigns: step.mintSigns,
            ...(await serialize(step.instructions, creator, step.lookupTables)),
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
      return { ...(await serialize(built.instructions, owner, built.lookupTables)), ...built.meta };
    } catch (error) {
      if (error instanceof ActionError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });
}
