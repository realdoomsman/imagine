import { setTimeout as sleep } from "node:timers/promises";
import {
  PUMP_SDK,
  feeSharingConfigPda,
  getBuyTokenAmountFromSolAmount,
  type BondingCurve,
} from "@pump-fun/pump-sdk";
import { BN } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PACKET_DATA_SIZE,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from "@solana/web3.js";
import { ammVaultsFor, formatTokenAmount, poolPda, type PoolAccount } from "@imagine/sdk";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ActionError,
  ActionSchema,
  assertInWindow,
  buildAction,
  lamports,
  lockDuration,
  pubkey,
} from "../actions.ts";
import { sql } from "../db.ts";
import { env } from "../env.ts";
import {
  budgetInstructions,
  createAndBuyInstructions,
  DEV_BUY_SLIPPAGE_PERCENT,
  fetchCurve,
  onlinePump,
  routeCreatorFeesToPool,
} from "../pump.ts";
import { connection, vise } from "../solana.ts";

/**
 * Serialise an unsigned transaction for the browser to sign.
 *
 * These routes never hold a key. They assemble instructions, set the payer and
 * a fresh blockhash, and hand the bytes back; the user's wallet is the signer.
 * (VISE accounts — Google sign-in — go through /me/tx instead, where the
 * server signs with the account's own wallet.)
 *
 * Legacy unless `lookupTables` is non-empty, in which case it is a v0
 * transaction resolved through them; every wallet signs a legacy one, so v0 is
 * used only where the bytes need it.
 */
export async function serialize(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  lookupTables: AddressLookupTableAccount[] = [],
): Promise<{ transaction: string; blockhash: string; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  let bytes: Uint8Array;
  if (lookupTables.length > 0) {
    bytes = compileV0(instructions, payer, blockhash, lookupTables).serialize();
  } else {
    const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
    tx.add(...instructions);
    bytes = tx.serialize({ requireAllSignatures: false });
  }
  return { transaction: Buffer.from(bytes).toString("base64"), blockhash, lastValidBlockHeight };
}

/** An unsigned v0 transaction; `lookupTables` may be empty. */
export function compileV0(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  blockhash: string,
  lookupTables: AddressLookupTableAccount[],
): VersionedTransaction {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions });
  return new VersionedTransaction(message.compileToV0Message(lookupTables));
}

/** Whether the v0 transaction, signatures included, fits in one packet. */
function fitsV0(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  lookupTables: AddressLookupTableAccount[],
): boolean {
  try {
    // The blockhash only has to be 32 bytes; any key will do for measuring.
    return compileV0(instructions, payer, PublicKey.default.toBase58(), lookupTables).serialize().length <= PACKET_DATA_SIZE;
  } catch {
    return false; // web3.js throws while encoding anything that overruns the packet
  }
}

const LOOKUP_TABLE_TTL_MS = 5 * 60_000;
let lookupTableCache: { at: number; table: AddressLookupTableAccount | null } | null = null;

/**
 * The launch lookup table named by `LAUNCH_ALT`, or null when it is unset,
 * missing, or being deactivated. Refreshed every few minutes so an operator
 * extending it is picked up without a restart; a table is append-only, so a
 * cached copy never resolves an index to the wrong key.
 */
async function launchLookupTable(): Promise<AddressLookupTableAccount | null> {
  if (!env.launchAlt) return null;
  if (lookupTableCache && Date.now() - lookupTableCache.at < LOOKUP_TABLE_TTL_MS) return lookupTableCache.table;
  const { value } = await connection.getAddressLookupTable(env.launchAlt);
  const table = value && value.isActive() ? value : null;
  if (!table) console.warn(`LAUNCH_ALT ${env.launchAlt.toBase58()} is not an active lookup table; launches send the dev buy separately`);
  lookupTableCache = { at: Date.now(), table };
  return table;
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
  /** The founding lock's term in seconds, inside the config's default window. */
  lockDurationSecs: lockDuration,
  priorityFeeMicroLamports: z.number().int().min(0).max(10_000_000).default(200_000),
});

export type LaunchRequest = z.infer<typeof LaunchSchema>;

/** One transaction of a launch, in the order it must land. */
export interface LaunchStep {
  label: string;
  instructions: TransactionInstruction[];
  /**
   * Set when the step only fits as a v0 transaction resolved through these
   * tables; compile it with `compileV0` (or `serialize(…, lookupTables)`).
   */
  lookupTables?: AddressLookupTableAccount[];
}

/** Compute for create_v2 + the creator's token account + buy_v2, with headroom. */
const CREATE_AND_BUY_UNITS = 400_000;

/**
 * Nobody but VISE launches a coin called VISE: fakes have used the site to
 * pass as the official coin. Catches the ticker inside a longer one and
 * common letter swaps (1/l/|/! for i, 0 for o, a leading $).
 */
function impersonatesVise(name: string, symbol: string): boolean {
  const fold = (text: string) =>
    text.toLowerCase().replace(/[1l|!]/g, "i").replace(/0/g, "o").replace(/[^a-z]/g, "");
  return fold(symbol).includes("vise") || name.split(/\s+/).some((word) => fold(word).startsWith("vise"));
}

/**
 * Launch, as an ordered set of transactions signed back to back.
 *
 * The order is load-bearing:
 *   1. `create_v2` and the dev buy — the mint and bonding curve must exist
 *      before anything can reference them, and a pool cannot open without the
 *      creator's founding lock. They share one transaction (v0, through the
 *      `LAUNCH_ALT` lookup table; ~1457 bytes as legacy) so nobody can buy
 *      between the create and the creator's own buy. Without the table the
 *      buy moves to the finish stage and is exposed to that race.
 *   2. `create_pool` — opens the pool and locks the creator's share. It
 *      proves the signer launched the coin by reading pump's
 *      `BondingCurve::creator`, so it must run before step 3 rewrites that
 *      field to the sharing config.
 *   3. fee sharing — points the coin's creator-fee stream at the lock pool
 *      and revokes its own admin, making the routing permanent.
 *
 * Steps 2–3 are built against state that step 1 creates, so `stage` selects
 * which half to build; callers ask for the second once the first confirmed.
 * The create step is signed by the mint keypair as well as the creator.
 */
export async function buildLaunch(
  creator: PublicKey,
  body: LaunchRequest,
): Promise<{
  mint: string;
  pool: string;
  expectedTokens?: string;
  lockAmount?: string;
  steps: LaunchStep[];
}> {
  const mint = new PublicKey(body.mint);
  const devBuy = BigInt(body.devBuyLamports);
  if (devBuy <= 0n) {
    throw new ActionError(400, "a launch needs a dev buy: the creator must lock coins to open the pool");
  }

  if (body.stage === "create") {
    if (impersonatesVise(body.name, body.symbol)) {
      throw new ActionError(403, "the VISE name and ticker are reserved for the official $VISE coin");
    }
    // The metadata must be the document pinned here for this mint, whose
    // website is the coin's VISE page. See routes/metadata.ts.
    const [pinned] = await sql`
      SELECT 1 FROM pinned_metadata WHERE uri = ${body.uri} AND mint = ${mint.toBase58()}
    `;
    if (!pinned) {
      throw new ActionError(400, "pin the coin's metadata through vise.fun for this mint before launching");
    }
    // Only coins created by this flow may ever get a VISE pool. The mint is
    // registered before the create is built, and never for a coin that
    // already exists: that is what stops a finish stage from adopting a coin
    // launched anywhere else.
    if (await fetchCurve(mint)) {
      throw new ActionError(409, "this coin already exists; VISE pools are only for coins launched on vise.fun");
    }
    await sql`
      INSERT INTO launched_mints (mint, creator) VALUES (${mint.toBase58()}, ${creator.toBase58()})
      ON CONFLICT (mint) DO NOTHING
    `;
    const table = await launchLookupTable();
    if (table) {
      const [global, feeConfig] = await Promise.all([
        onlinePump.fetchGlobal(),
        onlinePump.fetchFeeConfig().catch(() => null),
      ]);
      // Priced on the curve create_v2 is about to write: nothing else can
      // trade it before this buy, so the quote is exact.
      const tokensOut = getBuyTokenAmountFromSolAmount({
        global,
        feeConfig,
        mintSupply: null,
        bondingCurve: null,
        amount: new BN(devBuy.toString()),
        quoteMint: PublicKey.default,
      });
      const instructions = [
        ...budgetInstructions(body.priorityFeeMicroLamports, CREATE_AND_BUY_UNITS),
        ...(await createAndBuyInstructions({
          global,
          mint,
          creator,
          name: body.name,
          symbol: body.symbol,
          uri: body.uri,
          devBuyLamports: devBuy,
          tokensOut,
        })),
      ];
      if (fitsV0(instructions, creator, [table])) {
        return {
          mint: mint.toBase58(),
          pool: poolPda(mint).toBase58(),
          expectedTokens: tokensOut.toString(),
          steps: [{ label: "Create the coin and buy the first bag", instructions, lookupTables: [table] }],
        };
      }
      console.warn("launch: create_v2 + dev buy overruns a packet even through LAUNCH_ALT; re-run scripts/create-alt.ts. Sending the dev buy separately");
    }
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
      steps: [
        { label: "Create the coin", instructions: [...budgetInstructions(body.priorityFeeMicroLamports, 400_000), createIx] },
      ],
    };
  }

  // Stage two: only for a coin this flow registered, for the same creator.
  const [launched] = await sql`SELECT creator FROM launched_mints WHERE mint = ${mint.toBase58()}`;
  if (!launched || launched.creator !== creator.toBase58()) {
    throw new ActionError(403, "VISE pools are only for coins launched on vise.fun");
  }
  // The curve exists. It is requested the moment the create confirms, and a
  // load-balanced RPC can answer from a node that has not seen that slot yet,
  // so a missing curve is retried briefly before it is believed.
  let coin = await readCoin(creator, mint);
  for (let attempt = 0; !coin && attempt < 10; attempt += 1) {
    await sleep(1_500);
    coin = await readCoin(creator, mint);
  }
  if (!coin) throw new ActionError(409, "coin not created yet; run the create stage first");
  return buildFinish(creator, coin, {
    devBuy,
    lockPercent: body.lockPercent,
    lockDurationSecs: body.lockDurationSecs,
    priorityFeeMicroLamports: body.priorityFeeMicroLamports,
  });
}

/** Everything the finish steps are decided from, read once. */
interface CoinState {
  mint: PublicKey;
  curveInfo: AccountInfo<Buffer>;
  decoded: BondingCurve;
  /** SPL Token or Token-2022, whichever owns the mint. */
  tokenProgram: PublicKey;
  ataInfo: AccountInfo<Buffer> | null;
  held: bigint;
  existingPool: PoolAccount | null;
  sharing: AccountInfo<Buffer> | null;
}

/** Read a pump coin as seen by `creator`; null when it has no bonding curve. */
async function readCoin(creator: PublicKey, mint: PublicKey): Promise<CoinState | null> {
  const [curve, mintInfo] = await Promise.all([fetchCurve(mint), connection.getAccountInfo(mint)]);
  if (!curve || !mintInfo) return null;
  const tokenProgram = mintInfo.owner;
  // Every other path (swap, lock, the indexer's metadata read) is Token-2022,
  // which is what pump.fun's create_v2 mints. Older SPL-Token pump coins would
  // get a pool nobody could lock into through VISE, so they are refused here.
  if (!tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new ActionError(409, "VISE supports pump.fun's current Token-2022 coins; this one uses the older SPL Token program");
  }
  const ata = getAssociatedTokenAddressSync(mint, creator, true, tokenProgram);
  const [ataInfo, held, existingPool, sharing] = await Promise.all([
    connection.getAccountInfo(ata),
    connection.getTokenAccountBalance(ata).then((b) => BigInt(b.value.amount)).catch(() => 0n),
    vise.fetchPool(mint),
    connection.getAccountInfo(feeSharingConfigPda(mint)),
  ]);
  return {
    mint,
    curveInfo: curve.accountInfo,
    decoded: PUMP_SDK.decodeBondingCurve(curve.accountInfo),
    tokenProgram,
    ataInfo,
    held,
    existingPool,
    sharing,
  };
}

interface FinishResult {
  mint: string;
  pool: string;
  expectedTokens: string;
  lockAmount: string;
  steps: LaunchStep[];
}

const short = (key: PublicKey) => `${key.toBase58().slice(0, 4)}…${key.toBase58().slice(-4)}`;

/** pump coins all have 6 decimals. */
const TOKEN_DECIMALS = 6;

/**
 * Whether `creator` may finish this launch, decided before any step is built.
 * The ordering constraint is the launch's: `create_pool` proves the signer
 * launched the coin by reading `BondingCurve::creator`, which fee sharing
 * rewrites. So a coin whose fee sharing was already turned on can never get a
 * pool — that routing is permanent and points elsewhere.
 */
function assertFinishable(creator: PublicKey, coin: CoinState): void {
  if (coin.sharing) {
    if (coin.existingPool) throw new ActionError(409, "this coin is already on VISE");
    throw new ActionError(
      409,
      "pump.fun fee sharing was already turned on for this coin. That setting is permanent, so its creator fees can no longer be pointed at a VISE pool",
    );
  }
  // Until fee sharing lands, the curve still names the launching wallet, and
  // both remaining steps (create_pool, the fee routing) require it to sign.
  if (!coin.decoded.creator.equals(creator)) {
    throw new ActionError(
      403,
      `only the wallet that launched this coin can finish its launch (launched by ${short(coin.decoded.creator)})`,
    );
  }
  const quote = coin.decoded.quoteMint;
  if (!quote.equals(PublicKey.default) && !quote.equals(NATIVE_MINT)) {
    throw new ActionError(409, "this coin trades against a token other than SOL; VISE pools are paid in SOL");
  }
}

/**
 * The half of a launch that puts the coin on VISE: [dev buy] → `create_pool`
 * (founding lock) → route creator fees to the pool.
 *
 * Every step is skipped if the chain already shows it done, so a run that
 * stopped halfway (a dropped connection, a stale blockhash) resumes with the
 * same mint instead of buying twice.
 */
async function buildFinish(
  creator: PublicKey,
  coin: CoinState,
  options: {
    devBuy: bigint;
    lockPercent: number;
    lockDurationSecs: number;
    priorityFeeMicroLamports: number;
  },
): Promise<FinishResult> {
  assertFinishable(creator, coin);
  const { mint, curveInfo, decoded, tokenProgram, ataInfo, held, existingPool } = coin;
  const budget = budgetInstructions(options.priorityFeeMicroLamports, 400_000);

  const steps: LaunchStep[] = [];
  // The bag in the wallet is the founding lock's basis: normally the dev buy
  // already landed with the create.
  let expected = held;
  if (!existingPool) {
    const [global, feeConfig, supply] = await Promise.all([
      onlinePump.fetchGlobal(),
      onlinePump.fetchFeeConfig().catch(() => null),
      connection.getTokenSupply(mint),
    ]);
    const expectedTokens = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: new BN(supply.value.amount),
      bondingCurve: decoded,
      amount: new BN(options.devBuy.toString()),
      quoteMint: PublicKey.default,
    });
    const devBuyOut = BigInt(expectedTokens.toString());
    // The dev buy counts as landed only once the wallet holds most of what it
    // would buy now: anyone can send the creator's token account a few units,
    // and that must not stand in for the founding bag. After an atomic
    // create + buy this always holds (the curve has since moved against the
    // same SOL), so the finish stage carries no buy; it buys only for a coin
    // created without one — the two-step flow when LAUNCH_ALT is unset.
    if (held * 10n < devBuyOut * 9n) {
      expected = devBuyOut;
      const buyIxs = await PUMP_SDK.buyV2Instructions({
        global,
        bondingCurveAccountInfo: curveInfo,
        bondingCurve: decoded,
        associatedUserAccountInfo: ataInfo,
        mint,
        user: creator,
        amount: expectedTokens,
        quoteAmount: new BN(options.devBuy.toString()),
        slippage: DEV_BUY_SLIPPAGE_PERCENT,
      });
      steps.push({ label: "Buy the first bag", instructions: [...budget, ...buyIxs] });
    }
  }
  const lockAmount = existingPool
    ? existingPool.totalLocked
    : (expected * BigInt(options.lockPercent)) / 100n;

  if (!existingPool) {
    const config = await vise.fetchConfig();
    if (!config) throw new Error("VISE config is not initialised on this cluster; run scripts/init-config.ts");
    if (lockAmount < config.defaultMinLockAmount) {
      throw new ActionError(
        409,
        held === 0n && steps.length === 0
          ? "this wallet holds none of this coin; the pool opens with your founding lock, so buy some first"
          : `a founding lock of ${formatTokenAmount(lockAmount, TOKEN_DECIMALS)} is below the pool minimum of ${formatTokenAmount(config.defaultMinLockAmount, TOKEN_DECIMALS)}; hold more of the coin or lock a larger share`,
      );
    }
    assertInWindow(options.lockDurationSecs, {
      minLockSecs: config.defaultMinLockSecs,
      maxLockSecs: config.defaultMaxLockSecs,
    });
    const poolIx = await vise.createPool({
      creator,
      mint,
      treasury: config.treasury,
      tokenProgram,
      // Creators take no cut of their lockers; the split is 90 / 10 / 0.
      creatorShareBps: 0,
      initialLockAmount: lockAmount,
      initialLockDuration: options.lockDurationSecs,
      // A launch resumed after its coin graduated is priced off its AMM pool.
      ammVaults: decoded.complete ? ammVaultsFor(mint, tokenProgram) : undefined,
    });
    steps.push({ label: "Open the pool and clamp your bag", instructions: [...budget, poolIx] });
  }
  // assertFinishable refused a coin whose sharing config already exists.
  const routeIxs = await routeCreatorFeesToPool({ creator, mint, graduated: decoded.complete });
  steps.push({ label: "Lock the fee stream to holders", instructions: [...budget, ...routeIxs] });

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
