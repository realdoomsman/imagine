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
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from "@solana/web3.js";
import { claimableFor, earlyExitPenalty, formatSol } from "@vise/sdk";
import bs58 from "bs58";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ActionError, ActionSchema, buildAction, friendlyChainError, lamports, pubkey } from "../actions.ts";
import {
  beginGoogleLogin,
  clearSession,
  completeGoogleLogin,
  isRecentAuth,
  issueSession,
  loadKeypair,
  OAUTH_STATE_COOKIE,
  readSession,
  recordAction,
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
import { buildLaunch, compileV0, LaunchSchema } from "./tx.ts";

/**
 * Sign and send with the account's own key, confirmed against the blockhash
 * it was built with. The key exists in memory for the length of this call.
 */
async function signAndSend(
  keypair: Keypair,
  instructions: TransactionInstruction[],
  extraSigners: Keypair[] = [],
  lookupTables: AddressLookupTableAccount[] = [],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  // Always v0: nothing but this key signs here, so no wallet's support matters,
  // and a launch's create + dev buy only fits through its lookup table.
  const tx = compileV0(instructions, keypair.publicKey, blockhash, lookupTables);
  tx.sign([keypair, ...extraSigners]);
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  } catch (error) {
    // Simulation failures carry the program's error code; say what it means.
    throw new ActionError(409, friendlyChainError(error instanceof Error ? error.message : String(error)));
  }
  const result = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) {
    throw new ActionError(409, friendlyChainError(`transaction failed on chain: ${JSON.stringify(result.value.err)}`));
  }
  return signature;
}

/**
 * SOL a wallet must keep: rent for the system account plus one transaction
 * fee with headroom, so a "send everything" never strands the account or
 * fails at the fee.
 */
async function solReserve(): Promise<bigint> {
  const rent = BigInt(await connection.getMinimumBalanceForRentExemption(0));
  return rent + 20_000n;
}

/**
 * The signed-in account, or a 401 already sent. `recent` is for the routes
 * that move custody out (withdraw, export): they also want the sign-in itself
 * to be fresh, so a stolen week-old cookie cannot drain the wallet. A user
 * who just signed in always passes.
 */
async function requireAccount(
  request: FastifyRequest,
  reply: FastifyReply,
  { recent = false }: { recent?: boolean } = {},
): Promise<Account | null> {
  const session = await readSession(request);
  if (!session) {
    await reply.code(401).send({ error: "sign in first" });
    return null;
  }
  if (recent && !isRecentAuth(session.issuedAt)) {
    await reply.code(401).send({ error: "for your safety, sign in again to continue", reauth: true });
    return null;
  }
  return session.account;
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
  // Belt and braces over the Lax cookie: a state-changing request from a
  // browser must come from our own site. Requests without an Origin (curl,
  // scripts) are left to the cookie check.
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "POST") return;
    const origin = request.headers.origin;
    if (!origin) return;
    const allowed = env.corsOrigins.includes("*") || env.corsOrigins.includes(origin) || origin === env.siteOrigin;
    if (!allowed) await reply.code(403).send({ error: "cross-site request refused" });
  });

  /** Step one of the redirect flow: remember where to return, send to Google. */
  app.get("/auth/google/start", async (request, reply) => {
    const { return_to } = z.object({ return_to: z.string().max(400).default("/account") }).parse(request.query);
    const returnTo = return_to.startsWith("/") ? return_to : "/account";
    const { url, nonce } = await beginGoogleLogin(returnTo);
    // Google redirects back top-level; Lax cookies ride on that navigation.
    reply.setCookie(OAUTH_STATE_COOKIE, nonce, { ...sessionCookieOptions(), maxAge: 600 });
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

  /** Sign out everywhere: moving the epoch on voids every session the account holds. */
  app.post("/auth/logout", async (request, reply) => {
    const session = await readSession(request);
    if (session) await sql`UPDATE accounts SET session_epoch = session_epoch + 1 WHERE id = ${session.account.id}`;
    clearSession(reply);
    return { ok: true };
  });

  app.get("/me", async (request, reply) => {
    const session = await readSession(request);
    if (!session) return reply.code(401).send({ error: "not signed in" });
    return { account: publicAccount(session.account) };
  });

  /**
   * The dashboard in one call: SOL, every token held, every position with
   * what it has earned and how long it has left, and the account's own action
   * log. Pending rewards come from the projected pool, so they are what a
   * claim would pay right now. Several RPC reads a call, so it has a tighter
   * limit than the global one.
   */
  app.get("/me/wallet", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const owner = new PublicKey(account.walletPubkey);

    const [sol, reserve, tokens2022, tokensLegacy, positions, actions, [claimedEver]] = await Promise.all([
      connection.getBalance(owner, "confirmed"),
      solReserve(),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      vise.fetchPositionsByOwner(owner),
      sql`SELECT kind, detail, signature, at FROM account_actions
          WHERE account_id = ${account.id} ORDER BY at DESC LIMIT 50`,
      sql`SELECT COALESCE(SUM(amount), 0)::text AS total FROM claim_events WHERE owner = ${account.walletPubkey}`,
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
      const pending = pool ? claimableFor(position, pool) : 0n;
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
        minLockSecs: pool?.terms.minLockSecs ?? null,
        maxLockSecs: pool?.terms.maxLockSecs ?? null,
        /** Capped pools: the most this lock may ever be paid, in lamports. */
        rewardCap: pool?.capped ? position.rewardCap.toString() : null,
        /** What breaking the lock right now would burn. */
        earlyExitBurn: earlyExitPenalty(position.amount, position.lockStart, position.lockEnd, now, penaltyBps).toString(),
      };
    });
    const claimedIndexed = BigInt(String(claimedEver.total));

    return {
      account: publicAccount(account),
      wallet: account.walletPubkey,
      sol: String(sol),
      /** What a SOL withdrawal can actually take: balance less rent and a fee. */
      solAvailable: String(BigInt(sol) > reserve ? BigInt(sol) - reserve : 0n),
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
        // Lifetime, so a closed position's payouts still count. The indexed
        // events can trail the chain by a few seconds; open positions' on-chain
        // counters are the floor until they catch up.
        claimed: (claimedIndexed > claimedTotal ? claimedIndexed : claimedTotal).toString(),
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
    // `resume` names a mint this account already created whose launch stopped
    // partway; the finish stage skips whatever the chain shows done.
    const body = LaunchSchema.omit({ mint: true, stage: true })
      .extend({ resume: pubkey.optional() })
      .parse(request.body);
    if (body.resume) {
      // Only a coin this account's own launch created: finishing signs a pool
      // and a permanent fee routing with the account's key.
      const [launched] = await sql`
        SELECT 1 FROM account_actions
        WHERE account_id = ${account.id} AND kind = 'launch' AND detail->>'mint' = ${body.resume}
        LIMIT 1`;
      if (!launched) return reply.code(403).send({ error: "resume names a coin this account did not launch" });
    }
    const keypair = await loadKeypair(account);
    const mintKeypair = body.resume ? null : Keypair.generate();
    const mint = body.resume ?? (mintKeypair as Keypair).publicKey.toBase58();
    const signatures: Array<{ label: string; signature: string }> = [];
    try {
      if (mintKeypair) {
        const create = await buildLaunch(keypair.publicKey, { ...body, mint, stage: "create" });
        for (const step of create.steps) {
          signatures.push({ label: step.label, signature: await signAndSend(keypair, step.instructions, [mintKeypair], step.lookupTables) });
        }
      }
      const finish = await buildLaunch(keypair.publicKey, { ...body, mint, stage: "finish" });
      for (const step of finish.steps) {
        signatures.push({ label: step.label, signature: await signAndSend(keypair, step.instructions) });
      }
      await recordAction(account, "launch", { mint, pool: finish.pool, ...body }, signatures.at(-1)?.signature ?? null);
      return { mint, pool: finish.pool, lockAmount: finish.lockAmount, signatures };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordAction(account, "launch", { ...body, mint, completed: signatures, error: message }, null);
      // The coin exists once the first signature landed; tell the client so it
      // can offer to resume rather than launch a second coin.
      const created = body.resume !== undefined || signatures.length > 0;
      if (error instanceof ActionError) {
        return reply.code(error.status).send({ error: error.message, completed: signatures, resume: created ? mint : null });
      }
      request.log.error({ err: error }, "launch failed");
      return reply.code(502).send({ error: friendlyChainError(message), completed: signatures, resume: created ? mint : null });
    }
  });

  /**
   * Withdraw SOL or a token to any address. The wallet is the user's; there is
   * no balance the API will refuse to move except the rent floor SOL needs to
   * keep the account open.
   */
  app.post("/me/withdraw", async (request, reply) => {
    const account = await requireAccount(request, reply, { recent: true });
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
      const reserve = await solReserve();
      if (amount + reserve > balance) {
        const available = balance > reserve ? balance - reserve : 0n;
        return reply.code(400).send({
          error: `you can send up to ${formatSol(available)} SOL; the rest stays for rent and the network fee`,
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
    const account = await requireAccount(request, reply, { recent: true });
    if (!account) return;
    const keypair = await loadKeypair(account);
    await recordAction(account, "export-key", {}, null);
    return { wallet: account.walletPubkey, secretKey: bs58.encode(keypair.secretKey) };
  });
}
