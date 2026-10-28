import {
  createCloseAccountInstruction,
  createInitializeAccount3Instruction,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createTransferCheckedInstruction,
  ExtensionType,
  getAccountLenForMint,
  getMintLen,
  unpackMint,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeConfig } from "../src/accounts.ts";
import { ImagineClient } from "../src/client.ts";
import { ECONOMICS, FeeKind, metadataUri } from "../src/constants.ts";
import { configPda, rewardTokenAccount, rewardVaultPda, tokenVaultPda } from "../src/pda.ts";
import {
  accrued,
  claimableFor,
  earlyExitPenalty,
  multiplierBps,
  projectSync,
  rewardCapFor,
  splitInflow,
  weightOf,
} from "../src/math.ts";
import {
  addTokenAmount,
  client,
  coinAta,
  curveBuy,
  DAY,
  fundedKeypair,
  fundQuote,
  fundRaising,
  IMAGINE_PLATFORM,
  lamports,
  launchCoin,
  mintSupply,
  now,
  PROGRAM_ID,
  programDataAddress,
  quoteAta,
  quoteHeld,
  readLaunchLabPool,
  rewardBalance,
  send,
  sendExpectingError,
  setUpgradeAuthority,
  setup,
  setVirtualQuote,
  SPYX,
  SUPPLY,
  TOKEN,
  TOKEN_2022_PROGRAM_ID,
  tokenAmount,
  tokenBalance,
  TOTAL_SELL,
  transferCoins,
  warp,
  WSOL,
  type Ctx,
  type LiteSVM,
  type Quote,
} from "./harness.ts";
import {
  assertSolvent,
  configArgs,
  initConfig,
  initConfigIx,
  openPool,
  POOL_TERMS,
  readPool,
  readPosition,
  settleStream,
  STREAM_SECS,
  type World,
} from "./world.ts";

const QUOTES: Quote[] = [WSOL, SPYX];
/** Lamports a single-signature transaction costs its fee payer. */
const SIG_FEE = 5_000n;

/** Fee to add back when measuring a signer's own quote gain: lamports on SOL, nothing on a token quote. */
const feeIn = (q: Quote) => (q === WSOL ? SIG_FEE : 0n);
const held = (w: World, owner: PublicKey) => quoteHeld(w.svm, owner, w.quote);

function lockIx(w: World, owner: PublicKey, index: number, amount: bigint, durationSecs: number) {
  return client.lock({ owner, mint: w.mint, quote: w.quote, index, amount, durationSecs });
}

/** A `deposit_reward` from `payer`, funding its quote ATA first on a token quote. */
async function depositIx(w: World, payer: Keypair, amount: bigint, kind: number = FeeKind.Buy) {
  if (w.quote !== WSOL) fundQuote(w.svm, payer, payer.publicKey, w.quote, amount);
  return client.depositReward({ payer: payer.publicKey, mint: w.mint, quote: w.quote, amount, kind });
}

/** Deposit `amount` quote base units as fees; returns the (new or given) payer. */
async function deposit(w: World, amount: bigint, kind: number = FeeKind.Buy, payer?: Keypair) {
  const trader =
    payer ?? fundedKeypair(w.svm, w.quote === WSOL ? Number(amount / w.quote.unit) + 10 : 10);
  send(w.svm, [await depositIx(w, trader, amount, kind)], [trader]);
  return trader;
}

/** Land quote in the reward vault without touching the pool (a direct transfer, or a creator fee claimed straight to the vault, does this). */
function landUnsynced(svm: LiteSVM, mint: PublicKey, q: Quote, amount: bigint) {
  if (q === WSOL) {
    svm.airdrop(rewardVaultPda(mint), amount);
  } else {
    addTokenAmount(svm, rewardTokenAccount(mint, q.mint, q.tokenProgram)!, amount);
  }
}

/** Quote base units `amount` coins are worth on the curve, as `price::coin_value` reads it. */
function coinValue(svm: LiteSVM, mint: PublicKey, q: Quote, amount: bigint) {
  const ll = readLaunchLabPool(svm, mint, q);
  return (amount * (ll.virtualQuote + ll.realQuote)) / (ll.virtualBase - ll.realBase);
}

/** Reprice the curve so 10,000 whole coins are worth `quotePer10k` quote base units (to rounding). */
function setCoinPrice(svm: LiteSVM, mint: PublicKey, q: Quote, quotePer10k: bigint) {
  const ll = readLaunchLabPool(svm, mint, q);
  const virtualQuote = (quotePer10k * (ll.virtualBase - ll.realBase)) / (10_000n * TOKEN) - ll.realQuote;
  assert.ok(virtualQuote > 0n, "price too low for this curve");
  setVirtualQuote(svm, mint, q, virtualQuote);
}

/**
 * `openPool`, but founded at a chosen price (10,000 coins = `quotePer10k`), so
 * the founding lock's earnings cap is known and binds.
 */
async function openPricedPool(
  opts: {
    quote: Quote;
    creatorShareBps?: number;
    initialLockAmount?: bigint;
    initialLockDuration?: number;
    extraHolders?: Array<{ owner: PublicKey; amount: bigint }>;
  },
  quotePer10k: bigint,
): Promise<World> {
  const quote = opts.quote;
  const ctx = setup();
  await initConfig(ctx);
  const creator = fundedKeypair(ctx.svm);
  const whale = fundedKeypair(ctx.svm);
  const { mint } = await launchCoin(ctx, creator, quote, { creatorShareBps: opts.creatorShareBps ?? 1000 });
  curveBuy(ctx.svm, whale, mint, quote, 20n * quote.unit);
  const have = tokenBalance(ctx.svm, mint, creator.publicKey);
  if (have < 500_000n * TOKEN) transferCoins(ctx.svm, whale, creator.publicKey, mint, 500_000n * TOKEN - have);
  for (const holder of opts.extraHolders ?? []) {
    transferCoins(ctx.svm, whale, holder.owner, mint, holder.amount);
  }
  setCoinPrice(ctx.svm, mint, quote, quotePer10k);
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

/** A `launch` instruction and the mint keypair that must co-sign it. */
async function launchIx(
  ctx: Ctx,
  creator: Keypair,
  quote: { mint: PublicKey; tokenProgram: PublicKey },
  globalConfig: PublicKey,
  creatorShareBps = 0,
  fundRaise = fundRaising(WSOL),
) {
  const mintKp = Keypair.generate();
  const ix = await client.launch({
    creator: creator.publicKey,
    mint: mintKp.publicKey,
    quote,
    treasury: ctx.treasury.publicKey,
    name: "Imagine Test",
    symbol: "IMGT",
    uri: metadataUri(mintKp.publicKey),
    platform: IMAGINE_PLATFORM,
    supply: SUPPLY,
    totalSell: TOTAL_SELL,
    fundRaising: fundRaise,
    creatorShareBps,
    globalConfig,
  });
  return { ix, mintKp };
}

/** A Token-2022 mint carrying a TransferFeeConfig. */
function createFeeMint(
  svm: LiteSVM,
  payer: Keypair,
  opts: { configAuthority: PublicKey | null; feeBps: number },
): PublicKey {
  const mintKp = Keypair.generate();
  const space = getMintLen([ExtensionType.TransferFeeConfig]);
  send(
    svm,
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKp.publicKey,
        space,
        lamports: Number(svm.minimumBalanceForRentExemption(BigInt(space))),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        mintKp.publicKey,
        opts.configAuthority,
        null,
        opts.feeBps,
        1_000_000n,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMintInstruction(mintKp.publicKey, 6, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    ],
    [payer, mintKp],
  );
  return mintKp.publicKey;
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
      .updateConfig(configArgs(intruder.publicKey) as never)
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
    assert.match(sendExpectingError(ctx.svm, [stolen], [impostor]), /NotPendingAdmin/);

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
    const expected = multiplierBps(30 * DAY, POOL_TERMS, position.amount, mintSupply(w.svm, w.mint));
    assert.equal(position.multiplierBps, expected);
    assert.ok(lamports(w.svm, rewardVaultPda(w.mint)) > 0n);
  });

  it("charges the pool creation fee to the treasury", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const before = lamports(ctx.svm, ctx.treasury.publicKey);
    const creator = fundedKeypair(ctx.svm);
    await launchCoin(ctx, creator, WSOL);
    assert.equal(lamports(ctx.svm, ctx.treasury.publicKey) - before, ECONOMICS.poolCreationFeeLamports);
    assert.equal(ECONOMICS.poolCreationFeeLamports, 50_000_000n);
  });

  it("rejects a creator share above the platform cap", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    const { ix, mintKp } = await launchIx(ctx, creator, WSOL, WSOL.globalConfig, 3001);
    assert.match(sendExpectingError(ctx.svm, [ix], [creator, mintKp]), /InvalidParameter/);
  });

  it("refuses a quote mint that taxes transfers", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    const feeMint = createFeeMint(ctx.svm, creator, { configAuthority: null, feeBps: 100 });
    // The check runs before the LaunchLab CPI, so any GlobalConfig will do.
    const { ix, mintKp } = await launchIx(
      ctx,
      creator,
      { mint: feeMint, tokenProgram: TOKEN_2022_PROGRAM_ID },
      WSOL.globalConfig,
    );
    assert.match(sendExpectingError(ctx.svm, [ix], [creator, mintKp]), /QuoteTransferFee/);
  });

  it("refuses a quote mint that could be made to tax transfers", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    // Zero fee today, but an authority that can raise it after the pool opens.
    const feeMint = createFeeMint(ctx.svm, creator, { configAuthority: creator.publicKey, feeBps: 0 });
    const { ix, mintKp } = await launchIx(
      ctx,
      creator,
      { mint: feeMint, tokenProgram: TOKEN_2022_PROGRAM_ID },
      WSOL.globalConfig,
    );
    assert.match(sendExpectingError(ctx.svm, [ix], [creator, mintKp]), /QuoteTransferFee/);
  });

  it("blocks new pools while paused but never existing ones", async () => {
    const w = await openPool();
    const pause = await client.program.methods
      .updateConfig(configArgs(w.treasury.publicKey, { paused: true }) as never)
      .accountsPartial({ admin: w.admin.publicKey, config: configPda() })
      .instruction();
    send(w.svm, [pause], [w.admin]);

    const other = fundedKeypair(w.svm);
    const { ix, mintKp } = await launchIx(w, other, WSOL, WSOL.globalConfig);
    assert.match(sendExpectingError(w.svm, [ix], [other, mintKp]), /Paused/);

    // The live pool keeps working: deposits, and therefore claims, still flow.
    const trader = await deposit(w, WSOL.unit);
    await settleStream(w, trader);
    send(w.svm, await client.claim({ owner: w.creator.publicKey, mint: w.mint, quote: w.quote, index: 0 }), [w.creator]);
  });

  it("refuses a founding lock from anyone but the pool's creator, and a second one", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    const squatter = fundedKeypair(ctx.svm);
    const { mint } = await launchCoin(ctx, creator, WSOL);
    transferCoins(ctx.svm, creator, squatter.publicKey, mint, 10_000n * TOKEN);
    const foundBy = (who: Keypair) =>
      client.found({
        creator: who.publicKey,
        mint,
        quoteMint: WSOL.mint,
        initialLockAmount: 1_000n * TOKEN,
        initialLockDuration: 7 * DAY,
      });
    assert.match(sendExpectingError(ctx.svm, [await foundBy(squatter)], [squatter]), /NotPoolCreator/);

    send(ctx.svm, [await foundBy(creator)], [creator]);
    assert.ok(readPool(ctx.svm, mint).founded);
    // One-shot by construction: the pool's token vault (and the creator's
    // position 0) already exist, so a second `found` cannot initialise them.
    assert.match(sendExpectingError(ctx.svm, [await foundBy(creator)], [creator]), /already in use/);
    assert.equal(readPool(ctx.svm, mint).totalLocked, 1_000n * TOKEN);
  });
});

for (const q of QUOTES) {
  describe(`before founding (${q.symbol})`, () => {
    async function launched() {
      const ctx = setup();
      await initConfig(ctx);
      const creator = fundedKeypair(ctx.svm);
      const { mint } = await launchCoin(ctx, creator, q);
      const w: World = { ...ctx, creator, whale: creator, mint, quote: q };
      return w;
    }

    it("refuses deposits and locks until the pool is founded", async () => {
      const w = await launched();
      const trader = fundedKeypair(w.svm);
      assert.match(sendExpectingError(w.svm, [await depositIx(w, trader, q.unit)], [trader]), /NotFounded/);
      // Before `found` there is no token vault to lock into.
      assert.match(
        sendExpectingError(w.svm, [await lockIx(w, w.creator.publicKey, 1, 1_000n * TOKEN, 30 * DAY)], [w.creator]),
        /token_vault\. Error Code: AccountNotInitialized/,
      );
    });

    it("syncs nothing before founding, then counts earlier arrivals as inflow", async () => {
      const w = await launched();
      const early = 3n * q.unit;
      landUnsynced(w.svm, w.mint, q, early);
      const cranker = fundedKeypair(w.svm);
      send(w.svm, [await client.sync({ mint: w.mint, quote: q })], [cranker]);
      const idle = readPool(w.svm, w.mint);
      assert.equal(idle.founded, false);
      assert.equal(idle.lastVaultBalance, 0n);
      assert.equal(idle.lifetimeInflow, 0n);
      assert.equal(idle.treasuryClaimable, 0n);
      assert.equal(idle.undistributed, 0n);

      send(
        w.svm,
        [
          await client.found({
            creator: w.creator.publicKey,
            mint: w.mint,
            quoteMint: q.mint,
            initialLockAmount: 10_000n * TOKEN,
            initialLockDuration: 30 * DAY,
          }),
        ],
        [w.creator],
      );
      const founded = readPool(w.svm, w.mint);
      assert.equal(rewardBalance(w.svm, w.mint), early);
      const projected = projectSync(founded, rewardBalance(w.svm, w.mint), now(w.svm));
      assert.equal(projected.inflow, early);

      send(w.svm, [await client.sync({ mint: w.mint, quote: q })], [cranker]);
      const after = readPool(w.svm, w.mint);
      const split = splitInflow(early, { treasuryShareBps: ECONOMICS.treasuryShareBps, creatorShareBps: 0 });
      assert.equal(after.lifetimeInflow, early);
      assert.equal(after.lastVaultBalance, early);
      assert.equal(after.treasuryClaimable, projected.treasuryClaimable);
      assert.equal(after.undistributed, projected.undistributed);
      assert.equal(after.treasuryClaimable + after.undistributed, split.toTreasury + split.toLockers);
      assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);
    });
  });
}

for (const q of QUOTES) {
  describe(`rewards (${q.symbol})`, () => {
    it("splits every inflow by the pool's frozen terms", async () => {
      const w = await openPool({ quote: q, creatorShareBps: 1000 });
      const amount = 10n * q.unit;
      const trader = await deposit(w, amount);

      const pool = readPool(w.svm, w.mint);
      const expected = splitInflow(amount, POOL_TERMS);
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
        "every queued unit must reach lockers once the window elapses",
      );
      assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);
    });

    it("projects a sync off-chain exactly as the program performs it", async () => {
      // The API quotes "pending" from this projection between touches. If it
      // drifts from the program by a single base unit, the UI shows a number
      // the claim instruction will not pay.
      const alice = Keypair.generate();
      const w = await openPool({
        quote: q,
        initialLockAmount: 5_000n * TOKEN,
        initialLockDuration: 30 * DAY,
        extraHolders: [{ owner: alice.publicKey, amount: 50_000n * TOKEN }],
      });
      w.svm.airdrop(alice.publicKey, 10n * WSOL.unit);
      send(w.svm, [await lockIx(w, alice.publicKey, 0, 40_000n * TOKEN, 90 * DAY)], [alice]);

      // First inflow starts a stream; a partial release then a second, unsynced
      // inflow exercises every branch: release, fold, restart.
      const trader = await deposit(w, 3n * q.unit);
      warp(w.svm, Math.floor(STREAM_SECS / 3));
      // Land quote without touching the pool, the way a direct transfer to the vault does.
      const untouched = (7n * q.unit) / 10n;
      landUnsynced(w.svm, w.mint, q, untouched);
      warp(w.svm, 17);

      const before = readPool(w.svm, w.mint);
      const projected = projectSync(before, rewardBalance(w.svm, w.mint), now(w.svm));

      send(w.svm, [await client.sync({ mint: w.mint, quote: q })], [trader]);
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
      assert.equal(projected.rewardCapacity, after.rewardCapacity, "reward capacity");
      assert.equal(projected.inflow, untouched, "the unsynced inflow is the direct transfer");

      // And the number a locker sees is the number a claim pays.
      const position = readPosition(w.svm, w.mint, alice.publicKey, 0);
      assert.ok(position, "alice's position exists");
      const quoted = accrued(position.weight, projected.accRewardPerWeight, position.rewardDebt);
      const balanceBefore = held(w, alice.publicKey);
      send(w.svm, await client.claim({ owner: alice.publicKey, mint: w.mint, quote: q, index: 0 }), [alice]);
      const paid = held(w, alice.publicKey) - balanceBefore + feeIn(q);
      assert.equal(paid, quoted, "claim pays exactly what the projection quoted");
    });

    it("pays lockers in proportion to weight, not principal", async () => {
      const alice = Keypair.generate();
      const bob = Keypair.generate();
      const w = await openPool({
        quote: q,
        initialLockAmount: 1_000n * TOKEN,
        initialLockDuration: 7 * DAY,
        extraHolders: [
          { owner: alice.publicKey, amount: 100_000n * TOKEN },
          { owner: bob.publicKey, amount: 100_000n * TOKEN },
        ],
      });
      w.svm.airdrop(alice.publicKey, 10n * WSOL.unit);
      w.svm.airdrop(bob.publicKey, 10n * WSOL.unit);

      // Same principal, very different terms.
      send(w.svm, [await lockIx(w, alice.publicKey, 0, 10_000n * TOKEN, ECONOMICS.minLockSecs)], [alice]);
      send(w.svm, [await lockIx(w, bob.publicKey, 0, 10_000n * TOKEN, 365 * DAY)], [bob]);

      const trader = await deposit(w, 100n * q.unit, FeeKind.Sell);
      await settleStream(w, trader);

      const aliceBefore = held(w, alice.publicKey);
      const bobBefore = held(w, bob.publicKey);
      send(w.svm, await client.claim({ owner: alice.publicKey, mint: w.mint, quote: q, index: 0 }), [alice]);
      send(w.svm, await client.claim({ owner: bob.publicKey, mint: w.mint, quote: q, index: 0 }), [bob]);
      const aliceGain = held(w, alice.publicKey) - aliceBefore + feeIn(q);
      const bobGain = held(w, bob.publicKey) - bobBefore + feeIn(q);

      // Bob committed for a year at 4.0x against Alice's shortest lock at 1.0x.
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
        quote: q,
        extraHolders: [{ owner: latecomer.publicKey, amount: 100_000n * TOKEN }],
      });
      w.svm.airdrop(latecomer.publicKey, 10n * WSOL.unit);

      await deposit(w, 50n * q.unit);
      send(w.svm, [await lockIx(w, latecomer.publicKey, 0, 50_000n * TOKEN, 365 * DAY)], [latecomer]);

      const position = readPosition(w.svm, w.mint, latecomer.publicKey, 0)!;
      const pool = readPool(w.svm, w.mint);
      const claimable = accrued(position.weight, pool.accRewardPerWeight, position.rewardDebt);
      assert.equal(claimable, 0n, "a new lock must start with zero accrued");

      const ixs = await client.claim({ owner: latecomer.publicKey, mint: w.mint, quote: q, index: 0 });
      assert.match(sendExpectingError(w.svm, ixs, [latecomer]), /NothingToClaim/);
    });

    it("pays the treasury, not the next locker, when nobody is locked", async () => {
      // Weight only reaches zero if every position exits, so drive it there.
      const w = await openPool({ quote: q, initialLockAmount: 1_000n * TOKEN, initialLockDuration: 7 * DAY });
      warp(w.svm, 8 * DAY);
      send(
        w.svm,
        await client.unlock({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0, early: false }),
        [w.creator],
      );
      assert.equal(readPool(w.svm, w.mint).totalWeight, 0n);

      const treasuryBefore = readPool(w.svm, w.mint).treasuryClaimable;
      const trader = await deposit(w, q.unit, FeeKind.Donation);
      await settleStream(w, trader);

      const after = readPool(w.svm, w.mint);
      // With nobody locked there is nobody to pay, so the lockers' share must not
      // sit in a pot that the first dust locker could scoop whole.
      assert.equal(after.rewardRemainder, 0n);
      assert.equal(after.undistributed, 0n);
      assert.equal(after.lifetimeRewards, 0n);
      // The creator's cut is still the creator's; only the lockers' share is
      // reassigned, because there are no lockers to receive it.
      const split = splitInflow(q.unit, POOL_TERMS);
      assert.equal(
        after.treasuryClaimable - treasuryBefore,
        split.toTreasury + split.toLockers,
        "the lockers' share must land on the treasury, not in a scoopable pot",
      );
      assert.equal(after.creatorClaimable, split.toCreator);

      // And a locker arriving afterwards starts from zero, with nothing to scoop.
      send(w.svm, [await lockIx(w, w.creator.publicKey, 1, 1_000n * TOKEN, 7 * DAY)], [w.creator]);
      const claimIxs = await client.claim({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 1 });
      assert.match(sendExpectingError(w.svm, claimIxs, [w.creator]), /NothingToClaim/);
      assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 1 }]);
    });
  });
}

describe("positions", () => {
  it("rejects locks that are too small or mistermed", async () => {
    const w = await openPool();
    const tooShort = await lockIx(w, w.creator.publicKey, 5, 1_000n * TOKEN, ECONOMICS.minLockSecs - 1);
    assert.match(sendExpectingError(w.svm, [tooShort], [w.creator]), /InvalidDuration/);

    const tooLong = await lockIx(w, w.creator.publicKey, 6, 1_000n * TOKEN, 400 * DAY);
    assert.match(sendExpectingError(w.svm, [tooLong], [w.creator]), /InvalidDuration/);

    const dust = await lockIx(w, w.creator.publicKey, 7, 999n, 30 * DAY);
    assert.match(sendExpectingError(w.svm, [dust], [w.creator]), /AmountTooSmall/);
  });

  it("will not let one wallet claim another's position", async () => {
    const thief = Keypair.generate();
    const w = await openPool({ extraHolders: [{ owner: thief.publicKey, amount: 10_000n * TOKEN }] });
    w.svm.airdrop(thief.publicKey, 10n * WSOL.unit);
    await deposit(w, 5n * WSOL.unit);

    const ixs = await client.claim({ owner: w.creator.publicKey, mint: w.mint, quote: w.quote, index: 0 });
    const ix = ixs[ixs.length - 1];
    // Swap in the thief as signer while pointing at the creator's position.
    ix.keys[0] = { pubkey: thief.publicKey, isSigner: true, isWritable: true };
    assert.match(sendExpectingError(w.svm, [ix], [thief]), /ConstraintSeeds|ConstraintHasOne|seeds/i);
  });

  it("extends only forward and reprices the multiplier", async () => {
    const w = await openPool({ initialLockDuration: 30 * DAY });
    const before = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    const extend = (durationSecs: number) =>
      client.extend({ owner: w.creator.publicKey, mint: w.mint, quote: w.quote, index: 0, durationSecs });

    assert.match(sendExpectingError(w.svm, await extend(7 * DAY), [w.creator]), /NotAnExtension/);
    send(w.svm, await extend(365 * DAY), [w.creator]);

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
      await client.increase({ owner: w.creator.publicKey, mint: w.mint, quote: w.quote, index: 0, amount: 5_000n * TOKEN }),
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

for (const q of QUOTES) {
  describe(`exits (${q.symbol})`, () => {
    it("returns principal and rewards on a matured unlock", async () => {
      const w = await openPool({ quote: q, initialLockDuration: 7 * DAY });
      await deposit(w, 20n * q.unit);

      const tokensBefore = tokenBalance(w.svm, w.mint, w.creator.publicKey);
      const quoteBefore = held(w, w.creator.publicKey);
      warp(w.svm, 8 * DAY);
      send(
        w.svm,
        await client.unlock({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0, early: false }),
        [w.creator],
      );

      assert.equal(tokenBalance(w.svm, w.mint, w.creator.publicKey) - tokensBefore, 10_000n * TOKEN);
      assert.ok(held(w, w.creator.publicKey) > quoteBefore);
      assert.equal(readPosition(w.svm, w.mint, w.creator.publicKey, 0), null);
      const pool = readPool(w.svm, w.mint);
      assert.equal(pool.totalLocked, 0n);
      assert.equal(pool.totalWeight, 0n);
    });

    it("pays the shortest lock its share of the stream and returns it at maturity", async () => {
      const w = await openPool({ quote: q, initialLockDuration: ECONOMICS.minLockSecs });
      const amount = 20n * q.unit;
      await deposit(w, amount);
      const position = readPosition(w.svm, w.mint, w.creator.publicKey, 0);
      assert.ok(position);
      assert.equal(position.multiplierBps >= 10_000, true);

      const quoteBefore = held(w, w.creator.publicKey);
      warp(w.svm, ECONOMICS.minLockSecs + 1);
      send(
        w.svm,
        await client.unlock({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0, early: false }),
        [w.creator],
      );
      // The only locker, held through the whole release: every unit of the
      // lockers' cut (at least 81% of the deposit after treasury and creator)
      // lands with the principal.
      assert.ok(held(w, w.creator.publicKey) - quoteBefore > (amount * 81n) / 100n - q.unit / 100n);
      assert.equal(readPosition(w.svm, w.mint, w.creator.publicKey, 0), null);
    });

    it("refuses to unlock before term", async () => {
      const w = await openPool({ quote: q, initialLockDuration: 30 * DAY });
      const ixs = await client.unlock({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0, early: false });
      assert.match(sendExpectingError(w.svm, ixs, [w.creator]), /StillLocked/);
    });

    it("burns principal and hands forfeited rewards to the stayers", async () => {
      const quitter = Keypair.generate();
      const stayer = Keypair.generate();
      const w = await openPool({
        quote: q,
        initialLockAmount: 1_000n * TOKEN,
        initialLockDuration: 7 * DAY,
        extraHolders: [
          { owner: quitter.publicKey, amount: 100_000n * TOKEN },
          { owner: stayer.publicKey, amount: 100_000n * TOKEN },
        ],
      });
      w.svm.airdrop(quitter.publicKey, 10n * WSOL.unit);
      w.svm.airdrop(stayer.publicKey, 10n * WSOL.unit);

      for (const who of [quitter, stayer]) {
        send(w.svm, [await lockIx(w, who.publicKey, 0, 50_000n * TOKEN, 100 * DAY)], [who]);
      }
      const trader = await deposit(w, 40n * q.unit);

      const poolBefore = readPool(w.svm, w.mint);
      const stayerPos = readPosition(w.svm, w.mint, stayer.publicKey, 0)!;
      const stayerBefore = accrued(stayerPos.weight, poolBefore.accRewardPerWeight, stayerPos.rewardDebt);
      const supplyBefore = mintSupply(w.svm, w.mint);
      const quitterTokensBefore = tokenBalance(w.svm, w.mint, quitter.publicKey);

      warp(w.svm, 50 * DAY); // half the term served
      send(
        w.svm,
        await client.unlock({ owner: quitter.publicKey, mint: w.mint, quote: q, index: 0, early: true }),
        [quitter],
      );

      // 25% penalty, halved because half the term was served → 12.5% burned.
      const returned = tokenBalance(w.svm, w.mint, quitter.publicKey) - quitterTokensBefore;
      const burned = supplyBefore - mintSupply(w.svm, w.mint);
      assert.equal(returned + burned, 50_000n * TOKEN);
      const burnedPct = Number(burned) / Number(50_000n * TOKEN);
      assert.ok(burnedPct > 0.12 && burnedPct < 0.13, `expected ~12.5% burned, got ${(burnedPct * 100).toFixed(2)}%`);
      assert.equal(readPool(w.svm, w.mint).lifetimeBurned, burned);

      // The quitter's accrued quote is forfeited into the stream, not handed
      // out at once; once the window elapses it has reached the stayer.
      const poolAfter = readPool(w.svm, w.mint);
      assert.ok(poolAfter.undistributed > 0n, "forfeit must join the stream");
      const stayerAtExit = accrued(stayerPos.weight, poolAfter.accRewardPerWeight, stayerPos.rewardDebt);
      assert.ok(stayerAtExit > stayerBefore);
      await settleStream(w, trader);
      const stayerAfter = accrued(stayerPos.weight, readPool(w.svm, w.mint).accRewardPerWeight, stayerPos.rewardDebt);
      assert.ok(stayerAfter > stayerAtExit, `forfeited rewards must reach stayers (${stayerAtExit} -> ${stayerAfter})`);
      assertSolvent(w.svm, w.mint, [
        { owner: w.creator.publicKey, index: 0 },
        { owner: stayer.publicKey, index: 0 },
      ]);
    });

    it("renounce hands a lock's earnings to the others and keeps its tokens locked", async () => {
      const stayer = Keypair.generate();
      const w = await openPool({
        quote: q,
        initialLockAmount: 50_000n * TOKEN,
        initialLockDuration: 100 * DAY,
        extraHolders: [{ owner: stayer.publicKey, amount: 100_000n * TOKEN }],
      });
      w.svm.airdrop(stayer.publicKey, 10n * WSOL.unit);
      send(w.svm, [await lockIx(w, stayer.publicKey, 0, 50_000n * TOKEN, 7 * DAY)], [stayer]);
      const trader = fundedKeypair(w.svm);
      await deposit(w, 10n * q.unit, FeeKind.Buy, trader);
      warp(w.svm, ECONOMICS.rewardStreamSecs / 2);

      const creator = w.creator.publicKey;
      const stayerPos = readPosition(w.svm, w.mint, stayer.publicKey, 0)!;
      const lockedBefore = readPool(w.svm, w.mint).totalLocked;
      send(w.svm, [await client.renounce({ owner: creator, mint: w.mint, quote: q, index: 0 })], [w.creator]);

      const renounced = readPosition(w.svm, w.mint, creator, 0)!;
      assert.equal(renounced.renounced, true);
      assert.equal(renounced.weight, 0n);
      assert.equal(renounced.amount, 50_000n * TOKEN);
      const pool = readPool(w.svm, w.mint);
      assert.equal(pool.totalLocked, lockedBefore, "tokens stay locked");
      assert.equal(pool.totalWeight, stayerPos.weight, "only the stayer earns");
      assert.ok(pool.undistributed > 0n, "what it had accrued rejoins the stream");

      // It earns nothing more, and cannot be made to earn again.
      const creatorQuote = held(w, creator);
      await deposit(w, 10n * q.unit, FeeKind.Buy, trader);
      await settleStream(w, trader);
      assert.match(
        sendExpectingError(w.svm, await client.claim({ owner: creator, mint: w.mint, quote: q, index: 0 }), [w.creator]),
        /NothingToClaim/,
      );
      for (const ixs of [
        [await client.renounce({ owner: creator, mint: w.mint, quote: q, index: 0 })],
        await client.increase({ owner: creator, mint: w.mint, quote: q, index: 0, amount: TOKEN }),
        await client.extend({ owner: creator, mint: w.mint, quote: q, index: 0, durationSecs: 200 * DAY }),
      ]) {
        assert.match(sendExpectingError(w.svm, ixs, [w.creator]), /PositionRenounced/);
      }
      assert.ok(held(w, creator) <= creatorQuote);

      // Everything the lockers were owed — the renounced lock's accrual
      // included — is now the stayer's alone.
      const after = readPool(w.svm, w.mint);
      assert.ok(after.undistributed <= 1n, "stream has run out, bar rounding dust");
      const owedStayer = claimableFor(readPosition(w.svm, w.mint, stayer.publicKey, 0)!, after);
      assert.ok(
        owedStayer + after.rewardRemainder >= after.lifetimeRewards - 1_000n,
        `stayer owed ${owedStayer} of ${after.lifetimeRewards}`,
      );
      assertSolvent(w.svm, w.mint, [
        { owner: creator, index: 0 },
        { owner: stayer.publicKey, index: 0 },
      ]);

      // At term the tokens come back in full.
      const tokensBefore = tokenBalance(w.svm, w.mint, creator);
      warp(w.svm, 101 * DAY);
      send(w.svm, await client.unlock({ owner: creator, mint: w.mint, quote: q, index: 0, early: false }), [w.creator]);
      assert.equal(tokenBalance(w.svm, w.mint, creator) - tokensBefore, 50_000n * TOKEN);
    });

    it("charges no penalty for an early exit at the very end of term", async () => {
      const w = await openPool({ quote: q, initialLockDuration: 7 * DAY });
      const supplyBefore = mintSupply(w.svm, w.mint);
      warp(w.svm, 7 * DAY - 2);
      send(
        w.svm,
        await client.unlock({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0, early: true }),
        [w.creator],
      );
      const burned = supplyBefore - mintSupply(w.svm, w.mint);
      assert.ok(burned < 10_000n, `penalty should round to dust, burned ${burned}`);
    });
  });
}

for (const q of QUOTES) {
  describe(`payouts (${q.symbol})`, () => {
    /** Point `ixs`' last instruction's `from` account at `to`. */
    function redirect(ixs: TransactionInstruction[], from: PublicKey, to: PublicKey) {
      const ix = ixs[ixs.length - 1];
      let hit = false;
      for (const key of ix.keys) {
        if (key.pubkey.equals(from)) {
          key.pubkey = to;
          hit = true;
        }
      }
      assert.ok(hit, "account to redirect not found");
      return [ix];
    }

    it("pays the creator and treasury only what the split allocated", async () => {
      const w = await openPool({ quote: q, creatorShareBps: 2000 });
      await deposit(w, 10n * q.unit);
      const pool = readPool(w.svm, w.mint);
      const creatorDue = pool.creatorClaimable;
      const treasuryDue = pool.treasuryClaimable;

      const treasuryBefore = held(w, w.treasury.publicKey);
      const cranker = fundedKeypair(w.svm);
      send(
        w.svm,
        await client.claimTreasury({ payer: cranker.publicKey, mint: w.mint, quote: q, treasury: w.treasury.publicKey }),
        [cranker],
      );
      assert.equal(held(w, w.treasury.publicKey) - treasuryBefore, treasuryDue);

      const creatorBefore = held(w, w.creator.publicKey);
      send(w.svm, await client.claimCreator({ creator: w.creator.publicKey, mint: w.mint, quote: q }), [w.creator]);
      assert.ok(held(w, w.creator.publicKey) - creatorBefore + feeIn(q) >= creatorDue);

      const after = readPool(w.svm, w.mint);
      assert.equal(after.creatorClaimable, 0n);
      assert.equal(after.treasuryClaimable, 0n);
      assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);
    });

    it("refuses to pay the treasury cut to an attacker's account", async () => {
      const w = await openPool({ quote: q });
      await deposit(w, q.unit);
      const attacker = fundedKeypair(w.svm);
      const ixs = await client.claimTreasury({ payer: attacker.publicKey, mint: w.mint, quote: q, treasury: attacker.publicKey });
      assert.match(sendExpectingError(w.svm, ixs, [attacker]), /TreasuryMismatch|ConstraintAddress/);

      if (q !== WSOL) {
        // The real treasury, but its payout steered into the attacker's ATA.
        fundQuote(w.svm, attacker, attacker.publicKey, q, 0n);
        const honest = await client.claimTreasury({
          payer: attacker.publicKey,
          mint: w.mint,
          quote: q,
          treasury: w.treasury.publicKey,
        });
        const stolen = redirect(honest, quoteAta(w.treasury.publicKey, q), quoteAta(attacker.publicKey, q));
        assert.match(sendExpectingError(w.svm, stolen, [attacker]), /QuoteAccountMismatch/);
        assert.equal(tokenAmount(w.svm, quoteAta(attacker.publicKey, q)), 0n);
      }
    });

    it("refuses to pay the creator cut to anyone else", async () => {
      const w = await openPool({ quote: q });
      await deposit(w, q.unit);
      const attacker = fundedKeypair(w.svm);
      const ixs = await client.claimCreator({ creator: attacker.publicKey, mint: w.mint, quote: q });
      assert.match(sendExpectingError(w.svm, ixs, [attacker]), /NotPoolCreator|ConstraintAddress/);

      if (q !== WSOL) {
        // Signed by the creator, but paid into someone else's ATA.
        fundQuote(w.svm, attacker, attacker.publicKey, q, 0n);
        const honest = await client.claimCreator({ creator: w.creator.publicKey, mint: w.mint, quote: q });
        const stolen = redirect(honest, quoteAta(w.creator.publicKey, q), quoteAta(attacker.publicKey, q));
        assert.match(sendExpectingError(w.svm, stolen, [w.creator]), /QuoteAccountMismatch/);
        assert.equal(tokenAmount(w.svm, quoteAta(attacker.publicKey, q)), 0n);
      }
    });
  });
}

for (const q of QUOTES) {
  describe(`solvency under churn (${q.symbol})`, () => {
    // Twice: with caps far out of reach, and at a price where locks hit them
    // (10,000 coins worth a hundredth of a quote unit).
    for (const [label, quotePer10k] of [
      ["", undefined],
      [" with earnings caps binding", q.unit / 100n],
    ] as const) {
      it(`never owes more than it holds across a long random sequence${label}`, async () => {
        const actors = Array.from({ length: 6 }, () => Keypair.generate());
        const opts = {
          quote: q,
          initialLockAmount: 5_000n * TOKEN,
          initialLockDuration: 30 * DAY,
          extraHolders: actors.map((a) => ({ owner: a.publicKey, amount: 200_000n * TOKEN })),
        };
        const w = quotePer10k === undefined ? await openPool(opts) : await openPricedPool(opts, quotePer10k);
        for (const a of actors) w.svm.airdrop(a.publicKey, 200n * WSOL.unit);
        const trader = fundedKeypair(w.svm, 500);
        if (q !== WSOL) fundQuote(w.svm, trader, trader.publicKey, q, 500n * q.unit);

        const live: Array<{ who: Keypair; index: number }> = [];
        const tracked = [{ owner: w.creator.publicKey, index: 0 }];
        // Deterministic 32-bit LCG so a failure is reproducible. `Math.imul` keeps
        // the multiply exact; plain `*` overflows past 2^53 and degrades to NaN.
        let seed = 42 >>> 0;
        const rand = (n: number) => {
          seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
          // BigInt modulo: Node 24's optimiser has been seen returning NaN for
          // `uint32 % n` here once the loop warms up.
          return Number(BigInt(seed) % BigInt(n));
        };
        const maxDeposit = Number(3n * q.unit);

        for (let step = 0; step < 60; step++) {
          const action = rand(10);
          if (action < 4) {
            const who = actors[rand(actors.length)];
            const index = step + 1;
            const durations = [7, 30, 90, 180, 365];
            try {
              send(
                w.svm,
                [await lockIx(w, who.publicKey, index, BigInt(1 + rand(20_000)) * TOKEN, durations[rand(durations.length)] * DAY)],
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
                  quote: q,
                  amount: BigInt(1 + rand(maxDeposit)),
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
                await client.claim({ owner: pick.who.publicKey, mint: w.mint, quote: q, index: pick.index }),
                [pick.who],
              );
            } catch {
              // Nothing accrued yet; the position stays live either way.
            }
            live.push(pick);
          } else if (live.length > 0) {
            const pick = live.splice(rand(live.length), 1)[0];
            send(
              w.svm,
              await client.unlock({ owner: pick.who.publicKey, mint: w.mint, quote: q, index: pick.index, early: true }),
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
          await client.claimTreasury({ payer: cranker.publicKey, mint: w.mint, quote: q, treasury: w.treasury.publicKey }),
          [cranker],
        );
        send(w.svm, await client.claimCreator({ creator: w.creator.publicKey, mint: w.mint, quote: q }), [w.creator]);
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
            send(w.svm, await client.claim({ owner, mint: w.mint, quote: q, index }), [signer]);
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
          `unexpected residue ${final.held - final.owed} base units`,
        );
        if (quotePer10k !== undefined) {
          const pool = readPool(w.svm, w.mint);
          assert.ok(
            pool.lifetimeTreasury > pool.lifetimeInflow / 10n + q.unit,
            "caps must have bound, sending surplus beyond the 10% cut to the treasury",
          );
        }
      });
    }
  });
}

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
    const ixs = await client.increase({
      owner: w.creator.publicKey,
      mint: w.mint,
      quote: w.quote,
      index: 0,
      amount: 100_000n * TOKEN,
    });
    assert.match(sendExpectingError(w.svm, ixs, [w.creator]), /PositionMatured/);
  });

  it("prices a top-up on the term still to run, not the original one", async () => {
    const w = await openPool({ initialLockDuration: 365 * DAY });
    const before = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    assert.equal(before.multiplierBps, 40_000);

    // Five hours before maturity, only five hours of commitment remain: that
    // is what the top-up should buy, not the year the lock started with.
    warp(w.svm, 365 * DAY - 5 * 3_600);
    send(
      w.svm,
      await client.increase({ owner: w.creator.publicKey, mint: w.mint, quote: w.quote, index: 0, amount: 100_000n * TOKEN }),
      [w.creator],
    );
    const after = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    assert.ok(after.multiplierBps < 11_000, `expected a near-1x multiplier for the hours left, got ${after.multiplierBps}`);
    assert.equal(after.weight, weightOf(after.amount, after.multiplierBps));
  });

  it("gives weight added after a deposit no claim on it", async () => {
    // The flash-lock: watch fees land, lock, sync, claim, leave.
    const sniper = Keypair.generate();
    const w = await openPool({ extraHolders: [{ owner: sniper.publicKey, amount: 400_000n * TOKEN }] });
    w.svm.airdrop(sniper.publicKey, 20n * WSOL.unit);
    await deposit(w, 50n * WSOL.unit);

    // Same slot: a far larger lock than the honest one, then claim immediately.
    send(w.svm, [await lockIx(w, sniper.publicKey, 0, 400_000n * TOKEN, 365 * DAY)], [sniper]);
    const claimIxs = await client.claim({ owner: sniper.publicKey, mint: w.mint, quote: w.quote, index: 0 });
    assert.match(
      sendExpectingError(w.svm, claimIxs, [sniper]),
      /NothingToClaim/,
      "a lock placed after the fees arrived must not capture them",
    );
    assertSolvent(w.svm, w.mint, [
      { owner: w.creator.publicKey, index: 0 },
      { owner: sniper.publicKey, index: 0 },
    ]);
  });

  it("refuses config creation by anyone but the upgrade authority", async () => {
    const ctx = setup();
    const impostor = fundedKeypair(ctx.svm);
    // ProgramData names the real admin; the impostor signs anyway.
    setUpgradeAuthority(ctx.svm, ctx.admin.publicKey);
    const ix = await client.program.methods
      .initializeConfig(configArgs(ctx.treasury.publicKey) as never)
      .accountsPartial({
        admin: impostor.publicKey,
        config: configPda(),
        program: PROGRAM_ID,
        programData: programDataAddress(),
      })
      .instruction();
    assert.match(sendExpectingError(ctx.svm, [ix], [impostor]), /NotUpgradeAuthority/);
  });

  it("lets a keeper close a matured position, paying the owner", async () => {
    const w = await openPool({ initialLockDuration: 7 * DAY });
    const trader = await deposit(w, 10n * WSOL.unit);
    await settleStream(w, trader);
    warp(w.svm, 8 * DAY);

    const keeper = fundedKeypair(w.svm);
    const ownerQuoteBefore = held(w, w.creator.publicKey);
    const ownerTokensBefore = tokenBalance(w.svm, w.mint, w.creator.publicKey);
    const keeperBefore = lamports(w.svm, keeper.publicKey);

    send(
      w.svm,
      await client.unlock({
        owner: w.creator.publicKey,
        mint: w.mint,
        quote: w.quote,
        index: 0,
        early: false,
        payer: keeper.publicKey,
      }),
      [keeper],
    );

    // Everything lands on the owner; the keeper only pays the fee.
    assert.ok(held(w, w.creator.publicKey) > ownerQuoteBefore);
    assert.ok(tokenBalance(w.svm, w.mint, w.creator.publicKey) > ownerTokensBefore);
    assert.ok(lamports(w.svm, keeper.publicKey) < keeperBefore);
    assert.equal(readPosition(w.svm, w.mint, w.creator.publicKey, 0), null);
    assert.equal(readPool(w.svm, w.mint).totalWeight, 0n);
  });

  it("refuses to let a keeper break someone else's live lock", async () => {
    const w = await openPool({ initialLockDuration: 90 * DAY });
    const keeper = fundedKeypair(w.svm);
    const ixs = await client.unlock({
      owner: w.creator.publicKey,
      mint: w.mint,
      quote: w.quote,
      index: 0,
      early: true,
      payer: keeper.publicKey,
    });
    assert.match(sendExpectingError(w.svm, ixs, [keeper]), /NotPositionOwner/);
  });

  it("streams an early exit's forfeit instead of crediting it in one step", async () => {
    // A lump credit paid whoever held weight at that instant, so a sniper could
    // lock in the same bundle as a large early exit, claim, and leave.
    const quitter = Keypair.generate();
    const stayer = Keypair.generate();
    const sniper = Keypair.generate();
    const w = await openPool({
      extraHolders: [
        { owner: quitter.publicKey, amount: 100_000n * TOKEN },
        { owner: stayer.publicKey, amount: 100_000n * TOKEN },
        { owner: sniper.publicKey, amount: 300_000n * TOKEN },
      ],
    });
    for (const who of [quitter, stayer, sniper]) w.svm.airdrop(who.publicKey, 10n * WSOL.unit);
    for (const who of [quitter, stayer]) {
      send(w.svm, [await lockIx(w, who.publicKey, 0, 50_000n * TOKEN, 100 * DAY)], [who]);
    }
    const trader = await deposit(w, 40n * WSOL.unit);
    await settleStream(w, trader);
    send(w.svm, await client.claim({ owner: stayer.publicKey, mint: w.mint, quote: w.quote, index: 0 }), [stayer]);

    const settled = readPool(w.svm, w.mint);
    const quitterPos = readPosition(w.svm, w.mint, quitter.publicKey, 0)!;
    const forfeited = accrued(quitterPos.weight, settled.accRewardPerWeight, quitterPos.rewardDebt);
    assert.ok(forfeited > WSOL.unit, "the quitter must have something to forfeit");

    // Same slot: the sniper locks a large bag, the quitter bails.
    send(w.svm, [await lockIx(w, sniper.publicKey, 0, 300_000n * TOKEN, 365 * DAY)], [sniper]);
    send(
      w.svm,
      await client.unlock({ owner: quitter.publicKey, mint: w.mint, quote: w.quote, index: 0, early: true }),
      [quitter],
    );

    const exited = readPool(w.svm, w.mint);
    assert.equal(exited.undistributed, settled.undistributed + forfeited);
    assert.equal(exited.accRewardPerWeight, settled.accRewardPerWeight);
    assert.equal(exited.streamEnd, now(w.svm) + STREAM_SECS);
    for (const who of [sniper, stayer]) {
      assert.match(
        sendExpectingError(w.svm, await client.claim({ owner: who.publicKey, mint: w.mint, quote: w.quote, index: 0 }), [who]),
        /NothingToClaim/,
        "a forfeit must not be claimable in the slot it happens",
      );
    }

    // It reaches the lockers who hold weight while it streams.
    const stayerPos = readPosition(w.svm, w.mint, stayer.publicKey, 0)!;
    const stayerShare = (forfeited * stayerPos.weight) / exited.totalWeight;
    warp(w.svm, STREAM_SECS / 2);
    send(w.svm, [await client.sync({ mint: w.mint, quote: w.quote })], [trader]);
    const halfway = accrued(stayerPos.weight, readPool(w.svm, w.mint).accRewardPerWeight, stayerPos.rewardDebt);
    assert.ok(
      halfway > (stayerShare * 45n) / 100n && halfway < (stayerShare * 55n) / 100n,
      `expected ~half of ${stayerShare} after half the window, got ${halfway}`,
    );
    await settleStream(w, trader);
    const full = accrued(stayerPos.weight, readPool(w.svm, w.mint).accRewardPerWeight, stayerPos.rewardDebt);
    assert.ok(
      full <= stayerShare + 1n && full + stayerShare / 1_000n >= stayerShare,
      `expected ~${stayerShare} once the window elapsed, got ${full}`,
    );
    assertSolvent(w.svm, w.mint, [
      { owner: w.creator.publicKey, index: 0 },
      { owner: stayer.publicKey, index: 0 },
      { owner: sniper.publicKey, index: 0 },
    ]);
  });

  it("charges a top-up the penalty of a fresh lock over the term left", async () => {
    // Keeping the original lock_start priced the added principal's exit over
    // the old year-long term: ~0.5% to pull a week-old top-up straight back.
    const w = await openPool({ initialLockDuration: 365 * DAY });
    const original = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    warp(w.svm, 358 * DAY);
    const t = now(w.svm);
    const added = 100_000n * TOKEN;
    send(
      w.svm,
      await client.increase({ owner: w.creator.publicKey, mint: w.mint, quote: w.quote, index: 0, amount: added }),
      [w.creator],
    );
    const topped = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    assert.ok(topped.lockStart >= original.lockStart && topped.lockStart <= t);
    assert.equal(topped.lockEnd, original.lockEnd);

    const bps = readPool(w.svm, w.mint).terms.earlyUnlockPenaltyBps;
    const fresh = earlyExitPenalty(added, t, original.lockEnd, t, bps);
    const existing = earlyExitPenalty(original.amount, original.lockStart, original.lockEnd, t, bps);
    const supplyBefore = mintSupply(w.svm, w.mint);
    send(
      w.svm,
      await client.unlock({ owner: w.creator.publicKey, mint: w.mint, quote: w.quote, index: 0, early: true }),
      [w.creator],
    );
    const burned = supplyBefore - mintSupply(w.svm, w.mint);
    assert.ok(burned + 2n >= fresh + existing, `burned ${burned}, a fresh lock of the top-up alone burns ${fresh}`);
    // And no more than rounding above it: the old principal is not repriced.
    assert.ok(burned <= fresh + existing + TOKEN, `burned ${burned}`);
  });

  it("pays a keeper-closed unlock only into the owner's associated account", async () => {
    const w = await openPool({ initialLockDuration: 7 * DAY });
    warp(w.svm, 8 * DAY);
    const keeper = fundedKeypair(w.svm);
    const owner = w.creator.publicKey;
    const ata = coinAta(owner, w.mint);

    // A token account the owner owns but no wallet would ever look in.
    const decoy = Keypair.generate();
    const mintAccount = w.svm.getAccount(w.mint)!;
    const mintInfo = unpackMint(
      w.mint,
      { ...mintAccount, data: Buffer.from(mintAccount.data) },
      TOKEN_2022_PROGRAM_ID,
    );
    const space = getAccountLenForMint(mintInfo);
    send(
      w.svm,
      [
        SystemProgram.createAccount({
          fromPubkey: keeper.publicKey,
          newAccountPubkey: decoy.publicKey,
          space,
          lamports: Number(w.svm.minimumBalanceForRentExemption(BigInt(space))),
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(decoy.publicKey, w.mint, owner, TOKEN_2022_PROGRAM_ID),
      ],
      [keeper, decoy],
    );
    const unlockIxs = () =>
      client.unlock({ owner, mint: w.mint, quote: w.quote, index: 0, early: false, payer: keeper.publicKey });
    const redirected = (await unlockIxs()).at(-1)!;
    for (const key of redirected.keys) {
      if (key.pubkey.equals(ata)) key.pubkey = decoy.publicKey;
    }
    assert.match(sendExpectingError(w.svm, [redirected], [keeper]), /ConstraintAssociated/);

    // The owner has since emptied and closed their ATA; the keeper's
    // idempotent create restores it and the principal lands there.
    const coins = tokenBalance(w.svm, w.mint, owner);
    send(
      w.svm,
      [
        createTransferCheckedInstruction(ata, w.mint, decoy.publicKey, owner, coins, 6, [], TOKEN_2022_PROGRAM_ID),
        createCloseAccountInstruction(ata, owner, owner, [], TOKEN_2022_PROGRAM_ID),
      ],
      [w.creator],
    );
    assert.equal(w.svm.getAccount(ata)?.data.length ?? 0, 0);
    send(w.svm, await unlockIxs(), [keeper]);
    assert.equal(tokenBalance(w.svm, w.mint, owner), 10_000n * TOKEN);
    assert.equal(tokenAmount(w.svm, decoy.publicKey), coins);
    assert.equal(readPosition(w.svm, w.mint, owner, 0), null);
  });
});

describe("token vault accounting", () => {
  it("keeps the vault balance equal to total locked", async () => {
    const other = Keypair.generate();
    const w = await openPool({ extraHolders: [{ owner: other.publicKey, amount: 100_000n * TOKEN }] });
    w.svm.airdrop(other.publicKey, 10n * WSOL.unit);
    send(w.svm, [await lockIx(w, other.publicKey, 0, 25_000n * TOKEN, 90 * DAY)], [other]);
    const pool = readPool(w.svm, w.mint);
    assert.equal(tokenAmount(w.svm, tokenVaultPda(w.mint)), pool.totalLocked);

    const weightCheck = weightOf(
      25_000n * TOKEN,
      multiplierBps(90 * DAY, POOL_TERMS, 25_000n * TOKEN, mintSupply(w.svm, w.mint)),
    );
    const position = readPosition(w.svm, w.mint, other.publicKey, 0)!;
    assert.equal(position.weight, weightCheck);
  });
});

describe("economics", () => {
  it("prices duration on the sqrt curve, front-loaded", async () => {
    const w = await openPool({ initialLockDuration: 30 * DAY });
    const founding = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    // A month is worth ~1.86x on the sqrt curve; a straight line would pay 1.25x.
    assert.ok(founding.multiplierBps >= 18_400 && founding.multiplierBps <= 18_800, `30d priced at ${founding.multiplierBps}`);
    assert.equal(
      founding.multiplierBps,
      multiplierBps(30 * DAY, POOL_TERMS, founding.amount, mintSupply(w.svm, w.mint)),
      "the SDK mirror agrees with the program",
    );
  });

  it("pays a size bonus by share of supply, and re-tiers on increase", async () => {
    const big = Keypair.generate();
    const supply = 1_000_000_000n * TOKEN;
    const w = await openPool({
      initialLockAmount: 1_000n * TOKEN,
      initialLockDuration: 365 * DAY,
      extraHolders: [{ owner: big.publicKey, amount: 20_000_000n * TOKEN }],
    });
    assert.equal(mintSupply(w.svm, w.mint), supply, "a LaunchLab coin's supply is one billion");
    w.svm.airdrop(big.publicKey, 10n * WSOL.unit);

    // 0.5% of supply for a year: the 4.0x ceiling scaled by the +25% tier.
    const half = 5_000_000n * TOKEN;
    send(w.svm, [await lockIx(w, big.publicKey, 0, half, 365 * DAY)], [big]);
    const tiered = readPosition(w.svm, w.mint, big.publicKey, 0)!;
    assert.equal(tiered.multiplierBps, 50_000, "4.0x × 1.25 = 5.0x");
    assert.equal(tiered.multiplierBps, multiplierBps(365 * DAY, POOL_TERMS, half, supply));

    // The founding lock, at 0.0001% of supply, gets no bonus: 4.0x flat.
    const founding = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
    assert.equal(founding.multiplierBps, 40_000);

    // Topping up to 1% crosses into the +50% tier and reprices the position.
    send(w.svm, await client.increase({ owner: big.publicKey, mint: w.mint, quote: w.quote, index: 0, amount: half }), [big]);
    const retiered = readPosition(w.svm, w.mint, big.publicKey, 0)!;
    assert.equal(retiered.amount, 2n * half);
    // Repriced on the term still to run (a few seconds under a year), so just
    // under 6.0x — and never above the 10x global ceiling.
    assert.ok(retiered.multiplierBps > 59_000 && retiered.multiplierBps <= 60_000, `${retiered.multiplierBps}`);
    assert.equal(retiered.weight, weightOf(retiered.amount, retiered.multiplierBps));
    assertSolvent(w.svm, w.mint, [
      { owner: w.creator.publicKey, index: 0 },
      { owner: big.publicKey, index: 0 },
    ]);
  });

  it("ships with 90 / 10 / 0 and refuses a creator cut", async () => {
    // The production config, exactly as init-config writes it.
    const ctx = setup();
    setUpgradeAuthority(ctx.svm, ctx.admin.publicKey);
    send(
      ctx.svm,
      [
        await client.program.methods
          .initializeConfig(ImagineClient.configArgs({ treasury: ctx.treasury.publicKey, launchlabPlatform: IMAGINE_PLATFORM }) as never)
          .accountsPartial({
            admin: ctx.admin.publicKey,
            config: configPda(),
            program: PROGRAM_ID,
            programData: programDataAddress(),
          })
          .instruction(),
      ],
      [ctx.admin],
    );
    const config = decodeConfig(Buffer.from(ctx.svm.getAccount(configPda())!.data));
    assert.equal(config.defaultTreasuryShareBps, 1_000);
    assert.equal(config.maxCreatorShareBps, 0);
    assert.equal(config.defaultDurationCurve, 1);
    assert.deepEqual(config.defaultSizeTierBps, [10, 50, 100]);
    assert.deepEqual(config.defaultSizeBonusBps, [1_000, 2_500, 5_000]);
    assert.equal(config.defaultRewardStreamSecs, 3_600);
    assert.equal(config.defaultMinLockSecs, 4 * 3_600);
    assert.equal(config.defaultMinLockAmount, 1_000_000n);

    const split = splitInflow(10n * WSOL.unit, { treasuryShareBps: config.defaultTreasuryShareBps, creatorShareBps: 0 });
    assert.equal(split.toTreasury, 1n * WSOL.unit);
    assert.equal(split.toCreator, 0n);
    assert.equal(split.toLockers, 9n * WSOL.unit);

    // A launch asking for any creator cut is refused under this config.
    const creator = fundedKeypair(ctx.svm);
    const { ix, mintKp } = await launchIx(ctx, creator, WSOL, WSOL.globalConfig, 1);
    assert.match(sendExpectingError(ctx.svm, [ix], [creator, mintKp]), /InvalidParameter/);
  });
});

/*
 * Earnings limits. A lock may be paid at most its coins' quote value when
 * locked times its multiplier; fees beyond what open locks can still earn go
 * to the treasury as they arrive. Priced off the LaunchLab curve, so these
 * tests set a realistic price: 10,000 coins = one quote unit.
 */
for (const q of QUOTES) {
  describe(`earnings limits (${q.symbol})`, () => {
    const U = q.unit;
    const value = (w: World, amount: bigint) => coinValue(w.svm, w.mint, q, amount);

    it("caps a lock at its quote value times its multiplier and hands the surplus to the treasury at once", async () => {
      const w = await openPricedPool({ quote: q, creatorShareBps: 0, initialLockDuration: 30 * DAY }, U);
      const founding = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
      const worth = value(w, 10_000n * TOKEN);
      assert.ok(worth <= U && worth >= U - 1n, `10,000 coins at this price are worth one ${q.symbol} (${worth})`);
      const cap = rewardCapFor(worth, founding.multiplierBps);
      assert.equal(founding.rewardCap, cap);
      assert.equal(readPool(w.svm, w.mint).rewardCapacity, cap);

      // 50 units of fees against a lock that may earn ~1.86: everything but the
      // cap is the treasury's the moment it lands, not after the lock ends.
      const trader = await deposit(w, 50n * U);
      const pool = readPool(w.svm, w.mint);
      assert.equal(pool.undistributed, cap);
      assert.equal(pool.treasuryClaimable, 50n * U - cap);
      const treasuryBefore = held(w, w.treasury.publicKey);
      send(
        w.svm,
        await client.claimTreasury({ payer: trader.publicKey, mint: w.mint, quote: q, treasury: w.treasury.publicKey }),
        [trader],
      );
      assert.equal(held(w, w.treasury.publicKey) - treasuryBefore, 50n * U - cap);

      await settleStream(w, trader);
      const before = held(w, w.creator.publicKey);
      send(w.svm, await client.claim({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0 }), [w.creator]);
      const paid = held(w, w.creator.publicKey) - before + feeIn(q);
      assert.ok(paid <= cap && cap - paid < 10n, `paid ${paid} against a cap of ${cap}`);

      // Paid out, the lock stops earning: the next fees have nobody to go to.
      const retired = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
      assert.equal(retired.weight, 0n);
      assert.equal(readPool(w.svm, w.mint).totalWeight, 0n);
      await deposit(w, 10n * U);
      assert.equal(readPool(w.svm, w.mint).treasuryClaimable, 10n * U);
      assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);
    });

    it("lets anyone retire a capped lock so the locks still earning split the rest", async () => {
      const alice = Keypair.generate();
      const w = await openPricedPool(
        {
          quote: q,
          creatorShareBps: 0,
          initialLockDuration: 30 * DAY,
          extraHolders: [{ owner: alice.publicKey, amount: 400_000n * TOKEN }],
        },
        U,
      );
      // Alice locks the same bag for the same term after the price rose 100x:
      // same weight, a cap 100x higher.
      setCoinPrice(w.svm, w.mint, q, 100n * U);
      w.svm.airdrop(alice.publicKey, 10n * WSOL.unit);
      send(w.svm, [await lockIx(w, alice.publicKey, 0, 10_000n * TOKEN, 30 * DAY)], [alice]);
      const creatorPos = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
      const alicePos = readPosition(w.svm, w.mint, alice.publicKey, 0)!;
      assert.equal(alicePos.weight, creatorPos.weight, "same bag, same term, same weight");
      assert.equal(alicePos.rewardCap, rewardCapFor(value(w, 10_000n * TOKEN), alicePos.multiplierBps));
      assert.ok(
        alicePos.rewardCap >= creatorPos.rewardCap * 99n && alicePos.rewardCap <= creatorPos.rewardCap * 101n,
        `a cap 100x higher (${alicePos.rewardCap} vs ${creatorPos.rewardCap})`,
      );

      const trader = await deposit(w, 20n * U);
      await settleStream(w, trader);
      // Each has accrued ~9 units; the creator may keep only its cap.
      const keeper = fundedKeypair(w.svm);
      const creatorBefore = held(w, w.creator.publicKey);
      const treasuryBefore = readPool(w.svm, w.mint).treasuryClaimable;
      send(
        w.svm,
        await client.harvest({ payer: keeper.publicKey, owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0 }),
        [keeper],
      );
      assert.equal(held(w, w.creator.publicKey) - creatorBefore, creatorPos.rewardCap);
      const retired = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
      assert.equal(retired.weight, 0n);
      assert.equal(retired.claimed, retired.rewardCap);
      const excess = readPool(w.svm, w.mint).treasuryClaimable - treasuryBefore;
      assert.ok(excess > 6n * U, `the creator's excess (${excess}) goes to the treasury`);

      // From here Alice is the only lock earning.
      await deposit(w, 20n * U);
      await settleStream(w, trader);
      const aliceNow = readPosition(w.svm, w.mint, alice.publicKey, 0)!;
      const due = claimableFor(aliceNow, readPool(w.svm, w.mint));
      assert.ok(due > 26n * U && due <= 27n * U, `alice has earned both her halves (${due})`);
      assertSolvent(w.svm, w.mint, [
        { owner: w.creator.publicKey, index: 0 },
        { owner: alice.publicKey, index: 0 },
      ]);
    });

    it("raises the cap on a top-up and an extension, at the price of the day", async () => {
      const w = await openPricedPool({ quote: q, creatorShareBps: 0, initialLockDuration: 30 * DAY }, U);
      const start = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;

      setCoinPrice(w.svm, w.mint, q, 3n * U);
      send(
        w.svm,
        await client.increase({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0, amount: 10_000n * TOKEN }),
        [w.creator],
      );
      const grown = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
      assert.equal(grown.rewardCap, start.rewardCap + rewardCapFor(value(w, 10_000n * TOKEN), grown.multiplierBps));

      send(
        w.svm,
        await client.extend({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0, durationSecs: 365 * DAY }),
        [w.creator],
      );
      const extended = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
      assert.ok(extended.multiplierBps > grown.multiplierBps);
      assert.equal(
        extended.rewardCap,
        grown.rewardCap + rewardCapFor(value(w, extended.amount), extended.multiplierBps - grown.multiplierBps),
      );
      assert.equal(readPool(w.svm, w.mint).rewardCapacity, extended.rewardCap);
    });

    it("returns an early leaver's unused cap and keeps its forfeit as room", async () => {
      const quitter = Keypair.generate();
      const w = await openPricedPool(
        {
          quote: q,
          creatorShareBps: 0,
          initialLockDuration: 30 * DAY,
          extraHolders: [{ owner: quitter.publicKey, amount: 100_000n * TOKEN }],
        },
        U,
      );
      w.svm.airdrop(quitter.publicKey, 10n * WSOL.unit);
      send(w.svm, [await lockIx(w, quitter.publicKey, 0, 10_000n * TOKEN, 90 * DAY)], [quitter]);
      const trader = await deposit(w, U);
      await settleStream(w, trader);
      const pool = readPool(w.svm, w.mint);
      const qp = readPosition(w.svm, w.mint, quitter.publicKey, 0)!;
      const forfeit = accrued(qp.weight, pool.accRewardPerWeight, qp.rewardDebt);
      assert.ok(forfeit > 0n);

      send(
        w.svm,
        await client.unlock({ owner: quitter.publicKey, mint: w.mint, quote: q, index: 0, early: true }),
        [quitter],
      );
      const after = readPool(w.svm, w.mint);
      assert.equal(after.rewardCapacity, pool.rewardCapacity - (qp.rewardCap - qp.claimed) + forfeit);
      assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);
    });

    it("projects a capped pool's sync exactly as the program performs it", async () => {
      const w = await openPricedPool({ quote: q, creatorShareBps: 0 }, U);
      const trader = await deposit(w, 2n * U);
      warp(w.svm, Math.floor(STREAM_SECS / 2));
      // More than the lock can still earn lands unsynced: the projection must
      // clamp the stream and the release exactly as `sync` does.
      landUnsynced(w.svm, w.mint, q, 9n * U);
      warp(w.svm, 23);

      const before = readPool(w.svm, w.mint);
      const projected = projectSync(before, rewardBalance(w.svm, w.mint), now(w.svm));
      send(w.svm, [await client.sync({ mint: w.mint, quote: q })], [trader]);
      const after = readPool(w.svm, w.mint);
      for (const field of [
        "accRewardPerWeight",
        "rewardRemainder",
        "undistributed",
        "streamRate",
        "treasuryClaimable",
        "lifetimeTreasury",
        "lifetimeRewards",
        "rewardCapacity",
      ] as const) {
        assert.equal(projected[field], after[field], field);
      }
      assert.ok(after.treasuryClaimable > 8n * U, "the surplus went to the treasury");
    });
  });
}

/*
 * An xStock issuer keeps a permanent delegate, freeze and pause powers over
 * the quote. The suite stands in for them by editing the vault's token
 * account directly: the program sees exactly what a delegate transfer or a
 * freeze would leave behind.
 */
describe("quote issuer powers (SPYx)", () => {
  const q = SPYX;
  const vaultOf = (w: World) => rewardTokenAccount(w.mint, q.mint, q.tokenProgram)!;

  it("absorbs quote pulled from the vault: treasury, stream, remainder, then a shortfall repaid first", async () => {
    const w = await openPool({ quote: q, initialLockDuration: 7 * DAY });
    const trader = await deposit(w, 100n * q.unit);
    warp(w.svm, Math.floor(STREAM_SECS / 2));
    send(w.svm, [await client.sync({ mint: w.mint, quote: q })], [trader]);
    const before = readPool(w.svm, w.mint);
    assert.ok(before.treasuryClaimable > 0n && before.undistributed > 0n);

    // More than everything no locker has been credited yet.
    const unassigned = before.treasuryClaimable + before.undistributed + before.rewardRemainder;
    addTokenAmount(w.svm, vaultOf(w), -(unassigned + 1_000n));
    const projected = projectSync(before, rewardBalance(w.svm, w.mint), now(w.svm));
    send(w.svm, [await client.sync({ mint: w.mint, quote: q })], [trader]);
    const after = readPool(w.svm, w.mint);
    assert.equal(after.treasuryClaimable, 0n);
    assert.equal(after.undistributed, 0n);
    assert.equal(after.rewardRemainder, 0n);
    assert.equal(after.shortfall, 1_000n);
    assert.equal(after.lastVaultBalance, rewardBalance(w.svm, w.mint));
    assert.equal(after.accRewardPerWeight, before.accRewardPerWeight, "credited lockers keep their accrual");
    for (const field of ["shortfall", "treasuryClaimable", "undistributed", "rewardRemainder", "lastVaultBalance", "streamRate"] as const) {
      assert.equal(projected[field], after[field], field);
    }

    // New quote makes good the shortfall before it is split.
    await deposit(w, 600n, FeeKind.Buy, trader);
    assert.equal(readPool(w.svm, w.mint).shortfall, 400n);
    assert.equal(readPool(w.svm, w.mint).lifetimeInflow, after.lifetimeInflow, "a repayment is not inflow");
    await deposit(w, 10n * q.unit, FeeKind.Buy, trader);
    const repaid = readPool(w.svm, w.mint);
    assert.equal(repaid.shortfall, 0n);
    assert.equal(repaid.lifetimeInflow, after.lifetimeInflow + 10n * q.unit - 400n);
    assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);

    // Claims and the matured unlock still pay.
    const owed = accrued(readPosition(w.svm, w.mint, w.creator.publicKey, 0)!.weight, repaid.accRewardPerWeight, readPosition(w.svm, w.mint, w.creator.publicKey, 0)!.rewardDebt);
    const heldBefore = held(w, w.creator.publicKey);
    send(w.svm, await client.claim({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0 }), [w.creator]);
    assert.ok(held(w, w.creator.publicKey) - heldBefore >= owed && owed > 0n, "the claim paid what was credited");
    warp(w.svm, 8 * DAY);
    const coins = tokenBalance(w.svm, w.mint, w.creator.publicKey);
    const locked = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!.amount;
    send(w.svm, await client.unlock({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0, early: false }), [w.creator]);
    assert.equal(tokenBalance(w.svm, w.mint, w.creator.publicKey), coins + locked);
  });

  it("a frozen vault blocks quote payouts, never the coins: a matured lock leaves whole through early_unlock", async () => {
    const w = await openPool({ quote: q, initialLockDuration: 7 * DAY });
    await deposit(w, 100n * q.unit);
    warp(w.svm, 8 * DAY);

    // AccountState::Frozen (offset 108 in both token programs).
    const vault = vaultOf(w);
    const acc = w.svm.getAccount(vault)!;
    const data = Buffer.from(acc.data);
    data[108] = 2;
    w.svm.setAccount(vault, { ...acc, data });

    const unlock = (early: boolean) => client.unlock({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0, early });
    assert.match(sendExpectingError(w.svm, await unlock(false), [w.creator]), /frozen|0x11/i);
    assert.match(
      sendExpectingError(w.svm, await client.claim({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0 }), [w.creator]),
      /frozen|0x11/i,
    );

    const coins = tokenBalance(w.svm, w.mint, w.creator.publicKey);
    const supply = mintSupply(w.svm, w.mint);
    const locked = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!.amount;
    send(w.svm, await unlock(true), [w.creator]);
    assert.equal(tokenBalance(w.svm, w.mint, w.creator.publicKey), coins + locked, "every coin back");
    assert.equal(mintSupply(w.svm, w.mint), supply, "nothing burned at maturity");
    assert.equal(readPosition(w.svm, w.mint, w.creator.publicKey, 0), null);
    assert.equal(readPool(w.svm, w.mint).totalLocked, 0n);
  });
});
