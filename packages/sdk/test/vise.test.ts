import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeConfig, decodePool, decodePosition } from "../src/accounts.ts";
import { ViseClient } from "../src/client.ts";
import { FeeKind } from "../src/constants.ts";
import {
  configPda,
  poolPda,
  positionPda,
  rewardVaultPda,
  tokenVaultPda,
} from "../src/pda.ts";
import {
  accrued,
  multiplierBps,
  projectSync,
  splitInflow,
  weightOf,
  type PoolTerms,
} from "../src/math.ts";
import {
  createMint,
  PROGRAM_ID,
  programDataAddress,
  setPumpCurve,
  setUpgradeAuthority,
  DAY,
  fundedKeypair,
  lamports,
  mintSupply,
  now,
  send,
  sendExpectingError,
  setup,
  tokenBalance,
  warp,
  type Ctx,
} from "./harness.ts";
import type { LiteSVM } from "litesvm";

const client = new ViseClient(new Connection("http://127.0.0.1:8899"));
const SOL = BigInt(LAMPORTS_PER_SOL);
const TOKEN = 1_000_000n; // one whole token at 6 decimals

const DEFAULT_CONFIG = {
  tradeFeeBps: 200,
  defaultTreasuryShareBps: 2000,
  maxCreatorShareBps: 3000,
  defaultMinLockSecs: 7 * DAY,
  defaultMaxLockSecs: 365 * DAY,
  defaultMaxMultiplierBps: 40_000,
  defaultEarlyUnlockPenaltyBps: 2500,
  defaultMinLockAmount: new BN(1_000_000),
  defaultRewardStreamSecs: 3_600,
  poolCreationFee: new BN(0.05 * LAMPORTS_PER_SOL),
  paused: false,
};

const POOL_TERMS: PoolTerms = {
  treasuryShareBps: DEFAULT_CONFIG.defaultTreasuryShareBps,
  creatorShareBps: 1000,
  minLockSecs: DEFAULT_CONFIG.defaultMinLockSecs,
  maxLockSecs: DEFAULT_CONFIG.defaultMaxLockSecs,
  maxMultiplierBps: DEFAULT_CONFIG.defaultMaxMultiplierBps,
  earlyUnlockPenaltyBps: DEFAULT_CONFIG.defaultEarlyUnlockPenaltyBps,
  minLockAmount: 1_000_000n,
  rewardStreamSecs: 3_600,
};

function configArgs(treasury: PublicKey, overrides: Record<string, unknown> = {}) {
  return { ...DEFAULT_CONFIG, treasury, ...overrides };
}

async function initConfig(ctx: Ctx, overrides: Record<string, unknown> = {}) {
  send(ctx.svm, [await initConfigIx(ctx, ctx.admin.publicKey, overrides)], [ctx.admin]);
}

/**
 * The config may only be created by the program's upgrade authority, so the
 * harness installs a ProgramData account naming the signer.
 */
async function initConfigIx(
  ctx: Ctx,
  admin: PublicKey,
  overrides: Record<string, unknown> = {},
) {
  setUpgradeAuthority(ctx.svm, admin);
  return client.program.methods
    .initializeConfig(configArgs(ctx.treasury.publicKey, overrides))
    .accountsPartial({
      admin,
      config: configPda(),
      program: PROGRAM_ID,
      programData: programDataAddress(),
    })
    .instruction();
}

const STREAM_SECS = 3_600;

/**
 * Let a pool's whole release window elapse and fold it into the accumulator.
 *
 * Fees do not land on lockers the instant they arrive — they stream out over
 * `reward_stream_secs` — so any test that deposits and then expects a claimable
 * balance has to let that time pass first.
 */
async function settleStream(w: World, cranker: Keypair) {
  warp(w.svm, STREAM_SECS + 1);
  send(w.svm, [await client.sync(w.mint)], [cranker]);
}

function readPool(svm: LiteSVM, mint: PublicKey) {
  const account = svm.getAccount(poolPda(mint));
  assert.ok(account, "pool account missing");
  return decodePool(Buffer.from(account.data));
}

function readPosition(svm: LiteSVM, mint: PublicKey, owner: PublicKey, index: number) {
  const account = svm.getAccount(positionPda(mint, owner, index));
  if (!account || account.data.length === 0) return null;
  return decodePosition(Buffer.from(account.data));
}

/**
 * The one invariant that matters: a pool can never owe more than it holds.
 * Everything a pool has promised — unclaimed locker rewards, the creator's
 * cut, the treasury's cut, and undistributable dust — must fit inside the
 * vault's spendable balance.
 */
function assertSolvent(
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
  const held = lamports(svm, rewardVaultPda(mint)) - pool.vaultReserve;
  assert.ok(
    owed <= held,
    `pool insolvent: owes ${owed} but holds ${held} (delta ${owed - held})`,
  );
  return { owed, held, owedToLockers };
}

interface World extends Ctx {
  creator: Keypair;
  mint: PublicKey;
  tokenProgram: PublicKey;
}

async function openPool(
  opts: {
    creatorShareBps?: number;
    initialLockAmount?: bigint;
    initialLockDuration?: number;
    extraHolders?: Array<{ owner: PublicKey; amount: bigint }>;
    config?: Record<string, unknown>;
  } = {},
): Promise<World> {
  const ctx = setup();
  await initConfig(ctx, opts.config ?? {});
  const creator = fundedKeypair(ctx.svm);
  const { mint, tokenProgram } = createMint(
    ctx.svm,
    creator,
    [
      { owner: creator.publicKey, amount: 500_000n * TOKEN },
      ...(opts.extraHolders ?? []),
    ],
    { metadataPointer: true },
  );
  setPumpCurve(ctx.svm, mint, creator.publicKey);
  const ix = await client.createPool({
    creator: creator.publicKey,
    mint,
    treasury: ctx.treasury.publicKey,
    tokenProgram,
    creatorShareBps: opts.creatorShareBps ?? 1000,
    initialLockAmount: opts.initialLockAmount ?? 10_000n * TOKEN,
    initialLockDuration: opts.initialLockDuration ?? 30 * DAY,
  });
  send(ctx.svm, [ix], [creator]);
  return { ...ctx, creator, mint, tokenProgram };
}

describe("config", () => {
  it("rejects parameters beyond the hard caps", async () => {
    const ctx = setup();
    const overCap = await initConfigIx(ctx, ctx.admin.publicKey, { tradeFeeBps: 1001 });
    const logs = sendExpectingError(ctx.svm, [overCap], [ctx.admin]);
    assert.match(logs, /InvalidParameter/);
  });

  it("refuses config writes from a non-admin", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const intruder = fundedKeypair(ctx.svm);
    const ix = await client.program.methods
      .updateConfig(configArgs(intruder.publicKey))
      .accountsPartial({ admin: intruder.publicKey, config: configPda() })
      .instruction();
    const logs = sendExpectingError(ctx.svm, [ix], [intruder]);
    assert.match(logs, /ConstraintHasOne|has one/i);
  });

  it("hands over admin in two steps", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const next = fundedKeypair(ctx.svm);
    const propose = await client.program.methods
      .transferAdmin(next.publicKey)
      .accountsPartial({ admin: ctx.admin.publicKey, config: configPda() })
      .instruction();
    send(ctx.svm, [propose], [ctx.admin]);

    const impostor = fundedKeypair(ctx.svm);
    const stolen = await client.program.methods
      .acceptAdmin()
      .accountsPartial({ pendingAdmin: impostor.publicKey, config: configPda() })
      .instruction();
    assert.match(
      sendExpectingError(ctx.svm, [stolen], [impostor]),
      /NotPendingAdmin/,
    );

    const accept = await client.program.methods
      .acceptAdmin()
      .accountsPartial({ pendingAdmin: next.publicKey, config: configPda() })
      .instruction();
    send(ctx.svm, [accept], [next]);
    const config = decodeConfig(Buffer.from(ctx.svm.getAccount(configPda())!.data));
    assert.equal(config.admin.toBase58(), next.publicKey.toBase58());
    assert.equal(config.pendingAdmin.toBase58(), PublicKey.default.toBase58());
  });
});

describe("pool creation", () => {
  it("opens with the creator's founding lock and a funded vault", async () => {
    const w = await openPool();
    const pool = readPool(w.svm, w.mint);
    assert.equal(pool.totalLocked, 10_000n * TOKEN);
    assert.ok(pool.totalWeight > 0n, "pool must have weight at birth");
    assert.equal(pool.openPositions, 1n);

    const position = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    const expected = multiplierBps(30 * DAY, POOL_TERMS);
    assert.equal(position.multiplierBps, expected);
    assert.ok(lamports(w.svm, rewardVaultPda(w.mint)) > 0n);
  });

  it("charges the pool creation fee to the treasury", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const before = lamports(ctx.svm, ctx.treasury.publicKey);
    const creator = fundedKeypair(ctx.svm);
    const { mint, tokenProgram } = createMint(
      ctx.svm,
      creator,
      [{ owner: creator.publicKey, amount: 100_000n * TOKEN }],
      { metadataPointer: true },
    );
    setPumpCurve(ctx.svm, mint, creator.publicKey);
    send(
      ctx.svm,
      [
        await client.createPool({
          creator: creator.publicKey,
          mint,
          treasury: ctx.treasury.publicKey,
          tokenProgram,
          creatorShareBps: 0,
          initialLockAmount: 1_000n * TOKEN,
          initialLockDuration: 7 * DAY,
        }),
      ],
      [creator],
    );
    assert.equal(
      lamports(ctx.svm, ctx.treasury.publicKey) - before,
      BigInt(0.05 * LAMPORTS_PER_SOL),
    );
  });

  it("rejects a creator share above the platform cap", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    const { mint, tokenProgram } = createMint(
      ctx.svm,
      creator,
      [{ owner: creator.publicKey, amount: 100_000n * TOKEN }],
      { metadataPointer: true },
    );
    setPumpCurve(ctx.svm, mint, creator.publicKey);
    const ix = await client.createPool({
      creator: creator.publicKey,
      mint,
      treasury: ctx.treasury.publicKey,
      tokenProgram,
      creatorShareBps: 3001,
      initialLockAmount: 1_000n * TOKEN,
      initialLockDuration: 7 * DAY,
    });
    assert.match(sendExpectingError(ctx.svm, [ix], [creator]), /InvalidParameter/);
  });

  it("refuses mints that can freeze the vault", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    const { mint, tokenProgram } = createMint(
      ctx.svm,
      creator,
      [{ owner: creator.publicKey, amount: 100_000n * TOKEN }],
      { metadataPointer: true, freezeAuthority: creator.publicKey },
    );
    setPumpCurve(ctx.svm, mint, creator.publicKey);
    const ix = await client.createPool({
      creator: creator.publicKey,
      mint,
      treasury: ctx.treasury.publicKey,
      tokenProgram,
      creatorShareBps: 0,
      initialLockAmount: 1_000n * TOKEN,
      initialLockDuration: 7 * DAY,
    });
    assert.match(sendExpectingError(ctx.svm, [ix], [creator]), /FreezeAuthoritySet/);
  });

  it("refuses mints that tax transfers", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    const { mint, tokenProgram } = createMint(
      ctx.svm,
      creator,
      [{ owner: creator.publicKey, amount: 100_000n * TOKEN }],
      { transferFee: true },
    );
    setPumpCurve(ctx.svm, mint, creator.publicKey);
    const ix = await client.createPool({
      creator: creator.publicKey,
      mint,
      treasury: ctx.treasury.publicKey,
      tokenProgram,
      creatorShareBps: 0,
      initialLockAmount: 1_000n * TOKEN,
      initialLockDuration: 7 * DAY,
    });
    assert.match(
      sendExpectingError(ctx.svm, [ix], [creator]),
      /UnsupportedMintExtension/,
    );
  });

  it("blocks new pools while paused but never existing ones", async () => {
    const w = await openPool();
    const pause = await client.program.methods
      .updateConfig(configArgs(w.treasury.publicKey, { paused: true }))
      .accountsPartial({ admin: w.admin.publicKey, config: configPda() })
      .instruction();
    send(w.svm, [pause], [w.admin]);

    const other = fundedKeypair(w.svm);
    const { mint: mint2, tokenProgram } = createMint(
      w.svm,
      other,
      [{ owner: other.publicKey, amount: 100_000n * TOKEN }],
      { metadataPointer: true },
    );
    const blocked = await client.createPool({
      creator: other.publicKey,
      mint: mint2,
      treasury: w.treasury.publicKey,
      tokenProgram,
      creatorShareBps: 0,
      initialLockAmount: 1_000n * TOKEN,
      initialLockDuration: 7 * DAY,
    });
    assert.match(sendExpectingError(w.svm, [blocked], [other]), /Paused/);

    // The live pool keeps working: deposits, and therefore claims, still flow.
    const trader = fundedKeypair(w.svm);
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: SOL,
          kind: FeeKind.Buy,
        }),
      ],
      [trader],
    );
    await settleStream(w, trader);
    send(
      w.svm,
      [
        await client.claim({ owner: w.creator.publicKey, mint: w.mint, index: 0 }),
      ],
      [w.creator],
    );
  });
});

describe("rewards", () => {
  it("splits every inflow by the pool's frozen terms", async () => {
    const w = await openPool({ creatorShareBps: 1000 });
    const trader = fundedKeypair(w.svm);
    const deposit = 10n * SOL;
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: deposit,
          kind: FeeKind.Buy,
        }),
      ],
      [trader],
    );

    const pool = readPool(w.svm, w.mint);
    const expected = splitInflow(deposit, {
      treasuryShareBps: 2000,
      creatorShareBps: 1000,
    });
    assert.equal(pool.treasuryClaimable, expected.toTreasury);
    assert.equal(pool.creatorClaimable, expected.toCreator);
    // The lockers' share is queued, not handed out: it streams over the window.
    assert.equal(pool.undistributed, expected.toLockers);
    assert.equal(pool.lifetimeRewards, 0n);
    assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);

    await settleStream(w, trader);
    const after = readPool(w.svm, w.mint);
    assert.equal(after.undistributed, 0n);
    assert.equal(
      after.lifetimeRewards + after.rewardRemainder,
      expected.toLockers,
      "every queued lamport must reach lockers once the window elapses",
    );
    assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);
  });

  it("projects a sync off-chain exactly as the program performs it", async () => {
    // The API quotes "pending" from this projection between touches. If it
    // drifts from the program by a single lamport, the UI shows a number the
    // claim instruction will not pay.
    const alice = Keypair.generate();
    const w = await openPool({
      initialLockAmount: 5_000n * TOKEN,
      initialLockDuration: 30 * DAY,
      extraHolders: [{ owner: alice.publicKey, amount: 50_000n * TOKEN }],
    });
    w.svm.airdrop(alice.publicKey, 10n * SOL);
    send(
      w.svm,
      [
        await client.lock({
          owner: alice.publicKey,
          mint: w.mint,
          index: 0,
          amount: 40_000n * TOKEN,
          durationSecs: 90 * DAY,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [alice],
    );

    const trader = fundedKeypair(w.svm);
    // First inflow starts a stream; a partial release then a second, unsynced
    // inflow exercises every branch: release, fold, restart.
    send(
      w.svm,
      [await client.depositReward({ payer: trader.publicKey, mint: w.mint, lamports: 3n * SOL, kind: FeeKind.Buy })],
      [trader],
    );
    warp(w.svm, Math.floor(STREAM_SECS / 3));
    // Land lamports without touching the pool, the way pump's distribution does.
    const vault = rewardVaultPda(w.mint);
    const untouched = 7n * SOL / 10n;
    w.svm.airdrop(vault, untouched);
    warp(w.svm, 17);

    const before = readPool(w.svm, w.mint);
    const vaultLamports = lamports(w.svm, vault);
    const projected = projectSync(before, vaultLamports, now(w.svm));

    send(w.svm, [await client.sync(w.mint)], [trader]);
    const after = readPool(w.svm, w.mint);

    assert.equal(projected.accRewardPerWeight, after.accRewardPerWeight, "accumulator");
    assert.equal(projected.rewardRemainder, after.rewardRemainder, "remainder");
    assert.equal(projected.undistributed, after.undistributed, "undistributed");
    assert.equal(projected.streamRate, after.streamRate, "stream rate");
    assert.equal(projected.streamEnd, after.streamEnd, "stream end");
    assert.equal(projected.lastStreamAt, after.lastStreamAt, "last stream at");
    assert.equal(projected.lastVaultBalance, after.lastVaultBalance, "vault floor");
    assert.equal(projected.lifetimeInflow, after.lifetimeInflow, "lifetime inflow");
    assert.equal(projected.lifetimeRewards, after.lifetimeRewards, "lifetime rewards");
    assert.equal(projected.treasuryClaimable, after.treasuryClaimable, "treasury claimable");
    assert.equal(projected.creatorClaimable, after.creatorClaimable, "creator claimable");
    assert.equal(projected.lifetimeTreasury, after.lifetimeTreasury, "lifetime treasury");
    assert.equal(projected.lifetimeCreator, after.lifetimeCreator, "lifetime creator");
    assert.equal(projected.inflow, untouched, "the unsynced inflow is the airdrop");

    // And the number a locker sees is the number a claim pays.
    const position = readPosition(w.svm, w.mint, alice.publicKey, 0);
    assert.ok(position, "alice's position exists");
    const quoted = accrued(position.weight, projected.accRewardPerWeight, position.rewardDebt);
    const balanceBefore = lamports(w.svm, alice.publicKey);
    send(w.svm, [await client.claim({ owner: alice.publicKey, mint: w.mint, index: 0 })], [alice]);
    const paid = lamports(w.svm, alice.publicKey) - balanceBefore + 5_000n; // tx fee
    assert.equal(paid, quoted, "claim pays exactly what the projection quoted");
  });

  it("pays lockers in proportion to weight, not principal", async () => {
    const alice = Keypair.generate();
    const bob = Keypair.generate();
    const w = await openPool({
      initialLockAmount: 1_000n * TOKEN,
      initialLockDuration: 7 * DAY,
      extraHolders: [
        { owner: alice.publicKey, amount: 100_000n * TOKEN },
        { owner: bob.publicKey, amount: 100_000n * TOKEN },
      ],
    });
    w.svm.airdrop(alice.publicKey, 10n * SOL);
    w.svm.airdrop(bob.publicKey, 10n * SOL);

    // Same principal, very different terms.
    send(
      w.svm,
      [
        await client.lock({
          owner: alice.publicKey,
          mint: w.mint,
          index: 0,
          amount: 10_000n * TOKEN,
          durationSecs: 7 * DAY,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [alice],
    );
    send(
      w.svm,
      [
        await client.lock({
          owner: bob.publicKey,
          mint: w.mint,
          index: 0,
          amount: 10_000n * TOKEN,
          durationSecs: 365 * DAY,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [bob],
    );

    const trader = fundedKeypair(w.svm, 500);
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: 100n * SOL,
          kind: FeeKind.Sell,
        }),
      ],
      [trader],
    );

    await settleStream(w, trader);

    const aliceBefore = lamports(w.svm, alice.publicKey);
    const bobBefore = lamports(w.svm, bob.publicKey);
    send(
      w.svm,
      [await client.claim({ owner: alice.publicKey, mint: w.mint, index: 0 })],
      [alice],
    );
    send(
      w.svm,
      [await client.claim({ owner: bob.publicKey, mint: w.mint, index: 0 })],
      [bob],
    );
    const aliceGain = lamports(w.svm, alice.publicKey) - aliceBefore + 5_000n;
    const bobGain = lamports(w.svm, bob.publicKey) - bobBefore + 5_000n;

    // Bob committed for a year at 4.0x against Alice's 7 days at 1.0x.
    const ratio = Number(bobGain) / Number(aliceGain);
    assert.ok(ratio > 3.9 && ratio < 4.1, `weight ratio was ${ratio}`);
    assertSolvent(w.svm, w.mint, [
      { owner: w.creator.publicKey, index: 0 },
      { owner: alice.publicKey, index: 0 },
      { owner: bob.publicKey, index: 0 },
    ]);
  });

  it("gives a late locker nothing from fees that predate the lock", async () => {
    const latecomer = Keypair.generate();
    const w = await openPool({
      extraHolders: [{ owner: latecomer.publicKey, amount: 100_000n * TOKEN }],
    });
    w.svm.airdrop(latecomer.publicKey, 10n * SOL);

    const trader = fundedKeypair(w.svm);
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: 50n * SOL,
          kind: FeeKind.Buy,
        }),
      ],
      [trader],
    );
    send(
      w.svm,
      [
        await client.lock({
          owner: latecomer.publicKey,
          mint: w.mint,
          index: 0,
          amount: 50_000n * TOKEN,
          durationSecs: 365 * DAY,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [latecomer],
    );

    const position = readPosition(w.svm, w.mint, latecomer.publicKey, 0)!;
    const pool = readPool(w.svm, w.mint);
    const claimable = accrued(position.weight, pool.accRewardPerWeight, position.rewardDebt);
    assert.equal(claimable, 0n, "a new lock must start with zero accrued");

    const ix = await client.claim({
      owner: latecomer.publicKey,
      mint: w.mint,
      index: 0,
    });
    assert.match(sendExpectingError(w.svm, [ix], [latecomer]), /NothingToClaim/);
  });

  it("pays the treasury, not the next locker, when nobody is locked", async () => {
    // Weight only reaches zero if every position exits, so drive it there.
    const w = await openPool({
      initialLockAmount: 1_000n * TOKEN,
      initialLockDuration: 7 * DAY,
    });
    warp(w.svm, 8 * DAY);
    send(
      w.svm,
      [
        await client.unlock({
          owner: w.creator.publicKey,
          mint: w.mint,
          index: 0,
          early: false,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [w.creator],
    );
    assert.equal(readPool(w.svm, w.mint).totalWeight, 0n);

    const trader = fundedKeypair(w.svm);
    const treasuryBefore = readPool(w.svm, w.mint).treasuryClaimable;
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: SOL,
          kind: FeeKind.Donation,
        }),
      ],
      [trader],
    );
    await settleStream(w, trader);

    const after = readPool(w.svm, w.mint);
    // With nobody locked there is nobody to pay, so the lockers' share must not
    // sit in a pot that the first dust locker could scoop whole.
    assert.equal(after.rewardRemainder, 0n);
    assert.equal(after.undistributed, 0n);
    assert.equal(after.lifetimeRewards, 0n);
    // The creator's cut is still the creator's; only the lockers' share is
    // reassigned, because there are no lockers to receive it.
    const split = splitInflow(SOL, { treasuryShareBps: 2000, creatorShareBps: 1000 });
    assert.equal(
      after.treasuryClaimable - treasuryBefore,
      split.toTreasury + split.toLockers,
      "the lockers' share must land on the treasury, not in a scoopable pot",
    );
    assert.equal(after.creatorClaimable, split.toCreator);

    // And a locker arriving afterwards starts from zero, with nothing to scoop.
    send(
      w.svm,
      [
        await client.lock({
          owner: w.creator.publicKey,
          mint: w.mint,
          index: 1,
          amount: 1_000n * TOKEN,
          durationSecs: 7 * DAY,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [w.creator],
    );
    const claimIx = await client.claim({
      owner: w.creator.publicKey,
      mint: w.mint,
      index: 1,
    });
    assert.match(sendExpectingError(w.svm, [claimIx], [w.creator]), /NothingToClaim/);
    assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 1 }]);
  });
});

describe("positions", () => {
  it("rejects locks that are too small or mistermed", async () => {
    const w = await openPool();
    const tooShort = await client.lock({
      owner: w.creator.publicKey,
      mint: w.mint,
      index: 5,
      amount: 1_000n * TOKEN,
      durationSecs: DAY,
      tokenProgram: w.tokenProgram,
    });
    assert.match(sendExpectingError(w.svm, [tooShort], [w.creator]), /InvalidDuration/);

    const tooLong = await client.lock({
      owner: w.creator.publicKey,
      mint: w.mint,
      index: 6,
      amount: 1_000n * TOKEN,
      durationSecs: 400 * DAY,
      tokenProgram: w.tokenProgram,
    });
    assert.match(sendExpectingError(w.svm, [tooLong], [w.creator]), /InvalidDuration/);

    const dust = await client.lock({
      owner: w.creator.publicKey,
      mint: w.mint,
      index: 7,
      amount: 999n,
      durationSecs: 30 * DAY,
      tokenProgram: w.tokenProgram,
    });
    assert.match(sendExpectingError(w.svm, [dust], [w.creator]), /AmountTooSmall/);
  });

  it("will not let one wallet claim another's position", async () => {
    const thief = Keypair.generate();
    const w = await openPool({
      extraHolders: [{ owner: thief.publicKey, amount: 10_000n * TOKEN }],
    });
    w.svm.airdrop(thief.publicKey, 10n * SOL);
    const trader = fundedKeypair(w.svm);
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: 5n * SOL,
          kind: FeeKind.Buy,
        }),
      ],
      [trader],
    );

    const ix = await client.claim({
      owner: w.creator.publicKey,
      mint: w.mint,
      index: 0,
    });
    // Swap in the thief as signer while pointing at the creator's position.
    ix.keys[0] = { pubkey: thief.publicKey, isSigner: true, isWritable: true };
    assert.match(
      sendExpectingError(w.svm, [ix], [thief]),
      /ConstraintSeeds|ConstraintHasOne|seeds/i,
    );
  });

  it("extends only forward and reprices the multiplier", async () => {
    const w = await openPool({ initialLockDuration: 30 * DAY });
    const before = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;

    const shorten = await client.extend({
      owner: w.creator.publicKey,
      mint: w.mint,
      index: 0,
      durationSecs: 7 * DAY,
      tokenProgram: w.tokenProgram,
    });
    assert.match(sendExpectingError(w.svm, [shorten], [w.creator]), /NotAnExtension/);

    send(
      w.svm,
      [
        await client.extend({
          owner: w.creator.publicKey,
          mint: w.mint,
          index: 0,
          durationSecs: 365 * DAY,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [w.creator],
    );

    const after = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    assert.equal(after.multiplierBps, 40_000);
    assert.ok(after.weight > before.weight);
    assert.ok(after.lockEnd > before.lockEnd);
  });

  it("adds principal without moving the unlock time", async () => {
    const w = await openPool({ initialLockDuration: 90 * DAY });
    const before = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    send(
      w.svm,
      [
        await client.increase({
          owner: w.creator.publicKey,
          mint: w.mint,
          index: 0,
          amount: 5_000n * TOKEN,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [w.creator],
    );
    const after = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    assert.equal(after.amount, before.amount + 5_000n * TOKEN);
    assert.equal(after.lockEnd, before.lockEnd);
    assert.equal(after.multiplierBps, before.multiplierBps);
    assert.equal(after.weight, weightOf(after.amount, after.multiplierBps));
    assert.equal(readPool(w.svm, w.mint).totalLocked, after.amount);
  });
});

describe("exits", () => {
  it("returns principal and rewards on a matured unlock", async () => {
    const w = await openPool({ initialLockDuration: 7 * DAY });
    const trader = fundedKeypair(w.svm);
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: 20n * SOL,
          kind: FeeKind.Buy,
        }),
      ],
      [trader],
    );

    const tokensBefore = tokenBalance(
      w.svm,
      w.mint,
      w.creator.publicKey,
      w.tokenProgram,
    );
    const solBefore = lamports(w.svm, w.creator.publicKey);
    warp(w.svm, 8 * DAY);
    send(
      w.svm,
      [
        await client.unlock({
          owner: w.creator.publicKey,
          mint: w.mint,
          index: 0,
          early: false,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [w.creator],
    );

    assert.equal(
      tokenBalance(w.svm, w.mint, w.creator.publicKey, w.tokenProgram) -
        tokensBefore,
      10_000n * TOKEN,
    );
    assert.ok(lamports(w.svm, w.creator.publicKey) > solBefore);
    assert.equal(readPosition(w.svm, w.mint, w.creator.publicKey, 0), null);
    const pool = readPool(w.svm, w.mint);
    assert.equal(pool.totalLocked, 0n);
    assert.equal(pool.totalWeight, 0n);
  });

  it("refuses to unlock before term", async () => {
    const w = await openPool({ initialLockDuration: 30 * DAY });
    const ix = await client.unlock({
      owner: w.creator.publicKey,
      mint: w.mint,
      index: 0,
      early: false,
      tokenProgram: w.tokenProgram,
    });
    assert.match(sendExpectingError(w.svm, [ix], [w.creator]), /StillLocked/);
  });

  it("burns principal and hands forfeited rewards to the stayers", async () => {
    const quitter = Keypair.generate();
    const stayer = Keypair.generate();
    const w = await openPool({
      initialLockAmount: 1_000n * TOKEN,
      initialLockDuration: 7 * DAY,
      extraHolders: [
        { owner: quitter.publicKey, amount: 100_000n * TOKEN },
        { owner: stayer.publicKey, amount: 100_000n * TOKEN },
      ],
    });
    w.svm.airdrop(quitter.publicKey, 10n * SOL);
    w.svm.airdrop(stayer.publicKey, 10n * SOL);

    for (const [who, dur] of [
      [quitter, 100 * DAY],
      [stayer, 100 * DAY],
    ] as const) {
      send(
        w.svm,
        [
          await client.lock({
            owner: who.publicKey,
            mint: w.mint,
            index: 0,
            amount: 50_000n * TOKEN,
            durationSecs: dur,
            tokenProgram: w.tokenProgram,
          }),
        ],
        [who],
      );
    }

    const trader = fundedKeypair(w.svm);
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: 40n * SOL,
          kind: FeeKind.Buy,
        }),
      ],
      [trader],
    );

    const poolBefore = readPool(w.svm, w.mint);
    const stayerPos = readPosition(w.svm, w.mint, stayer.publicKey, 0)!;
    const stayerBefore = accrued(
      stayerPos.weight,
      poolBefore.accRewardPerWeight,
      stayerPos.rewardDebt,
    );
    const supplyBefore = mintSupply(w.svm, w.mint);
    const quitterTokensBefore = tokenBalance(
      w.svm,
      w.mint,
      quitter.publicKey,
      w.tokenProgram,
    );

    warp(w.svm, 50 * DAY); // half the term served
    send(
      w.svm,
      [
        await client.unlock({
          owner: quitter.publicKey,
          mint: w.mint,
          index: 0,
          early: true,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [quitter],
    );

    // 25% penalty, halved because half the term was served → 12.5% burned.
    const returned =
      tokenBalance(w.svm, w.mint, quitter.publicKey, w.tokenProgram) -
      quitterTokensBefore;
    const burned = supplyBefore - mintSupply(w.svm, w.mint);
    assert.equal(returned + burned, 50_000n * TOKEN);
    const burnedPct = Number(burned) / Number(50_000n * TOKEN);
    assert.ok(
      burnedPct > 0.12 && burnedPct < 0.13,
      `expected ~12.5% burned, got ${(burnedPct * 100).toFixed(2)}%`,
    );
    assert.equal(readPool(w.svm, w.mint).lifetimeBurned, burned);

    // The stayer's claim strictly grew: the quitter's accrued SOL moved to them.
    const poolAfter = readPool(w.svm, w.mint);
    const stayerAfter = accrued(
      stayerPos.weight,
      poolAfter.accRewardPerWeight,
      stayerPos.rewardDebt,
    );
    assert.ok(
      stayerAfter > stayerBefore,
      `forfeited rewards must reach stayers (${stayerBefore} -> ${stayerAfter})`,
    );
    assertSolvent(w.svm, w.mint, [
      { owner: w.creator.publicKey, index: 0 },
      { owner: stayer.publicKey, index: 0 },
    ]);
  });

  it("charges no penalty for an early exit at the very end of term", async () => {
    const w = await openPool({ initialLockDuration: 7 * DAY });
    const supplyBefore = mintSupply(w.svm, w.mint);
    warp(w.svm, 7 * DAY - 2);
    send(
      w.svm,
      [
        await client.unlock({
          owner: w.creator.publicKey,
          mint: w.mint,
          index: 0,
          early: true,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [w.creator],
    );
    const burned = supplyBefore - mintSupply(w.svm, w.mint);
    assert.ok(burned < 10_000n, `penalty should round to dust, burned ${burned}`);
  });
});

describe("payouts", () => {
  it("pays the creator and treasury only what the split allocated", async () => {
    const w = await openPool({ creatorShareBps: 2000 });
    const trader = fundedKeypair(w.svm);
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: 10n * SOL,
          kind: FeeKind.Buy,
        }),
      ],
      [trader],
    );
    const pool = readPool(w.svm, w.mint);
    const creatorDue = pool.creatorClaimable;
    const treasuryDue = pool.treasuryClaimable;

    const treasuryBefore = lamports(w.svm, w.treasury.publicKey);
    const cranker = fundedKeypair(w.svm);
    send(
      w.svm,
      [
        await client.claimTreasury({
          payer: cranker.publicKey,
          mint: w.mint,
          treasury: w.treasury.publicKey,
        }),
      ],
      [cranker],
    );
    assert.equal(
      lamports(w.svm, w.treasury.publicKey) - treasuryBefore,
      treasuryDue,
    );

    const creatorBefore = lamports(w.svm, w.creator.publicKey);
    send(
      w.svm,
      [
        await client.claimCreator({
          creator: w.creator.publicKey,
          mint: w.mint,
        }),
      ],
      [w.creator],
    );
    assert.ok(
      lamports(w.svm, w.creator.publicKey) - creatorBefore + 5_000n >= creatorDue,
    );

    const after = readPool(w.svm, w.mint);
    assert.equal(after.creatorClaimable, 0n);
    assert.equal(after.treasuryClaimable, 0n);
    assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);
  });

  it("refuses to pay the treasury cut to an attacker's account", async () => {
    const w = await openPool();
    const trader = fundedKeypair(w.svm);
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: SOL,
          kind: FeeKind.Buy,
        }),
      ],
      [trader],
    );
    const attacker = fundedKeypair(w.svm);
    const ix = await client.claimTreasury({
      payer: attacker.publicKey,
      mint: w.mint,
      treasury: attacker.publicKey,
    });
    assert.match(
      sendExpectingError(w.svm, [ix], [attacker]),
      /TreasuryMismatch|ConstraintAddress/,
    );
  });

  it("refuses to pay the creator cut to anyone else", async () => {
    const w = await openPool();
    const trader = fundedKeypair(w.svm);
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: SOL,
          kind: FeeKind.Buy,
        }),
      ],
      [trader],
    );
    const attacker = fundedKeypair(w.svm);
    const ix = await client.claimCreator({
      creator: attacker.publicKey,
      mint: w.mint,
    });
    assert.match(
      sendExpectingError(w.svm, [ix], [attacker]),
      /TreasuryMismatch|ConstraintAddress/,
    );
  });
});

describe("solvency under churn", () => {
  it("never owes more than it holds across a long random sequence", async () => {
    const actors = Array.from({ length: 6 }, () => Keypair.generate());
    const w = await openPool({
      initialLockAmount: 5_000n * TOKEN,
      initialLockDuration: 30 * DAY,
      extraHolders: actors.map((a) => ({
        owner: a.publicKey,
        amount: 200_000n * TOKEN,
      })),
    });
    for (const a of actors) w.svm.airdrop(a.publicKey, 200n * SOL);
    const trader = fundedKeypair(w.svm, 500);

    const live: Array<{ who: Keypair; index: number }> = [];
    const tracked = [{ owner: w.creator.publicKey, index: 0 }];
    // Deterministic 32-bit LCG so a failure is reproducible. `Math.imul` keeps
    // the multiply exact; plain `*` overflows past 2^53 and degrades to NaN.
    let seed = 42 >>> 0;
    const rand = (n: number) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % n;
    };

    for (let step = 0; step < 60; step++) {
      const action = rand(10);
      if (action < 4) {
        const who = actors[rand(actors.length)];
        const index = step + 1;
        const durations = [7, 30, 90, 180, 365];
        try {
          send(
            w.svm,
            [
              await client.lock({
                owner: who.publicKey,
                mint: w.mint,
                index,
                amount: BigInt(1 + rand(20_000)) * TOKEN,
                durationSecs: durations[rand(durations.length)] * DAY,
                tokenProgram: w.tokenProgram,
              }),
            ],
            [who],
          );
          live.push({ who, index });
          tracked.push({ owner: who.publicKey, index });
        } catch {
          // Out of tokens for this actor; skip.
        }
      } else if (action < 8) {
        send(
          w.svm,
          [
            await client.depositReward({
              payer: trader.publicKey,
              mint: w.mint,
              lamports: BigInt(1 + rand(3_000_000_000)),
              kind: rand(4),
            }),
          ],
          [trader],
        );
      } else if (action === 8 && live.length > 0) {
        const pick = live.splice(rand(live.length), 1)[0];
        try {
          send(
            w.svm,
            [
              await client.claim({
                owner: pick.who.publicKey,
                mint: w.mint,
                index: pick.index,
              }),
            ],
            [pick.who],
          );
          live.push(pick);
        } catch {
          live.push(pick);
        }
      } else if (live.length > 0) {
        const pick = live.splice(rand(live.length), 1)[0];
        send(
          w.svm,
          [
            await client.unlock({
              owner: pick.who.publicKey,
              mint: w.mint,
              index: pick.index,
              early: true,
              tokenProgram: w.tokenProgram,
            }),
          ],
          [pick.who],
        );
      }
      warp(w.svm, 1 + rand(3 * DAY));
      assertSolvent(w.svm, w.mint, tracked);
    }

    // Drain everything that is still owed and confirm the vault covers it.
    const cranker = fundedKeypair(w.svm);
    send(
      w.svm,
      [
        await client.claimTreasury({
          payer: cranker.publicKey,
          mint: w.mint,
          treasury: w.treasury.publicKey,
        }),
      ],
      [cranker],
    );
    send(
      w.svm,
      [await client.claimCreator({ creator: w.creator.publicKey, mint: w.mint })],
      [w.creator],
    );
    // Claim on behalf of every position that ever existed, so anything still
    // owed to a locker is actually paid out before the final check.
    const signerFor: Record<string, Keypair> = Object.fromEntries([
      [w.creator.publicKey.toBase58(), w.creator],
      ...actors.map((a) => [a.publicKey.toBase58(), a] as const),
    ]);
    for (const { owner, index } of tracked) {
      if (!readPosition(w.svm, w.mint, owner, index)) continue;
      const signer = signerFor[owner.toBase58()];
      try {
        send(
          w.svm,
          [await client.claim({ owner, mint: w.mint, index })],
          [signer],
        );
      } catch (err) {
        // NothingToClaim is a valid terminal state; anything else is a bug.
        assert.match(String(err), /NothingToClaim/);
      }
    }
    const final = assertSolvent(w.svm, w.mint, tracked);
    assert.equal(final.owedToLockers, 0n, "every locker must be payable to zero");
    // Residual dust stays in the vault; it must be bounded, not a leak.
    assert.ok(
      final.held - final.owed < BigInt(tracked.length + 60) * 2n,
      `unexpected residue ${final.held - final.owed} lamports`,
    );
  });
});

/**
 * Regressions for the pre-mainnet audit. Each of these passed before the fix
 * and is the cheapest way to notice if one is ever undone.
 */
describe("audit regressions", () => {
  it("refuses to top up a matured position", async () => {
    // Before the fix this minted full-multiplier weight against principal that
    // could be withdrawn the same slot, with no lock term and no penalty.
    const w = await openPool({ initialLockDuration: 7 * DAY });
    warp(w.svm, 8 * DAY);
    const ix = await client.increase({
      owner: w.creator.publicKey,
      mint: w.mint,
      index: 0,
      amount: 100_000n * TOKEN,
      tokenProgram: w.tokenProgram,
    });
    assert.match(sendExpectingError(w.svm, [ix], [w.creator]), /PositionMatured/);
  });

  it("prices a top-up on the term still to run, not the original one", async () => {
    const w = await openPool({ initialLockDuration: 365 * DAY });
    const before = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    assert.equal(before.multiplierBps, 40_000);

    // 358 days in, a week of commitment remains: that is what it should buy.
    warp(w.svm, 358 * DAY);
    send(
      w.svm,
      [
        await client.increase({
          owner: w.creator.publicKey,
          mint: w.mint,
          index: 0,
          amount: 100_000n * TOKEN,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [w.creator],
    );
    const after = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    assert.ok(
      after.multiplierBps < 11_000,
      `expected a near-1x multiplier for the week left, got ${after.multiplierBps}`,
    );
    assert.equal(after.weight, weightOf(after.amount, after.multiplierBps));
  });

  it("gives weight added after a deposit no claim on it", async () => {
    // The flash-lock: watch lamports land, lock, sync, claim, leave.
    const sniper = Keypair.generate();
    const w = await openPool({
      extraHolders: [{ owner: sniper.publicKey, amount: 400_000n * TOKEN }],
    });
    w.svm.airdrop(sniper.publicKey, 20n * SOL);

    const trader = fundedKeypair(w.svm, 200);
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: 50n * SOL,
          kind: FeeKind.Buy,
        }),
      ],
      [trader],
    );

    // Same slot: a far larger lock than the honest one, then claim immediately.
    send(
      w.svm,
      [
        await client.lock({
          owner: sniper.publicKey,
          mint: w.mint,
          index: 0,
          amount: 400_000n * TOKEN,
          durationSecs: 365 * DAY,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [sniper],
    );
    const claimIx = await client.claim({
      owner: sniper.publicKey,
      mint: w.mint,
      index: 0,
    });
    assert.match(
      sendExpectingError(w.svm, [claimIx], [sniper]),
      /NothingToClaim/,
      "a lock placed after the fees arrived must not capture them",
    );
    assertSolvent(w.svm, w.mint, [
      { owner: w.creator.publicKey, index: 0 },
      { owner: sniper.publicKey, index: 0 },
    ]);
  });

  it("refuses a pool from anyone but the coin's creator", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const realCreator = fundedKeypair(ctx.svm);
    const squatter = fundedKeypair(ctx.svm);
    const { mint, tokenProgram } = createMint(
      ctx.svm,
      squatter,
      [{ owner: squatter.publicKey, amount: 100_000n * TOKEN }],
      { metadataPointer: true },
    );
    // pump says the coin belongs to someone else.
    setPumpCurve(ctx.svm, mint, realCreator.publicKey);

    const ix = await client.createPool({
      creator: squatter.publicKey,
      mint,
      treasury: ctx.treasury.publicKey,
      tokenProgram,
      creatorShareBps: 3000,
      initialLockAmount: 1_000n * TOKEN,
      initialLockDuration: 7 * DAY,
    });
    assert.match(sendExpectingError(ctx.svm, [ix], [squatter]), /NotCoinCreator/);
  });

  it("refuses config creation by anyone but the upgrade authority", async () => {
    const ctx = setup();
    const impostor = fundedKeypair(ctx.svm);
    // ProgramData names the real admin; the impostor signs anyway.
    setUpgradeAuthority(ctx.svm, ctx.admin.publicKey);
    const ix = await client.program.methods
      .initializeConfig(configArgs(ctx.treasury.publicKey))
      .accountsPartial({
        admin: impostor.publicKey,
        config: configPda(),
        program: PROGRAM_ID,
        programData: programDataAddress(),
      })
      .instruction();
    assert.match(
      sendExpectingError(ctx.svm, [ix], [impostor]),
      /NotUpgradeAuthority/,
    );
  });

  it("lets a keeper close a matured position, paying the owner", async () => {
    const w = await openPool({ initialLockDuration: 7 * DAY });
    const trader = fundedKeypair(w.svm, 200);
    send(
      w.svm,
      [
        await client.depositReward({
          payer: trader.publicKey,
          mint: w.mint,
          lamports: 10n * SOL,
          kind: FeeKind.Buy,
        }),
      ],
      [trader],
    );
    await settleStream(w, trader);
    warp(w.svm, 8 * DAY);

    const keeper = fundedKeypair(w.svm);
    const ownerSolBefore = lamports(w.svm, w.creator.publicKey);
    const ownerTokensBefore = tokenBalance(
      w.svm,
      w.mint,
      w.creator.publicKey,
      w.tokenProgram,
    );
    const keeperBefore = lamports(w.svm, keeper.publicKey);

    send(
      w.svm,
      [
        await client.unlock({
          owner: w.creator.publicKey,
          mint: w.mint,
          index: 0,
          early: false,
          payer: keeper.publicKey,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [keeper],
    );

    // Everything lands on the owner; the keeper only pays the fee.
    assert.ok(lamports(w.svm, w.creator.publicKey) > ownerSolBefore);
    assert.ok(
      tokenBalance(w.svm, w.mint, w.creator.publicKey, w.tokenProgram) >
        ownerTokensBefore,
    );
    assert.ok(lamports(w.svm, keeper.publicKey) < keeperBefore);
    assert.equal(readPosition(w.svm, w.mint, w.creator.publicKey, 0), null);
    assert.equal(readPool(w.svm, w.mint).totalWeight, 0n);
  });

  it("refuses to let a keeper break someone else's live lock", async () => {
    const w = await openPool({ initialLockDuration: 90 * DAY });
    const keeper = fundedKeypair(w.svm);
    const ix = await client.unlock({
      owner: w.creator.publicKey,
      mint: w.mint,
      index: 0,
      early: true,
      payer: keeper.publicKey,
      tokenProgram: w.tokenProgram,
    });
    assert.match(sendExpectingError(w.svm, [ix], [keeper]), /NotPositionOwner/);
  });
});

describe("token vault accounting", () => {
  it("keeps the vault balance equal to total locked", async () => {
    const other = Keypair.generate();
    const w = await openPool({
      extraHolders: [{ owner: other.publicKey, amount: 100_000n * TOKEN }],
    });
    w.svm.airdrop(other.publicKey, 10n * SOL);
    send(
      w.svm,
      [
        await client.lock({
          owner: other.publicKey,
          mint: w.mint,
          index: 0,
          amount: 25_000n * TOKEN,
          durationSecs: 90 * DAY,
          tokenProgram: w.tokenProgram,
        }),
      ],
      [other],
    );
    const pool = readPool(w.svm, w.mint);
    const vaultAccount = w.svm.getAccount(tokenVaultPda(w.mint))!;
    const vaultAmount = Buffer.from(vaultAccount.data).readBigUInt64LE(64);
    assert.equal(vaultAmount, pool.totalLocked);

    const weightCheck = weightOf(
      25_000n * TOKEN,
      multiplierBps(90 * DAY, POOL_TERMS),
    );
    const position = readPosition(w.svm, w.mint, other.publicKey, 0)!;
    assert.equal(position.weight, weightCheck);
  });
});
