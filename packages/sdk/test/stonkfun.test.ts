import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeConfig } from "../src/accounts.ts";
import { valuationAccounts } from "../src/client.ts";
import { FeeKind } from "../src/constants.ts";
import {
  decodeCpmmPool,
  launchLabPoolPda,
  launchLabPoolVaultPda,
  launchLabTradeIx,
  POOL_STATUS,
  STONKFUN_CPMM_CONFIG,
} from "../src/launchlab.ts";
import { multiplierBps, rewardCapFor, splitInflow } from "../src/math.ts";
import { configPda, poolPda, rewardTokenAccount, rewardVaultPda } from "../src/pda.ts";
import {
  client,
  curveBuy,
  DAY,
  fundedKeypair,
  fundQuote,
  launchCoin,
  migrateToCpmm,
  quoteHeld,
  readLaunchLabPool,
  rewardBalance,
  send,
  sendExpectingError,
  sendWithLookupTable,
  setup,
  SPYX,
  STONKFUN_PLATFORM,
  SUPPLY,
  TOKEN,
  tokenAmount,
  tokenBalance,
  warp,
  WSOL,
  type Quote,
} from "./harness.ts";
import { assertSolvent, initConfig, openPool, readPool, readPosition, settleStream, type World } from "./world.ts";

/** Quote value of `amount` coin base units on the live curve, as `price.rs` computes it. */
function curveValue(w: World, amount: bigint): bigint {
  const ll = readLaunchLabPool(w.svm, w.mint, w.quote);
  return (amount * (ll.virtualQuote + ll.realQuote)) / (ll.virtualBase - ll.realBase);
}

/**
 * StonkFun's off-chain creator-share forward: SOL straight onto the reward
 * vault PDA, or quote tokens into the vault PDA's associated token account.
 */
function forwardCreatorShare(w: World, amount: bigint): void {
  const forwarder = fundedKeypair(w.svm);
  if (w.quote === WSOL) {
    send(
      w.svm,
      [SystemProgram.transfer({ fromPubkey: forwarder.publicKey, toPubkey: rewardVaultPda(w.mint), lamports: amount })],
      [forwarder],
    );
    return;
  }
  const source = fundQuote(w.svm, forwarder, forwarder.publicKey, w.quote, amount);
  send(
    w.svm,
    [
      createTransferCheckedInstruction(
        source,
        w.quote.mint,
        rewardTokenAccount(w.mint, w.quote.mint, w.quote.tokenProgram)!,
        forwarder.publicKey,
        amount,
        w.quote.decimals,
        [],
        w.quote.tokenProgram,
      ),
    ],
    [forwarder],
  );
}

for (const q of [WSOL, SPYX] as Quote[]) {
  describe(`StonkFun launch (${q.symbol} quote)`, () => {
    it("launches on LaunchLab with the reward vault as creator, dev-buys, and founds at the curve's price", async () => {
      const w = await openPool({ quote: q, realPrice: true });
      const pool = readPool(w.svm, w.mint);
      assert.ok(pool.founded);
      assert.ok(pool.quoteMint.equals(q.mint));
      assert.ok(pool.quoteTokenProgram.equals(q.tokenProgram));
      assert.ok(pool.launchlabPool.equals(launchLabPoolPda(w.mint, q.mint)));
      assert.ok(pool.tokenProgram.equals(new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")));

      const ll = readLaunchLabPool(w.svm, w.mint, q);
      assert.ok(ll.creator.equals(rewardVaultPda(w.mint)), "the vault PDA is the LaunchLab creator");
      assert.ok(ll.platformConfig.equals(STONKFUN_PLATFORM));
      assert.ok(ll.quoteMint.equals(q.mint));
      assert.equal(ll.status, POOL_STATUS.fund);
      assert.equal(ll.supply, SUPPLY);
      assert.ok(ll.realQuote > 0n, "the dev and whale buys reached the curve");

      const rta = rewardTokenAccount(w.mint, q.mint, q.tokenProgram);
      if (q === WSOL) {
        assert.equal(rta, null);
        assert.ok(pool.rewardTokenAccount.equals(PublicKey.default));
      } else {
        assert.ok(rta && pool.rewardTokenAccount.equals(rta));
        assert.equal(tokenAmount(w.svm, rta), 0n, "the reward ATA exists and starts empty");
      }

      // The founding lock is capped at its value on the curve times its multiplier.
      const position = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
      const amount = 10_000n * TOKEN;
      const mult = multiplierBps(30 * DAY, pool.terms, amount, SUPPLY);
      assert.equal(position.multiplierBps, mult);
      assert.equal(position.rewardCap, rewardCapFor(curveValue(w, amount), mult));
      assert.ok(position.rewardCap > 0n);
      assert.equal(readPool(w.svm, w.mint).rewardCapacity, position.rewardCap);
      assert.equal(decodeConfig(Buffer.from(w.svm.getAccount(configPda())!.data)).poolCount, 1n);
    });

    it("credits StonkFun's forwarded creator share on the next sync", async () => {
      const w = await openPool({ quote: q });
      const share = 3n * q.unit;
      forwardCreatorShare(w, share);
      assert.equal(rewardBalance(w.svm, w.mint), share, "sits unsynced in the vault");

      const cranker = fundedKeypair(w.svm);
      send(w.svm, [await client.sync({ mint: w.mint, quote: q })], [cranker]);
      const pool = readPool(w.svm, w.mint);
      const split = splitInflow(share, pool.terms);
      assert.equal(pool.lifetimeInflow, share);
      assert.equal(pool.lastVaultBalance, share);
      assert.equal(pool.treasuryClaimable, split.toTreasury);
      assert.equal(pool.creatorClaimable, split.toCreator);
      assert.equal(pool.undistributed, split.toLockers);

      // The stream pays the founding lock; everything owed stays covered.
      await settleStream(w, cranker);
      const before = quoteHeld(w.svm, w.creator.publicKey, q);
      send(w.svm, await client.claim({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0 }), [w.creator]);
      const got = quoteHeld(w.svm, w.creator.publicKey, q) - before;
      if (q === WSOL) {
        // The claimer also paid the transaction fee out of the same lamports.
        assert.ok(got > split.toLockers - 10_000n - 20_000n && got <= split.toLockers, `claimed ${got}`);
      } else {
        assert.ok(split.toLockers - got <= 1n, `claimed ${got} of ${split.toLockers}`);
      }
      assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);
    });

    it("takes app fees through deposit_reward and pays every party in the pair asset", async () => {
      const locker = Keypair.generate();
      const w = await openPool({ quote: q, extraHolders: [{ owner: locker.publicKey, amount: 50_000n * TOKEN }] });
      w.svm.airdrop(locker.publicKey, 10_000_000_000n);
      send(
        w.svm,
        [
          await client.lock({
            owner: locker.publicKey,
            mint: w.mint,
            quote: q,
            index: 0,
            amount: 50_000n * TOKEN,
            durationSecs: 7 * DAY,
          }),
        ],
        [locker],
      );

      const trader = fundedKeypair(w.svm);
      if (q !== WSOL) fundQuote(w.svm, trader, trader.publicKey, q, 10n * q.unit);
      const fee = 2n * q.unit;
      send(
        w.svm,
        [await client.depositReward({ payer: trader.publicKey, mint: w.mint, quote: q, amount: fee, kind: FeeKind.Buy })],
        [trader],
      );
      assert.equal(readPool(w.svm, w.mint).lifetimeInflow, fee);
      await settleStream(w, trader);

      const keeper = fundedKeypair(w.svm);
      const lockerBefore = quoteHeld(w.svm, locker.publicKey, q);
      send(
        w.svm,
        await client.harvest({ payer: keeper.publicKey, owner: locker.publicKey, mint: w.mint, quote: q, index: 0 }),
        [keeper],
      );
      assert.ok(quoteHeld(w.svm, locker.publicKey, q) > lockerBefore, "harvest paid the locker");

      const treasuryBefore = quoteHeld(w.svm, w.treasury.publicKey, q);
      const owedTreasury = readPool(w.svm, w.mint).treasuryClaimable;
      send(
        w.svm,
        await client.claimTreasury({ payer: keeper.publicKey, mint: w.mint, quote: q, treasury: w.treasury.publicKey }),
        [keeper],
      );
      assert.equal(quoteHeld(w.svm, w.treasury.publicKey, q) - treasuryBefore, owedTreasury);

      const creatorBefore = quoteHeld(w.svm, w.creator.publicKey, q);
      const owedCreator = readPool(w.svm, w.mint).creatorClaimable;
      assert.ok(owedCreator > 0n);
      send(w.svm, await client.claimCreator({ creator: w.creator.publicKey, mint: w.mint, quote: q }), [w.creator]);
      const creatorGot = quoteHeld(w.svm, w.creator.publicKey, q) - creatorBefore;
      if (q === WSOL) assert.ok(owedCreator - creatorGot <= 30_000n);
      else assert.equal(creatorGot, owedCreator);

      // Matured unlock by a keeper returns principal and pays out the rest.
      warp(w.svm, 7 * DAY);
      forwardCreatorShare(w, q.unit);
      send(w.svm, [await client.sync({ mint: w.mint, quote: q })], [keeper]);
      await settleStream(w, keeper);
      const before = quoteHeld(w.svm, locker.publicKey, q);
      send(
        w.svm,
        await client.unlock({ owner: locker.publicKey, payer: keeper.publicKey, mint: w.mint, quote: q, index: 0, early: false }),
        [keeper],
      );
      assert.equal(tokenBalance(w.svm, w.mint, locker.publicKey), 50_000n * TOKEN);
      assert.ok(quoteHeld(w.svm, locker.publicKey, q) > before);
      assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);
    });

    it("burns an early exit's penalty and streams its forfeit to the stayers", async () => {
      const quitter = Keypair.generate();
      const w = await openPool({ quote: q, extraHolders: [{ owner: quitter.publicKey, amount: 20_000n * TOKEN }] });
      w.svm.airdrop(quitter.publicKey, 10_000_000_000n);
      send(
        w.svm,
        [await client.lock({ owner: quitter.publicKey, mint: w.mint, quote: q, index: 0, amount: 20_000n * TOKEN, durationSecs: 30 * DAY })],
        [quitter],
      );
      forwardCreatorShare(w, 4n * q.unit);
      send(w.svm, [await client.sync({ mint: w.mint, quote: q })], [quitter]);
      await settleStream(w, quitter);
      const forfeitable = readPosition(w.svm, w.mint, quitter.publicKey, 0)!;
      assert.ok(forfeitable.weight > 0n);

      const supplyBefore = readLaunchLabPool(w.svm, w.mint, q).supply;
      const quoteBefore = quoteHeld(w.svm, quitter.publicKey, q);
      send(
        w.svm,
        await client.unlock({ owner: quitter.publicKey, mint: w.mint, quote: q, index: 0, early: true }),
        [quitter],
      );
      const returned = tokenBalance(w.svm, w.mint, quitter.publicKey);
      assert.ok(returned < 20_000n * TOKEN && returned > 0n, "a slice of principal burned");
      assert.equal(readPool(w.svm, w.mint).lifetimeBurned, 20_000n * TOKEN - returned);
      assert.equal(supplyBefore, SUPPLY);
      if (q !== WSOL) assert.equal(quoteHeld(w.svm, quitter.publicKey, q), quoteBefore, "an early exit pays no rewards");
      const pool = readPool(w.svm, w.mint);
      assert.ok(pool.undistributed > 0n, "the forfeit streams back out");
      await settleStream(w, w.creator);
      assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);
    });
  });
}

describe("one-transaction launch", () => {
  for (const q of [WSOL, SPYX] as Quote[]) {
    it(`launches, dev-buys and founds in a single transaction (${q.symbol})`, async () => {
      const ctx = setup();
      await initConfig(ctx);
      const creator = fundedKeypair(ctx.svm);
      const mint = Keypair.generate();
      fundQuote(ctx.svm, creator, creator.publicKey, q, q.unit);
      const launch = await client.launch({
        creator: creator.publicKey,
        mint: mint.publicKey,
        quote: q,
        treasury: ctx.treasury.publicKey,
        name: "Imagine One",
        symbol: "ONE",
        uri: "https://imagine.fun/one.json",
        supply: SUPPLY,
        totalSell: 793_100_000_000_000n,
        fundRaising: 85n * q.unit,
        globalConfig: q.globalConfig,
      });
      const llPool = launchLabPoolPda(mint.publicKey, q.mint);
      const buy = launchLabTradeIx({
        kind: "buyExactIn",
        pool: {
          address: llPool,
          globalConfig: q.globalConfig,
          platformConfig: STONKFUN_PLATFORM,
          baseMint: mint.publicKey,
          quoteMint: q.mint,
          baseVault: launchLabPoolVaultPda(llPool, mint.publicKey),
          quoteVault: launchLabPoolVaultPda(llPool, q.mint),
          creator: rewardVaultPda(mint.publicKey),
          baseTokenProgram: TOKEN_2022_PROGRAM_ID,
          quoteTokenProgram: q.tokenProgram,
        },
        payer: creator.publicKey,
        amount: q.unit,
        limit: 1n,
      });
      const found = await client.found({
        creator: creator.publicKey,
        mint: mint.publicKey,
        quoteMint: q.mint,
        initialLockAmount: 1_000_000n * TOKEN,
        initialLockDuration: 30 * DAY,
      });
      sendWithLookupTable(
        ctx.svm,
        [
          launch,
          createAssociatedTokenAccountIdempotentInstruction(
            creator.publicKey,
            getAssociatedTokenAddressSync(mint.publicKey, creator.publicKey, true, TOKEN_2022_PROGRAM_ID),
            creator.publicKey,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID,
          ),
          buy,
          found,
        ],
        [creator, mint],
      );
      const pool = readPool(ctx.svm, mint.publicKey);
      assert.ok(pool.founded);
      assert.equal(pool.totalLocked, 1_000_000n * TOKEN);
      assert.ok(tokenBalance(ctx.svm, mint.publicKey, creator.publicKey) > 0n, "the dev bag beyond the lock stays with the creator");
    });
  }
});

describe("StonkFun launch guards", () => {
  it("refuses a LaunchLab platform other than the configured one", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    const mint = Keypair.generate();
    const ix = await client.launch({
      creator: creator.publicKey,
      mint: mint.publicKey,
      quote: WSOL,
      treasury: ctx.treasury.publicKey,
      name: "x",
      symbol: "X",
      uri: "https://imagine.fun/x.json",
      supply: SUPPLY,
      totalSell: 793_100_000_000_000n,
      fundRaising: 85n * WSOL.unit,
      globalConfig: WSOL.globalConfig,
      platform: Keypair.generate().publicKey,
    });
    assert.match(sendExpectingError(ctx.svm, [ix], [creator, mint]), /PlatformMismatch/);
  });

  it("refuses misplaced allow-config / curve-rule accounts", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    const mint = Keypair.generate();
    const ix = await client.launch({
      creator: creator.publicKey,
      mint: mint.publicKey,
      quote: WSOL,
      treasury: ctx.treasury.publicKey,
      name: "x",
      symbol: "X",
      uri: "https://imagine.fun/x.json",
      supply: SUPPLY,
      totalSell: 793_100_000_000_000n,
      fundRaising: 85n * WSOL.unit,
      globalConfig: WSOL.globalConfig,
    });
    // Swap the two trailing accounts.
    const n = ix.keys.length;
    [ix.keys[n - 1], ix.keys[n - 2]] = [ix.keys[n - 2], ix.keys[n - 1]];
    assert.match(sendExpectingError(ctx.svm, [ix], [creator, mint]), /InvalidLaunchLabAccount/);
  });

  it("refuses a curve StonkFun's rule does not allow", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    const mint = Keypair.generate();
    const ix = await client.launch({
      creator: creator.publicKey,
      mint: mint.publicKey,
      quote: WSOL,
      treasury: ctx.treasury.publicKey,
      name: "x",
      symbol: "X",
      uri: "https://imagine.fun/x.json",
      supply: SUPPLY,
      totalSell: 700_000_000_000_000n,
      fundRaising: 85n * WSOL.unit,
      globalConfig: WSOL.globalConfig,
    });
    const logs = sendExpectingError(ctx.svm, [ix], [creator, mint]);
    assert.match(logs, /LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj failed|custom program error/);
    assert.equal(ctx.svm.getAccount(poolPda(mint.publicKey)), null, "nothing was created");
  });

  it("refuses to open a token-quoted pool without its reward token account", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    const { mint } = await launchCoin(ctx, creator, SPYX);
    const ix = await client.found({
      creator: creator.publicKey,
      mint,
      quoteMint: SPYX.mint,
      initialLockAmount: 10_000n * TOKEN,
      initialLockDuration: 30 * DAY,
    });
    send(ctx.svm, [ix], [creator]);
    const sync = await client.sync({ mint, quote: SPYX });
    // Drop the reward token account: Anchor's optional-account placeholder is the program id.
    const stripped = sync.keys.map((k) =>
      k.pubkey.equals(rewardTokenAccount(mint, SPYX.mint, SPYX.tokenProgram)!)
        ? { ...k, pubkey: client.programId, isWritable: false }
        : k,
    );
    const logs = sendExpectingError(ctx.svm, [{ ...sync, keys: stripped }], [creator]);
    assert.match(logs, /QuoteAccountMismatch/);
  });
});

describe("migrated coins", () => {
  for (const q of [WSOL, SPYX] as Quote[]) {
    it(`prices locks from the CPMM pool once the curve migrates (${q.symbol})`, async () => {
      const locker = Keypair.generate();
      const w = await openPool({ quote: q, realPrice: true, extraHolders: [{ owner: locker.publicKey, amount: 100_000n * TOKEN }] });
      w.svm.airdrop(locker.publicKey, 10_000_000_000n);

      // Buy out the curve: LaunchLab caps the fill at what is left and moves to status 1.
      const buyer = fundedKeypair(w.svm);
      curveBuy(w.svm, buyer, w.mint, q, 200n * q.unit);
      assert.equal(readLaunchLabPool(w.svm, w.mint, q).status, POOL_STATUS.migrate);
      const cpPool = migrateToCpmm(w, w.mint, q);
      assert.equal(readLaunchLabPool(w.svm, w.mint, q).status, POOL_STATUS.trade);

      const valuation = valuationAccounts(w.mint, q.mint, STONKFUN_CPMM_CONFIG);
      assert.ok(valuation[0].equals(cpPool));

      // Without the CPMM accounts the price is unavailable.
      const bare = await client.lock({ owner: locker.publicKey, mint: w.mint, quote: q, index: 0, amount: 100_000n * TOKEN, durationSecs: 7 * DAY });
      assert.match(sendExpectingError(w.svm, [bare], [locker]), /PriceUnavailable/);
      // Vaults in the wrong order are refused too.
      const swapped = await client.lock({
        owner: locker.publicKey,
        mint: w.mint,
        quote: q,
        index: 0,
        amount: 100_000n * TOKEN,
        durationSecs: 7 * DAY,
        valuation: [valuation[0], valuation[2], valuation[1]],
      });
      assert.match(sendExpectingError(w.svm, [swapped], [locker]), /PriceUnavailable/);

      send(
        w.svm,
        [await client.lock({ owner: locker.publicKey, mint: w.mint, quote: q, index: 0, amount: 100_000n * TOKEN, durationSecs: 7 * DAY, valuation })],
        [locker],
      );
      const cp = decodeCpmmPool(Buffer.from(w.svm.getAccount(cpPool)!.data));
      const baseIs0 = cp.token0Mint.equals(w.mint);
      const fees0 = cp.protocolFeesToken0 + cp.fundFeesToken0 + cp.creatorFeesToken0;
      const fees1 = cp.protocolFeesToken1 + cp.fundFeesToken1 + cp.creatorFeesToken1;
      const baseVault = tokenAmount(w.svm, valuation[1]) - (baseIs0 ? fees0 : fees1);
      const quoteVault = tokenAmount(w.svm, valuation[2]) - (baseIs0 ? fees1 : fees0);
      const value = (100_000n * TOKEN * quoteVault) / baseVault;
      const p = readPosition(w.svm, w.mint, locker.publicKey, 0)!;
      assert.equal(p.rewardCap, rewardCapFor(value, p.multiplierBps));
    });
  }
});
