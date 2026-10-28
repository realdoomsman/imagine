import { Keypair, PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import { decodePool, decodePosition } from "../src/accounts.ts";
import { ImagineClient } from "../src/client.ts";
import { ECONOMICS } from "../src/constants.ts";
import { accrued, type PoolTerms } from "../src/math.ts";
import { configPda, poolPda, positionPda } from "../src/pda.ts";
import {
  client,
  curveBuy,
  DAY,
  fundedKeypair,
  IMAGINE_PLATFORM,
  launchCoin,
  PROGRAM_ID,
  programDataAddress,
  rewardBalance,
  send,
  setUpgradeAuthority,
  setup,
  setVirtualQuote,
  TOKEN,
  tokenBalance,
  transferCoins,
  warp,
  WSOL,
  type Ctx,
  type LiteSVM,
  type Quote,
} from "./harness.ts";

/*
 * The suites run on the production economics with one deliberate override:
 * creators may take a share so that mechanism stays under test even though
 * the shipped default disables it. Everything else — curve, tiers, penalty,
 * lock window, release stream, treasury cut — is exactly what init-config
 * writes on chain.
 */
export const TEST_OVERRIDES = {
  maxCreatorShareBps: 3_000,
} as const;

export const POOL_TERMS: PoolTerms = {
  ...ImagineClient.defaultTerms(),
  ...TEST_OVERRIDES,
  creatorShareBps: 1000,
};

export const STREAM_SECS = ECONOMICS.rewardStreamSecs;

export function configArgs(treasury: PublicKey, overrides: Record<string, unknown> = {}) {
  return {
    ...ImagineClient.configArgs({ treasury, launchlabPlatform: IMAGINE_PLATFORM, overrides: TEST_OVERRIDES }),
    ...overrides,
  };
}

/**
 * The config may only be created by the program's upgrade authority, so the
 * harness installs a ProgramData account naming the signer.
 */
export async function initConfigIx(ctx: Ctx, admin: PublicKey, overrides: Record<string, unknown> = {}) {
  setUpgradeAuthority(ctx.svm, admin);
  return client.program.methods
    .initializeConfig(configArgs(ctx.treasury.publicKey, overrides) as never)
    .accountsPartial({
      admin,
      config: configPda(),
      program: PROGRAM_ID,
      programData: programDataAddress(),
    })
    .instruction();
}

export async function initConfig(ctx: Ctx, overrides: Record<string, unknown> = {}) {
  send(ctx.svm, [await initConfigIx(ctx, ctx.admin.publicKey, overrides)], [ctx.admin]);
}

export function readPool(svm: LiteSVM, mint: PublicKey) {
  const account = svm.getAccount(poolPda(mint));
  assert.ok(account, "pool account missing");
  return decodePool(Buffer.from(account.data));
}

export function readPosition(svm: LiteSVM, mint: PublicKey, owner: PublicKey, index: number) {
  const account = svm.getAccount(positionPda(mint, owner, index));
  if (!account || account.data.length === 0) return null;
  return decodePosition(Buffer.from(account.data));
}

export interface World extends Ctx {
  creator: Keypair;
  /** Holds coins bought at setup, for handing out to test lockers. */
  whale: Keypair;
  mint: PublicKey;
  quote: Quote;
}

/** Virtual quote reserve that makes a coin price "rich" (see `setVirtualQuote`). */
export const RICH_VIRTUAL_QUOTE = 1_000_000_000_000_000_000n;

/**
 * Launch a coin on Raydium LaunchLab under the IMAGINE platform, dev-buy, hand coins out, and
 * found the pool with the creator's lock.
 *
 * Every holder gets an exact coin amount from a whale who bought on the curve
 * at setup. Unless `realPrice` is set, the curve is then repriced "rich" so
 * that earnings caps never bind in tests about something else.
 */
export async function openPool(
  opts: {
    quote?: Quote;
    creatorShareBps?: number;
    initialLockAmount?: bigint;
    initialLockDuration?: number;
    creatorCoins?: bigint;
    extraHolders?: Array<{ owner: PublicKey; amount: bigint }>;
    config?: Record<string, unknown>;
    /** Keep LaunchLab's real curve price, so earnings caps bind realistically. */
    realPrice?: boolean;
    /** Quote the whale spends on the curve at setup (default 20 units). */
    whaleBuy?: bigint;
  } = {},
): Promise<World> {
  const quote = opts.quote ?? WSOL;
  const ctx = setup();
  await initConfig(ctx, opts.config ?? {});
  const creator = fundedKeypair(ctx.svm);
  const whale = fundedKeypair(ctx.svm);
  const { mint } = await launchCoin(ctx, creator, quote, {
    creatorShareBps: opts.creatorShareBps ?? 1000,
  });
  curveBuy(ctx.svm, whale, mint, quote, opts.whaleBuy ?? 20n * quote.unit);
  const creatorCoins = opts.creatorCoins ?? 500_000n * TOKEN;
  const have = tokenBalance(ctx.svm, mint, creator.publicKey);
  if (have < creatorCoins) transferCoins(ctx.svm, whale, creator.publicKey, mint, creatorCoins - have);
  for (const holder of opts.extraHolders ?? []) {
    transferCoins(ctx.svm, whale, holder.owner, mint, holder.amount);
  }
  if (!opts.realPrice) setVirtualQuote(ctx.svm, mint, quote, RICH_VIRTUAL_QUOTE);
  send(
    ctx.svm,
    [
      await client.found({
        creator: creator.publicKey,
        mint,
        quoteMint: quote.mint,
        initialLockAmount: opts.initialLockAmount ?? 10_000n * TOKEN,
        initialLockDuration: opts.initialLockDuration ?? 30 * DAY,
      }),
    ],
    [creator],
  );
  return { ...ctx, creator, whale, mint, quote };
}

/**
 * Let a pool's whole release window elapse and fold it into the accumulator.
 * Fees stream out over `reward_stream_secs`, so any test that deposits and
 * then expects a claimable balance has to let that time pass first.
 */
export async function settleStream(w: World, cranker: Keypair) {
  warp(w.svm, STREAM_SECS + 1);
  send(w.svm, [await client.sync({ mint: w.mint, quote: w.quote })], [cranker]);
}

/**
 * The one invariant that matters: a pool can never owe more than it holds.
 * Everything a pool has promised — unclaimed locker rewards, the creator's
 * cut, the treasury's cut, streaming and undistributable dust — must fit
 * inside the vault's distributable balance.
 */
export function assertSolvent(
  svm: LiteSVM,
  mint: PublicKey,
  positions: Array<{ owner: PublicKey; index: number }>,
) {
  const pool = readPool(svm, mint);
  let owedToLockers = 0n;
  for (const { owner, index } of positions) {
    const p = readPosition(svm, mint, owner, index);
    if (!p) continue;
    owedToLockers += accrued(p.weight, pool.accRewardPerWeight, p.rewardDebt);
  }
  const owed =
    owedToLockers +
    pool.creatorClaimable +
    pool.treasuryClaimable +
    pool.rewardRemainder +
    pool.undistributed;
  const held = rewardBalance(svm, mint);
  assert.ok(owed <= held, `pool insolvent: owes ${owed} but holds ${held} (delta ${owed - held})`);
  return { owed, held, owedToLockers };
}
