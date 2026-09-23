import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { accrued, earlyExitPenalty } from "@vise/sdk";
import bs58 from "bs58";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ActionError, ActionSchema, buildAction, lamports, pubkey } from "../actions.ts";
import {
  beginGoogleLogin,
  clearSession,
  completeGoogleLogin,
  issueSession,
  loadKeypair,
  OAUTH_STATE_COOKIE,
  recordAction,
  sessionAccount,
  sessionCookieOptions,
  setSession,
  upsertAccount,
  verifyGoogleIdToken,
  type Account,
} from "../auth.ts";
import { env } from "../env.ts";
import { sql } from "../db.ts";
import { budgetInstructions } from "../pump.ts";
import { connection, vise } from "../solana.ts";
import { buildLaunch, LaunchSchema } from "./tx.ts";

/**
 * Sign and send with the account's own key, confirmed against the blockhash
 * it was built with. The key exists in memory for the length of this call.
 */
async function signAndSend(
  keypair: Keypair,
  instructions: TransactionInstruction[],
  extraSigners: Keypair[] = [],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: keypair.publicKey, blockhash, lastValidBlockHeight });
  tx.add(...instructions);
  tx.sign(keypair, ...extraSigners);
  const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const result = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) {
    throw new ActionError(409, `transaction failed on chain: ${JSON.stringify(result.value.err)}`);
  }
  return signature;
}

async function requireAccount(request: FastifyRequest, reply: FastifyReply): Promise<Account | null> {
  const account = await sessionAccount(request);
  if (!account) {
    await reply.code(401).send({ error: "sign in first" });
    return null;
  }
  return account;
}

function publicAccount(account: Account) {
  return {
    email: account.email,
    name: account.name,
    picture: account.picture,
    wallet: account.walletPubkey,
    createdAt: account.createdAt,
  };
}

export async function accountRoutes(app: FastifyInstance) {
  /** Step one of the redirect flow: remember where to return, send to Google. */
  app.get("/auth/google/start", async (request, reply) => {
    const { return_to } = z.object({ return_to: z.string().max(400).default("/account") }).parse(request.query);
    const returnTo = return_to.startsWith("/") ? return_to : "/account";
    const { url, nonce } = await beginGoogleLogin(returnTo);
    reply.setCookie(OAUTH_STATE_COOKIE, nonce, {
      ...sessionCookieOptions(),
      maxAge: 600,
      // Google redirects back top-level, which is a cross-site navigation:
      // the cookie must be Lax (or None) to be sent with it.
      sameSite: env.cookieSecure ? "none" : "lax",
    });
    return reply.redirect(url, 302);
  });

  /** Step two: Google sends the code here; exchange, verify, sign in, return. */
  app.get("/auth/google/callback", async (request, reply) => {
    const query = z
      .object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() })
      .parse(request.query);
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
    if (query.error || !query.code || !query.state) {
      return reply.redirect(`${env.siteOrigin}/account?error=${encodeURIComponent(query.error ?? "cancelled")}`, 302);
    }
    try {
      const { identity, returnTo } = await completeGoogleLogin({
        code: query.code,
        state: query.state,
        nonceCookie: request.cookies[OAUTH_STATE_COOKIE],
      });
      const account = await upsertAccount(identity);
      setSession(reply, await issueSession(account));
      return reply.redirect(`${env.siteOrigin}${returnTo}`, 302);
    } catch (error) {
      request.log.warn({ err: error }, "google callback rejected");
      return reply.redirect(`${env.siteOrigin}/account?error=signin`, 302);
    }
  });

  /** Token exchange for clients that obtained a Google ID token themselves. */
  app.post("/auth/google", async (request, reply) => {
    const { credential } = z.object({ credential: z.string().min(20) }).parse(request.body);
    let identity;
    try {
      identity = await verifyGoogleIdToken(credential);
    } catch (error) {
      request.log.warn({ err: error }, "google token rejected");
      return reply.code(401).send({ error: "google sign-in could not be verified" });
    }
    const account = await upsertAccount(identity);
    setSession(reply, await issueSession(account));
    return { account: publicAccount(account) };
  });

  app.get("/me", async (request, reply) => {
    const account = await sessionAccount(request);
    if (!account) return reply.code(401).send({ error: "not signed in" });
    return { account: publicAccount(account) };
  });

  /**
   * The dashboard in one call: SOL, every token held, every position with
   * what it has earned and how long it has left, and the account's own action
   * log. Pending rewards come from the projected pool, so they are what a
   * claim would pay right now.
   */
  app.get("/me/wallet", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const owner = new PublicKey(account.walletPubkey);

    const [sol, tokens2022, tokensLegacy, positions, actions] = await Promise.all([
      connection.getBalance(owner, "confirmed"),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      vise.fetchPositionsByOwner(owner),
      sql`SELECT kind, detail, signature, at FROM account_actions
          WHERE account_id = ${account.id} ORDER BY at DESC LIMIT 50`,
    ]);

    const holdings = [...tokens2022.value, ...tokensLegacy.value]
      .map((entry) => {
        const info = entry.account.data.parsed.info as {
          mint: string;
          tokenAmount: { amount: string; decimals: number; uiAmount: number | null };
        };
        return {
          mint: info.mint,
          amount: info.tokenAmount.amount,
          decimals: info.tokenAmount.decimals,
          tokenProgram: entry.account.owner.toBase58(),
        };
      })
      .filter((holding) => BigInt(holding.amount) > 0n);

    // Coin metadata for anything held or locked, in one query.
    const poolKeys = [...new Set(positions.map((p) => p.pool.toBase58()))];
    const mints = [...new Set(holdings.map((h) => h.mint))];
    const meta = await sql`
      SELECT mint, pool, symbol, name, image_url, token_decimals, price_lamports,
             total_weight, early_unlock_penalty_bps
      FROM pools WHERE pool = ANY(${poolKeys}) OR mint = ANY(${mints})
    `;
    const byPool: Record<string, (typeof meta)[number]> = {};
    const byMint: Record<string, (typeof meta)[number]> = {};
    for (const row of meta) {
      byPool[row.pool as string] = row;
      byMint[row.mint as string] = row;
    }

    const projected = Object.fromEntries(
      await Promise.all(
        [...new Set(positions.map((p) => byPool[p.pool.toBase58()]?.mint as string | undefined))]
          .filter((mint): mint is string => Boolean(mint))
          .map(async (mint) => [mint, await vise.fetchProjectedPool(new PublicKey(mint))] as const),
      ),
    );

    const now = Math.floor(Date.now() / 1000);
    let pendingTotal = 0n;
    let claimedTotal = 0n;
    const rows = positions.map((position) => {
      const info = byPool[position.pool.toBase58()];
      const mint = (info?.mint as string | undefined) ?? null;
      const pool = mint ? projected[mint] : null;
      const pending = pool ? accrued(position.weight, pool.accRewardPerWeight, position.rewardDebt) : 0n;
      pendingTotal += pending;
      claimedTotal += position.claimed;
      const penaltyBps = Number(info?.early_unlock_penalty_bps ?? 0);
      return {
        address: position.address.toBase58(),
        mint,
        symbol: (info?.symbol as string | null) ?? null,
        name: (info?.name as string | null) ?? null,
        imageUrl: (info?.image_url as string | null) ?? null,
        decimals: Number(info?.token_decimals ?? 6),
        index: position.index,
        amount: position.amount.toString(),
        weight: position.weight.toString(),
        multiplierBps: position.multiplierBps,
        lockStart: position.lockStart,
        lockEnd: position.lockEnd,
        secondsLeft: Math.max(position.lockEnd - now, 0),
        matured: position.lockEnd <= now,
        claimed: position.claimed.toString(),
        pending: pending.toString(),
        share: pool && pool.totalWeight > 0n ? Number(position.weight) / Number(pool.totalWeight) : 0,
        /** What breaking the lock right now would burn. */
        earlyExitBurn: earlyExitPenalty(position.amount, position.lockStart, position.lockEnd, now, penaltyBps).toString(),
      };
    });

    return {
      account: publicAccount(account),
      wallet: account.walletPubkey,
      sol: String(sol),
      holdings: holdings.map((holding) => ({
        ...holding,
        symbol: (byMint[holding.mint]?.symbol as string | null) ?? null,
        name: (byMint[holding.mint]?.name as string | null) ?? null,
        imageUrl: (byMint[holding.mint]?.image_url as string | null) ?? null,
        priceLamports: (byMint[holding.mint]?.price_lamports as number | null) ?? null,
        hasPool: Boolean(byMint[holding.mint]),
      })),
      positions: rows,
      totals: {
        pending: pendingTotal.toString(),
        claimed: claimedTotal.toString(),
        positions: rows.length,
      },
      actions: actions.map((row) => {
        const detail = row.detail as Record<string, unknown>;
        return {
          kind: row.kind as string,
          detail,
          signature: (row.signature as string | null) ?? null,
          failed: typeof detail.error === "string",
          at: row.at as Date,
        };
      }),
    };
  });

  /** Any protocol action, signed with the account's wallet. */
  app.post("/me/action", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const action = ActionSchema.parse(request.body);
    const keypair = await loadKeypair(account);
    try {
      const built = await buildAction(keypair.publicKey, action);
      const signature = await signAndSend(keypair, built.instructions);
      await recordAction(account, action.kind, { ...action, ...built.meta }, signature);
      return { signature, ...built.meta };
    } catch (error) {
      if (error instanceof ActionError) {
        await recordAction(account, action.kind, { ...action, error: error.message }, null);
        return reply.code(error.status).send({ error: error.message });
      }
      throw error;
    }
  });

  /**
   * Launch a coin from the account wallet. The mint keypair is generated here
   * and signs create_v2 alongside the wallet; it is discarded afterwards — a
   * pump mint has no further authority to exercise.
   */
  app.post("/me/launch", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const body = LaunchSchema.omit({ mint: true, stage: true }).parse(request.body);
    const keypair = await loadKeypair(account);
    const mintKeypair = Keypair.generate();
    const signatures: Array<{ label: string; signature: string }> = [];
    try {
      const create = await buildLaunch(keypair.publicKey, {
        ...body,
        mint: mintKeypair.publicKey.toBase58(),
        stage: "create",
      });
      for (const step of create.steps) {
        signatures.push({ label: step.label, signature: await signAndSend(keypair, step.instructions, [mintKeypair]) });
      }
      const finish = await buildLaunch(keypair.publicKey, {
        ...body,
        mint: mintKeypair.publicKey.toBase58(),
        stage: "finish",
      });
      for (const step of finish.steps) {
        signatures.push({ label: step.label, signature: await signAndSend(keypair, step.instructions) });
      }
      await recordAction(account, "launch", { mint: create.mint, pool: create.pool, ...body }, signatures.at(-1)?.signature ?? null);
      return { mint: create.mint, pool: create.pool, lockAmount: finish.lockAmount, signatures };
    } catch (error) {
      await recordAction(account, "launch", { ...body, completed: signatures, error: String(error) }, null);
      if (error instanceof ActionError) return reply.code(error.status).send({ error: error.message, completed: signatures });
      throw error;
    }
  });

  /**
   * Withdraw SOL or a token to any address. The wallet is the user's; there is
   * no balance the API will refuse to move except the rent floor SOL needs to
   * keep the account open.
   */
  app.post("/me/withdraw", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const body = z
      .object({
        to: pubkey,
        amount: lamports,
        /** Omit for SOL. */
        mint: pubkey.optional(),
      })
      .parse(request.body);
    const keypair = await loadKeypair(account);
    const to = new PublicKey(body.to);
    const amount = BigInt(body.amount);

    let instructions: TransactionInstruction[];
    if (!body.mint) {
      const balance = BigInt(await connection.getBalance(keypair.publicKey, "confirmed"));
      const rentFloor = BigInt(await connection.getMinimumBalanceForRentExemption(0));
      const fee = 10_000n;
      if (amount + rentFloor + fee > balance) {
        return reply.code(400).send({
          error: `not enough SOL: ${balance} lamports held, ${rentFloor + fee} must stay for rent and fees`,
        });
      }
      instructions = [
        ...budgetInstructions(50_000, 20_000),
        SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: to, lamports: amount }),
      ];
    } else {
      const mint = new PublicKey(body.mint);
      const mintInfo = await connection.getAccountInfo(mint);
      if (!mintInfo) return reply.code(404).send({ error: "mint not found" });
      const tokenProgram = mintInfo.owner;
      const decimals = mintInfo.data[44];
      const from = getAssociatedTokenAddressSync(mint, keypair.publicKey, true, tokenProgram);
      const dest = getAssociatedTokenAddressSync(mint, to, true, tokenProgram);
      instructions = [
        ...budgetInstructions(50_000, 60_000),
        createAssociatedTokenAccountIdempotentInstruction(keypair.publicKey, dest, to, mint, tokenProgram),
        createTransferCheckedInstruction(from, mint, dest, keypair.publicKey, amount, decimals, [], tokenProgram),
      ];
    }
    try {
      const signature = await signAndSend(keypair, instructions);
      await recordAction(account, "withdraw", body, signature);
      return { signature };
    } catch (error) {
      if (error instanceof ActionError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  /**
   * The wallet's secret key, for import into Phantom or anywhere else. The
   * account owns this wallet; VISE holding a copy is a convenience, not a
   * claim. Logged, so the account can see when it was exported.
   */
  app.post("/me/export-key", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const keypair = await loadKeypair(account);
    await recordAction(account, "export-key", {}, null);
    return { wallet: account.walletPubkey, secretKey: bs58.encode(keypair.secretKey) };
  });
}
