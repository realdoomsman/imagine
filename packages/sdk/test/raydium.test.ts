import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeConfig } from "../src/accounts.ts";
import { valuationAccounts } from "../src/client.ts";
import { ECONOMICS, FeeKind, metadataUri } from "../src/constants.ts";
import {
  buyExactIn,
  cpmmPoolPda,
  cpmmSwapIx,
  createPlatformConfigIx,
  creatorFeeVaultPda,
  curveFeeRates,
  decodeCpmmPool,
  decodeGlobalConfig,
  decodePlatformConfig,
  IMAGINE_PLATFORM_PARAMS,
  imaginePlatformConfigIx,
  LAUNCHLAB_MAX_CREATOR_FEE_RATE,
  launchLabPoolPda,
  launchLabPoolVaultPda,
  launchLabTradeIx,
  platformConfigPda,
  POOL_STATUS,
  raydiumTokenUrl,
  sellExactIn,
  updatePlatformConfigIx,
} from "../src/launchlab.ts";
import { multiplierBps, rewardCapFor, splitInflow } from "../src/math.ts";
import { configPda, poolPda, rewardTokenAccount, rewardVaultPda } from "../src/pda.ts";
import {
  client,
  coinAta,
  CPMM_AMM_CONFIG,
  curveBuy,
  curveSell,
  DAY,
  fundedKeypair,
  fundQuote,
  IMAGINE_PLATFORM,
  lamports,
  launchCoin,
  migrateToCpmm,
  now,
  quoteAta,
  quoteHeld,
  readLaunchLabPool,
  rewardBalance,
  send,
  sendExpectingError,
  sendWithLookupTable,
  setup,
  SPYX,
  SUPPLY,
  TOKEN,
  tokenAmount,
  tokenBalance,
  warp,
  WSOL,
  type Ctx,
  type LiteSVM,
  type Quote,
} from "./harness.ts";
import { assertSolvent, initConfig, openPool, readPool, readPosition, settleStream, type World } from "./world.ts";

/** Quote value of `amount` coin base units on the live curve, as `price.rs` computes it. */
function curveValue(w: World, amount: bigint): bigint {
  const ll = readLaunchLabPool(w.svm, w.mint, w.quote);
  return (amount * (ll.virtualQuote + ll.realQuote)) / (ll.virtualBase - ll.realBase);
}

/** The coin's LaunchLab creator-fee vault: the pool's reward vault is its creator. */
function creatorFeeVault(w: World): PublicKey {
  return creatorFeeVaultPda(rewardVaultPda(w.mint), w.quote.mint);
}

/** The fee split LaunchLab charges on this coin's curve trades. */
function feeRates(svm: LiteSVM, q: Quote) {
  const global = decodeGlobalConfig(Buffer.from(svm.getAccount(q.globalConfig)!.data));
  const platform = decodePlatformConfig(Buffer.from(svm.getAccount(IMAGINE_PLATFORM)!.data));
  return curveFeeRates(global, platform);
}

async function collect(w: World, payer: Keypair, graduated = false) {
  send(
    w.svm,
    await client.collectCreatorFee({
      payer: payer.publicKey,
      mint: w.mint,
      quote: w.quote,
      graduated: graduated ? { ammConfig: CPMM_AMM_CONFIG } : undefined,
    }),
    [payer],
  );
}

describe("IMAGINE platform on Raydium LaunchLab", () => {
  it("LaunchLab caps a platform's creator fee at 0.5% and its platform fee at 5%", () => {
    const create = (admin: Keypair, creatorFeeRate: bigint, feeRate = 0n) =>
      createPlatformConfigIx({
        platformAdmin: admin.publicKey,
        platformFeeWallet: admin.publicKey,
        platformNftWallet: admin.publicKey,
        cpswapConfig: CPMM_AMM_CONFIG,
        transferFeeExtensionAuthority: admin.publicKey,
        platformVestingWallet: admin.publicKey,
        params: { ...IMAGINE_PLATFORM_PARAMS, creatorFeeRate, feeRate },
      });
    const ctx = setup();
    for (const rate of [LAUNCHLAB_MAX_CREATOR_FEE_RATE + 1n, 20_000n]) {
      const admin = fundedKeypair(ctx.svm);
      assert.match(sendExpectingError(ctx.svm, [create(admin, rate)], [admin]), /InvalidPlatformInfo/);
    }
    const tooRich = fundedKeypair(ctx.svm);
    assert.match(sendExpectingError(ctx.svm, [create(tooRich, 0n, 50_001n)], [tooRich]), /InvalidInput/);
    const admin = fundedKeypair(ctx.svm);
    send(ctx.svm, [create(admin, LAUNCHLAB_MAX_CREATOR_FEE_RATE, 50_000n)], [admin]);

    // The platform every test launches under.
    const p = decodePlatformConfig(Buffer.from(ctx.svm.getAccount(IMAGINE_PLATFORM)!.data));
    assert.equal(p.creatorFeeRate, 5_000n);
    assert.equal(p.feeRate, 0n);
    assert.ok(p.cpswapConfig.equals(CPMM_AMM_CONFIG));
    assert.ok(p.platformCpCreator.equals(PublicKey.default), "graduated pools keep the LaunchLab creator");
    assert.equal(p.platformScale, 1_000_000n);
    assert.equal(p.restrictGlobalConfig + p.restrictCurveParam, 0);
    assert.equal(ECONOMICS.poolFeeBps, Number(p.creatorFeeRate / 100n));
    assert.equal(ECONOMICS.tradeFeeBps + ECONOMICS.poolFeeBps, 200, "2% into the pool on imagine.fun trades");
  });

  it("moves a platform's fee and NFT wallets with update_platform_config, changing nothing else", () => {
    const ctx = setup();
    const admin = fundedKeypair(ctx.svm);
    const [oldWallet, newWallet] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
    send(ctx.svm, [imaginePlatformConfigIx({ admin: admin.publicKey, nftWallet: oldWallet, feeWallet: oldWallet, cpswapConfig: CPMM_AMM_CONFIG })], [admin]);
    const platformConfig = platformConfigPda(admin.publicKey);
    const before = ctx.svm.getAccount(platformConfig)!;
    const updates = [
      updatePlatformConfigIx({ admin: admin.publicKey, platformConfig, param: { kind: "feeWallet", value: newWallet } }),
      updatePlatformConfigIx({ admin: admin.publicKey, platformConfig, param: { kind: "nftWallet", value: newWallet } }),
    ];

    // Only the platform's own admin can update it.
    const intruder = fundedKeypair(ctx.svm);
    const forged = updatePlatformConfigIx({ admin: intruder.publicKey, platformConfig, param: { kind: "feeWallet", value: intruder.publicKey } });
    assert.match(sendExpectingError(ctx.svm, [forged], [intruder]), /ConstraintSeeds/);

    send(ctx.svm, updates, [admin]);
    const after = ctx.svm.getAccount(platformConfig)!;
    const p0 = decodePlatformConfig(Buffer.from(before.data));
    const p1 = decodePlatformConfig(Buffer.from(after.data));
    assert.ok(p0.platformFeeWallet.equals(oldWallet) && p0.platformNftWallet.equals(oldWallet));
    assert.ok(p1.platformFeeWallet.equals(newWallet) && p1.platformNftWallet.equals(newWallet));
    assert.deepEqual(
      { ...p1, platformFeeWallet: null, platformNftWallet: null },
      { ...p0, platformFeeWallet: null, platformNftWallet: null },
    );
    // Byte for byte: only the two wallets (offsets 16..80) moved.
    const [b0, b1] = [Buffer.from(before.data), Buffer.from(after.data)];
    assert.equal(b1.length, b0.length);
    assert.deepEqual(b1.subarray(0, 16), b0.subarray(0, 16));
    assert.deepEqual(b1.subarray(80), b0.subarray(80));
    assert.equal(after.lamports, before.lamports);
  });

  it("links a coin to its Raydium launchpad page", () => {
    const mint = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
    assert.equal(raydiumTokenUrl(mint), `https://raydium.io/launchpad/token/?mint=${mint.toBase58()}`);
  });
});

for (const q of [WSOL, SPYX] as Quote[]) {
  describe(`launch (${q.symbol} quote)`, () => {
    it("launches on LaunchLab with the reward vault as creator, dev-buys, and founds at the curve's price", async () => {
      const w = await openPool({ quote: q, realPrice: true });
      const pool = readPool(w.svm, w.mint);
      assert.ok(pool.founded);
      assert.ok(pool.quoteMint.equals(q.mint));
      assert.ok(pool.quoteTokenProgram.equals(q.tokenProgram));
      assert.ok(pool.launchlabPool.equals(launchLabPoolPda(w.mint, q.mint)));
      assert.ok(pool.tokenProgram.equals(TOKEN_2022_PROGRAM_ID));

      const ll = readLaunchLabPool(w.svm, w.mint, q);
      assert.ok(ll.creator.equals(rewardVaultPda(w.mint)), "the vault PDA is the LaunchLab creator");
      assert.ok(ll.platformConfig.equals(IMAGINE_PLATFORM));
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
      }

      // The founding lock is capped at its value on the curve times its multiplier.
      const position = readPosition(w.svm, w.mint, w.creator.publicKey, 0)!;
      const amount = 10_000n * TOKEN;
      const mult = multiplierBps(30 * DAY, pool.terms, amount, SUPPLY);
      assert.equal(position.multiplierBps, mult);
      assert.equal(position.rewardCap, rewardCapFor(curveValue(w, amount), mult));
      assert.ok(position.rewardCap > 0n);
      assert.equal(decodeConfig(Buffer.from(w.svm.getAccount(configPda())!.data)).poolCount, 1n);
    });

    it("accrues the 0.5% creator fee on every curve trade, collects it into the pool and pays lockers", async () => {
      const w = await openPool({ quote: q });
      const rates = feeRates(w.svm, q);
      assert.equal(rates.creator, 5_000n);

      // Trades straight on LaunchLab, as Raydium's UI or a bot would send them.
      const trader = fundedKeypair(w.svm);
      const before = tokenAmount(w.svm, creatorFeeVault(w));
      const ll0 = readLaunchLabPool(w.svm, w.mint, q);
      const buy = buyExactIn(ll0, 5n * q.unit, rates);
      const bought = curveBuy(w.svm, trader, w.mint, q, 5n * q.unit);
      assert.equal(bought, buy.base);
      const ll1 = readLaunchLabPool(w.svm, w.mint, q);
      const sell = sellExactIn(ll1, bought / 2n, rates);
      curveSell(w.svm, trader, w.mint, q, bought / 2n);
      const accrued = tokenAmount(w.svm, creatorFeeVault(w)) - before;
      assert.ok(accrued > 0n);
      assert.ok(
        accrued - buy.split.creator - sell.split.creator <= 2n && buy.split.creator + sell.split.creator - accrued <= 2n,
        `accrued ${accrued}, modelled ${buy.split.creator + sell.split.creator}`,
      );
      // About 0.5% of the quote volume.
      const volume = buy.quote + sell.curveQuote;
      assert.ok(accrued * 200n >= volume - 400n && accrued * 200n <= volume + 400n, `${accrued} of ${volume}`);

      // The whole vault — dev buy and whale buy included — goes to the pool.
      const due = tokenAmount(w.svm, creatorFeeVault(w));
      const cranker = fundedKeypair(w.svm);
      const crankerBefore = lamports(w.svm, cranker.publicKey);
      const inflowBefore = readPool(w.svm, w.mint).lifetimeInflow;
      await collect(w, cranker);
      assert.equal(tokenAmount(w.svm, creatorFeeVault(w)), 0n, "the creator-fee vault is emptied");
      const pool = readPool(w.svm, w.mint);
      assert.equal(pool.lifetimeInflow - inflowBefore, due, "synced inline");
      const split = splitInflow(due, pool.terms);
      assert.equal(pool.treasuryClaimable, split.toTreasury);
      if (q === WSOL) {
        assert.equal(w.svm.getAccount(quoteAta(rewardVaultPda(w.mint), q))?.lamports ?? 0, 0, "WSOL unwrapped and closed");
        assert.ok(crankerBefore - lamports(w.svm, cranker.publicKey) <= 10_000n, "the cranker gets the account rent back");
      } else {
        assert.equal(rewardBalance(w.svm, w.mint), due);
      }

      // LaunchLab reads the rate from the PlatformConfig at each trade: a
      // platform-side change (here written straight to `creator_fee_rate`,
      // offset 720) applies to live coins.
      const acc = w.svm.getAccount(IMAGINE_PLATFORM)!;
      const data = Buffer.from(acc.data);
      data.writeBigUInt64LE(1_000n, 720);
      w.svm.setAccount(IMAGINE_PLATFORM, { ...acc, data });
      const lowRates = feeRates(w.svm, q);
      const ll2 = readLaunchLabPool(w.svm, w.mint, q);
      const lowBuy = buyExactIn(ll2, 5n * q.unit, lowRates);
      curveBuy(w.svm, trader, w.mint, q, 5n * q.unit);
      const lowAccrued = tokenAmount(w.svm, creatorFeeVault(w));
      assert.ok(lowAccrued - lowBuy.split.creator <= 2n && lowBuy.split.creator - lowAccrued <= 2n, `${lowAccrued} vs ${lowBuy.split.creator}`);
      data.writeBigUInt64LE(5_000n, 720);
      w.svm.setAccount(IMAGINE_PLATFORM, { ...acc, data });
      await collect(w, cranker);
      const collectedTotal = due + lowAccrued;

      // Collecting again with nothing due is a harmless no-op.
      await collect(w, cranker);
      assert.equal(readPool(w.svm, w.mint).lifetimeInflow - inflowBefore, collectedTotal);
      const lockersShare = split.toLockers + splitInflow(lowAccrued, pool.terms).toLockers;

      await settleStream(w, cranker);
      const held = quoteHeld(w.svm, w.creator.publicKey, q);
      send(w.svm, await client.claim({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0 }), [w.creator]);
      const got = quoteHeld(w.svm, w.creator.publicKey, q) - held;
      if (q === WSOL) {
        assert.ok(got > lockersShare - 30_000n && got <= lockersShare, `claimed ${got} of ${lockersShare}`);
      } else {
        assert.ok(lockersShare - got <= 2n, `claimed ${got} of ${lockersShare}`);
      }
      assertSolvent(w.svm, w.mint, [{ owner: w.creator.publicKey, index: 0 }]);
    });

    it("takes app fees through deposit_reward and pays every party in the pair asset", async () => {
      const locker = Keypair.generate();
      const w = await openPool({ quote: q, extraHolders: [{ owner: locker.publicKey, amount: 50_000n * TOKEN }] });
      w.svm.airdrop(locker.publicKey, 10_000_000_000n);
      send(
        w.svm,
        [await client.lock({ owner: locker.publicKey, mint: w.mint, quote: q, index: 0, amount: 50_000n * TOKEN, durationSecs: 7 * DAY })],
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
      send(w.svm, await client.harvest({ payer: keeper.publicKey, owner: locker.publicKey, mint: w.mint, quote: q, index: 0 }), [keeper]);
      assert.ok(quoteHeld(w.svm, locker.publicKey, q) > lockerBefore, "harvest paid the locker");

      const treasuryBefore = quoteHeld(w.svm, w.treasury.publicKey, q);
      const owedTreasury = readPool(w.svm, w.mint).treasuryClaimable;
      send(w.svm, await client.claimTreasury({ payer: keeper.publicKey, mint: w.mint, quote: q, treasury: w.treasury.publicKey }), [keeper]);
      assert.equal(quoteHeld(w.svm, w.treasury.publicKey, q) - treasuryBefore, owedTreasury);

      const creatorBefore = quoteHeld(w.svm, w.creator.publicKey, q);
      const owedCreator = readPool(w.svm, w.mint).creatorClaimable;
      assert.ok(owedCreator > 0n);
      send(w.svm, await client.claimCreator({ creator: w.creator.publicKey, mint: w.mint, quote: q }), [w.creator]);
      const creatorGot = quoteHeld(w.svm, w.creator.publicKey, q) - creatorBefore;
      if (q === WSOL) assert.ok(owedCreator - creatorGot <= 30_000n);
      else assert.equal(creatorGot, owedCreator);

      // Matured unlock by a keeper returns principal and pays out the rest,
      // creator fees from later trades included.
      warp(w.svm, 7 * DAY);
      curveBuy(w.svm, fundedKeypair(w.svm), w.mint, q, q.unit);
      await collect(w, keeper);
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
      curveBuy(w.svm, fundedKeypair(w.svm), w.mint, q, 30n * q.unit);
      await collect(w, quitter);
      await settleStream(w, quitter);
      assert.ok(readPosition(w.svm, w.mint, quitter.publicKey, 0)!.weight > 0n);

      const quoteBefore = quoteHeld(w.svm, quitter.publicKey, q);
      send(w.svm, await client.unlock({ owner: quitter.publicKey, mint: w.mint, quote: q, index: 0, early: true }), [quitter]);
      const returned = tokenBalance(w.svm, w.mint, quitter.publicKey);
      assert.ok(returned < 20_000n * TOKEN && returned > 0n, "a slice of principal burned");
      assert.equal(readPool(w.svm, w.mint).lifetimeBurned, 20_000n * TOKEN - returned);
      if (q !== WSOL) assert.equal(quoteHeld(w.svm, quitter.publicKey, q), quoteBefore, "an early exit pays no rewards");
      assert.ok(readPool(w.svm, w.mint).undistributed > 0n, "the forfeit streams back out");
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
        uri: metadataUri(mint.publicKey),
        platform: IMAGINE_PLATFORM,
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
          platformConfig: IMAGINE_PLATFORM,
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
      assert.ok(tokenAmount(ctx.svm, creatorFeeVaultPda(rewardVaultPda(mint.publicKey), q.mint)) > 0n, "the dev buy paid the pool fee");
      const uri = `https://api.imagine.fun/files/meta/${mint.publicKey.toBase58()}.json`;
      assert.ok(Buffer.from(ctx.svm.getAccount(mint.publicKey)!.data).includes(Buffer.from(uri)), "the mint's metadata points at its IMAGINE document");
    });
  }
});

describe("launch guards", () => {
  async function launchIx(
    ctx: Ctx,
    overrides: { platform?: PublicKey; restricted?: boolean; fundRaising?: bigint; uri?: (mint: PublicKey) => string } = {},
  ) {
    const creator = fundedKeypair(ctx.svm);
    const mint = Keypair.generate();
    const ix = await client.launch({
      creator: creator.publicKey,
      mint: mint.publicKey,
      quote: WSOL,
      treasury: ctx.treasury.publicKey,
      name: "x",
      symbol: "X",
      uri: (overrides.uri ?? metadataUri)(mint.publicKey),
      platform: overrides.platform ?? IMAGINE_PLATFORM,
      restricted: overrides.restricted,
      supply: SUPPLY,
      totalSell: 793_100_000_000_000n,
      fundRaising: overrides.fundRaising ?? 85n * WSOL.unit,
      globalConfig: WSOL.globalConfig,
    });
    return { ix, signers: [creator, mint], mint: mint.publicKey };
  }

  it("refuses a LaunchLab platform other than the configured one", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const { ix, signers } = await launchIx(ctx, { platform: Keypair.generate().publicKey });
    assert.match(sendExpectingError(ctx.svm, [ix], signers), /PlatformMismatch/);
  });

  it("refuses any metadata URI but the coin's own IMAGINE document, creating nothing", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const other = Keypair.generate().publicKey;
    for (const uri of [
      () => metadataUri(other),
      () => "https://imagine.fun/x.json",
      (mint: PublicKey) => `http://localhost:8080/files/meta/${mint.toBase58()}.json`,
      (mint: PublicKey) => `${metadataUri(mint)}?v=2`,
      (mint: PublicKey) => metadataUri(mint).replace(".json", ""),
    ]) {
      const { ix, signers, mint } = await launchIx(ctx, { uri });
      assert.match(sendExpectingError(ctx.svm, [ix], signers), /InvalidMetadataUri/, uri(mint));
      assert.equal(ctx.svm.getAccount(poolPda(mint)), null);
    }
  });

  it("requires and pins the allow-config / curve-rule accounts only on a restricting platform", async () => {
    const ctx = setup();
    await initConfig(ctx);
    // Make the configured platform restrict curve params (`restrict_curve_param`, offset 833).
    const acc = ctx.svm.getAccount(IMAGINE_PLATFORM)!;
    const data = Buffer.from(acc.data);
    data[833] = 1;
    ctx.svm.setAccount(IMAGINE_PLATFORM, { ...acc, data });

    const bare = await launchIx(ctx);
    assert.match(sendExpectingError(ctx.svm, [bare.ix], bare.signers), /InvalidLaunchLabAccount/);
    const swapped = await launchIx(ctx, { restricted: true });
    const n = swapped.ix.keys.length;
    [swapped.ix.keys[n - 1], swapped.ix.keys[n - 2]] = [swapped.ix.keys[n - 2], swapped.ix.keys[n - 1]];
    assert.match(sendExpectingError(ctx.svm, [swapped.ix], swapped.signers), /InvalidLaunchLabAccount/);
  });

  it("refuses a curve the quote's GlobalConfig does not allow, creating nothing", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const { ix, signers, mint } = await launchIx(ctx, { fundRaising: 1_000n });
    assert.match(sendExpectingError(ctx.svm, [ix], signers), /LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj failed/);
    assert.equal(ctx.svm.getAccount(poolPda(mint)), null);
  });

  it("refuses to sync a token-quoted pool without its reward token account", async () => {
    const ctx = setup();
    await initConfig(ctx);
    const creator = fundedKeypair(ctx.svm);
    const { mint } = await launchCoin(ctx, creator, SPYX);
    send(
      ctx.svm,
      [await client.found({ creator: creator.publicKey, mint, quoteMint: SPYX.mint, initialLockAmount: 10_000n * TOKEN, initialLockDuration: 30 * DAY })],
      [creator],
    );
    const sync = await client.sync({ mint, quote: SPYX });
    // Anchor's optional-account placeholder is the program id.
    const stripped = sync.keys.map((k) =>
      k.pubkey.equals(rewardTokenAccount(mint, SPYX.mint, SPYX.tokenProgram)!) ? { ...k, pubkey: client.programId, isWritable: false } : k,
    );
    assert.match(sendExpectingError(ctx.svm, [{ ...sync, keys: stripped }], [creator]), /QuoteAccountMismatch/);
  });

  it("refuses a collect into anything but the vault's own quote account", async () => {
    const w = await openPool({ quote: SPYX });
    curveBuy(w.svm, fundedKeypair(w.svm), w.mint, SPYX, SPYX.unit);
    const cranker = fundedKeypair(w.svm);
    const [ix] = await client.collectCreatorFee({ payer: cranker.publicKey, mint: w.mint, quote: SPYX });
    const target = quoteAta(rewardVaultPda(w.mint), SPYX);
    const thief = fundQuote(w.svm, cranker, cranker.publicKey, SPYX, 0n);
    const redirected = ix.keys.map((k) => (k.pubkey.equals(target) ? { ...k, pubkey: thief } : k));
    assert.match(sendExpectingError(w.svm, [{ ...ix, keys: redirected }], [cranker]), /QuoteAccountMismatch/);
  });
});

describe("graduated coins", () => {
  for (const q of [WSOL, SPYX] as Quote[]) {
    it(`prices locks from the CPMM pool and collects its creator fee into the pool (${q.symbol})`, async () => {
      const locker = Keypair.generate();
      const w = await openPool({ quote: q, realPrice: true, extraHolders: [{ owner: locker.publicKey, amount: 100_000n * TOKEN }] });
      w.svm.airdrop(locker.publicKey, 10_000_000_000n);

      // Buy out the curve: LaunchLab caps the fill at what is left and moves to status 1.
      const buyer = fundedKeypair(w.svm);
      curveBuy(w.svm, buyer, w.mint, q, 200n * q.unit);
      assert.equal(readLaunchLabPool(w.svm, w.mint, q).status, POOL_STATUS.migrate);
      const cpPool = migrateToCpmm(w, w.mint, q);
      assert.equal(readLaunchLabPool(w.svm, w.mint, q).status, POOL_STATUS.trade);
      assert.ok(cpPool.equals(cpmmPoolPda(CPMM_AMM_CONFIG, w.mint, q.mint)));
      const cp0 = decodeCpmmPool(Buffer.from(w.svm.getAccount(cpPool)!.data));
      assert.ok(cp0.poolCreator.equals(rewardVaultPda(w.mint)), "the pool's vault is the CPMM creator too");

      // Lock pricing reads the CPMM pool once migrated.
      const valuation = valuationAccounts(w.mint, q.mint, CPMM_AMM_CONFIG);
      assert.ok(valuation[0].equals(cpPool));
      const lockArgs = { owner: locker.publicKey, mint: w.mint, quote: q, index: 0, amount: 100_000n * TOKEN, durationSecs: 7 * DAY };
      assert.match(sendExpectingError(w.svm, [await client.lock(lockArgs)], [locker]), /PriceUnavailable/);
      const swapped = await client.lock({ ...lockArgs, valuation: [valuation[0], valuation[2], valuation[1]] });
      assert.match(sendExpectingError(w.svm, [swapped], [locker]), /PriceUnavailable/);
      send(w.svm, [await client.lock({ ...lockArgs, valuation })], [locker]);
      const fees0 = cp0.protocolFeesToken0 + cp0.fundFeesToken0 + cp0.creatorFeesToken0;
      const fees1 = cp0.protocolFeesToken1 + cp0.fundFeesToken1 + cp0.creatorFeesToken1;
      const baseIs0 = cp0.token0Mint.equals(w.mint);
      const baseVault = tokenAmount(w.svm, valuation[1]) - (baseIs0 ? fees0 : fees1);
      const quoteVault = tokenAmount(w.svm, valuation[2]) - (baseIs0 ? fees1 : fees0);
      const p = readPosition(w.svm, w.mint, locker.publicKey, 0)!;
      assert.equal(p.rewardCap, rewardCapFor((100_000n * TOKEN * quoteVault) / baseVault, p.multiplierBps));

      // Collect what the curve accrued up to graduation.
      const cranker = fundedKeypair(w.svm);
      await collect(w, cranker, true);
      assert.equal(tokenAmount(w.svm, creatorFeeVault(w)), 0n);
      const inflowAfterCurve = readPool(w.svm, w.mint).lifetimeInflow;

      // Trade on the CPMM pool, in both directions, once it opens.
      warp(w.svm, Math.max(Number(cp0.openTime) - now(w.svm), 0) + 1);
      const trader = fundedKeypair(w.svm);
      const quoteIn = 5n * q.unit;
      fundQuote(w.svm, trader, trader.publicKey, q, quoteIn);
      send(
        w.svm,
        [createAssociatedTokenAccountIdempotentInstruction(trader.publicKey, coinAta(trader.publicKey, w.mint), trader.publicKey, w.mint, TOKEN_2022_PROGRAM_ID)],
        [trader],
      );
      const ref = { ...cp0, address: cpPool };
      send(w.svm, [cpmmSwapIx({ kind: "swapBaseInput", pool: ref, payer: trader.publicKey, inputMint: q.mint, amount: quoteIn, limit: 1n })], [trader]);
      const coins = tokenBalance(w.svm, w.mint, trader.publicKey);
      send(w.svm, [cpmmSwapIx({ kind: "swapBaseInput", pool: ref, payer: trader.publicKey, inputMint: w.mint, amount: coins / 2n, limit: 1n })], [trader]);
      const cp1 = decodeCpmmPool(Buffer.from(w.svm.getAccount(cpPool)!.data));
      const due = baseIs0 ? cp1.creatorFeesToken1 : cp1.creatorFeesToken0;
      assert.ok(due > 0n, "the CPMM creator fee accrued on the quote side");
      assert.equal(baseIs0 ? cp1.creatorFeesToken0 : cp1.creatorFeesToken1, 0n, "none on the coin side");

      const crankerBefore = lamports(w.svm, cranker.publicKey);
      await collect(w, cranker, true);
      const cp2 = decodeCpmmPool(Buffer.from(w.svm.getAccount(cpPool)!.data));
      assert.equal(cp2.creatorFeesToken0 + cp2.creatorFeesToken1, 0n, "collected");
      // CPMM keeps its protocol share of the creator fee (AmmConfig offset
      // 116, millionths: 5% on this config); the rest reaches the pool.
      const protocolShare = Buffer.from(w.svm.getAccount(CPMM_AMM_CONFIG)!.data).readBigUInt64LE(116);
      assert.equal(protocolShare, 50_000n);
      const collected = due - (due * protocolShare) / 1_000_000n;
      assert.equal(readPool(w.svm, w.mint).lifetimeInflow - inflowAfterCurve, collected, "synced into the pool");
      if (q === WSOL) {
        // Only the vault's coin account stays (its rent is the cranker's one-time cost).
        const coinRent = BigInt(w.svm.getAccount(coinAta(rewardVaultPda(w.mint), w.mint))!.lamports);
        assert.ok(crankerBefore - lamports(w.svm, cranker.publicKey) <= coinRent + 10_000n);
        assert.equal(w.svm.getAccount(quoteAta(rewardVaultPda(w.mint), q))?.lamports ?? 0, 0);
      }
      assertSolvent(w.svm, w.mint, [
        { owner: w.creator.publicKey, index: 0 },
        { owner: locker.publicKey, index: 0 },
      ]);
      void NATIVE_MINT;
    });
  }

  it("prices a graduated coin only off the pool it graduated into, never a rogue pool for the pair", async () => {
    const q = WSOL;
    const locker = Keypair.generate();
    const w = await openPool({ quote: q, realPrice: true, extraHolders: [{ owner: locker.publicKey, amount: 100_000n * TOKEN }] });
    w.svm.airdrop(locker.publicKey, 10_000_000_000n);
    curveBuy(w.svm, fundedKeypair(w.svm), w.mint, q, 200n * q.unit);
    const cpPool = migrateToCpmm(w, w.mint, q);
    const [, baseVault, quoteVault] = valuationAccounts(w.mint, q.mint, CPMM_AMM_CONFIG);
    const baseIs0 = decodeCpmmPool(Buffer.from(w.svm.getAccount(cpPool)!.data)).token0Mint.equals(w.mint);

    // A CPMM pool for (coin, quote) under another AmmConfig, as anyone may open
    // one: `creator` as its pool creator, `base` coin units against the real
    // pool's quote, no fees parked.
    function rogue(creator: PublicKey, base: bigint): PublicKey[] {
      const config = Keypair.generate().publicKey;
      const address = cpmmPoolPda(config, w.mint, q.mint);
      const [coinSide, quoteSide] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
      const real = w.svm.getAccount(cpPool)!;
      const data = Buffer.from(real.data);
      config.toBuffer().copy(data, 8);
      creator.toBuffer().copy(data, 40);
      (baseIs0 ? coinSide : quoteSide).toBuffer().copy(data, 72);
      (baseIs0 ? quoteSide : coinSide).toBuffer().copy(data, 104);
      data.fill(0, 341, 413);
      w.svm.setAccount(address, { ...real, data });
      for (const [key, source, amount] of [
        [coinSide, baseVault, base],
        [quoteSide, quoteVault, tokenAmount(w.svm, quoteVault)],
      ] as const) {
        const acc = w.svm.getAccount(source)!;
        const vault = Buffer.from(acc.data);
        vault.writeBigUInt64LE(amount, 64);
        w.svm.setAccount(key, { ...acc, data: vault });
      }
      return [address, coinSide, quoteSide];
    }

    const lockArgs = { owner: locker.publicKey, mint: w.mint, quote: q, index: 0, amount: 1_000n * TOKEN, durationSecs: 7 * DAY };
    // One coin unit against the whole quote side: every coin "worth" the pool.
    const inflated = await client.lock({ ...lockArgs, valuation: rogue(Keypair.generate().publicKey, 1n) });
    assert.match(sendExpectingError(w.svm, [inflated], [locker]), /PriceUnavailable/);
    // Control: the same forgery naming the vault as creator, which only
    // LaunchLab's migration can do, is priced.
    const control = rogue(rewardVaultPda(w.mint), tokenAmount(w.svm, baseVault));
    send(w.svm, [await client.lock({ ...lockArgs, valuation: control })], [locker]);
    assert.ok(readPosition(w.svm, w.mint, locker.publicKey, 0)!.rewardCap > 0n);
  });
});
