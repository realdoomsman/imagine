import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { FailedTransactionMetadata } from "litesvm";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { FeeKind, KEEPER_AUTHORITY, MIN_COMPOUND_QUOTE } from "../src/constants.ts";
import {
  compoundMinOut,
  cpmmSwapSide,
  curveFeeRates,
  decodeCpmmAmmConfig,
  decodeCpmmPool,
  decodeGlobalConfig,
  decodePlatformConfig,
  quoteCompound,
  type CompoundVenue,
} from "../src/launchlab.ts";
import { claimableFor } from "../src/math.ts";
import { tokenVaultPda } from "../src/pda.ts";
import { valuationAccounts } from "../src/client.ts";
import {
  client,
  CPMM_AMM_CONFIG,
  curveBuy,
  DAY,
  fundedKeypair,
  fundQuote,
  IMAGINE_PLATFORM,
  lamports,
  migrateToCpmm,
  now,
  readLaunchLabPool,
  rewardBalance,
  send,
  sendExpectingError,
  setVirtualQuote,
  SPYX,
  TOKEN,
  tokenAmount,
  tokenBalance,
  transferCoins,
  warp,
  WSOL,
  type Quote,
} from "./harness.ts";
import { assertSolvent, openPool, readPool, readPosition, settleStream, type World } from "./world.ts";

/**
 * The IMAGINE keeper. Its key is not in the repo, so its transactions are sent
 * with signature verification off and a random placeholder signature: the
 * program only sees that `KEEPER_AUTHORITY` signed.
 */
const KEEPER = { publicKey: KEEPER_AUTHORITY } as const;
type Payer = Keypair | typeof KEEPER;

function keeperOf(w: World): typeof KEEPER {
  w.svm.airdrop(KEEPER_AUTHORITY, 1_000_000_000_000n);
  return KEEPER;
}

/** Send as `payer`; returns the logs, and whether it failed when `expectError`. */
function sendAs(w: World, ixs: TransactionInstruction[], payer: Payer, expectError = false): string {
  if (payer instanceof Keypair) {
    return expectError ? sendExpectingError(w.svm, ixs, [payer]) : send(w.svm, ixs, [payer]).join("\n");
  }
  const tx = new Transaction();
  tx.recentBlockhash = w.svm.latestBlockhash();
  tx.feePayer = payer.publicKey;
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  const message = tx.compileMessage();
  tx.signatures = message.accountKeys
    .slice(0, message.header.numRequiredSignatures)
    .map((publicKey) => ({ publicKey, signature: randomBytes(64) }));
  w.svm.withSigverify(false);
  const result = w.svm.sendTransaction(tx);
  w.svm.withSigverify(true);
  w.svm.expireBlockhash();
  const failed = result instanceof FailedTransactionMetadata;
  const logs = failed ? result.meta().logs() : result.logs();
  if (failed !== expectError) {
    throw new Error(`expected ${expectError ? "failure" : "success"}:\n${logs.join("\n")}`);
  }
  return logs.join("\n");
}

/** Where a compound on this coin buys right now, for `quoteCompound`. */
function venue(w: World, graduated: boolean): CompoundVenue {
  if (!graduated) {
    const ll = readLaunchLabPool(w.svm, w.mint, w.quote);
    const global = decodeGlobalConfig(Buffer.from(w.svm.getAccount(w.quote.globalConfig)!.data));
    const platform = decodePlatformConfig(Buffer.from(w.svm.getAccount(IMAGINE_PLATFORM)!.data));
    return { kind: "curve", pool: ll, rates: curveFeeRates(global, platform) };
  }
  const [cp] = valuationAccounts(w.mint, w.quote.mint, CPMM_AMM_CONFIG);
  const pool = decodeCpmmPool(Buffer.from(w.svm.getAccount(cp)!.data));
  const config = decodeCpmmAmmConfig(Buffer.from(w.svm.getAccount(CPMM_AMM_CONFIG)!.data));
  const side = cpmmSwapSide(pool, tokenAmount(w.svm, pool.token0Vault), tokenAmount(w.svm, pool.token1Vault), w.quote.mint, config);
  return { kind: "cpmm", side, config };
}

/** What a compound of `owner`'s lock would spend right now (the pool synced first). */
async function compoundable(w: World, owner: PublicKey, index = 0): Promise<bigint> {
  send(w.svm, [await client.sync({ mint: w.mint, quote: w.quote })], [fundedKeypair(w.svm)]);
  return claimableFor(readPosition(w.svm, w.mint, owner, index)!, readPool(w.svm, w.mint));
}

function compoundIx(w: World, p: { payer: PublicKey; owner: PublicKey; minTokensOut: bigint; graduated?: boolean; index?: number }) {
  return client.compound({
    payer: p.payer,
    owner: p.owner,
    mint: w.mint,
    index: p.index ?? 0,
    minTokensOut: p.minTokensOut,
    quote: w.quote,
    globalConfig: w.quote.globalConfig,
    platformConfig: IMAGINE_PLATFORM,
    graduated: p.graduated ? { ammConfig: CPMM_AMM_CONFIG } : undefined,
  });
}

async function toggle(w: World, owner: Keypair, enabled: boolean, index = 0) {
  send(w.svm, [await client.setAutoCompound({ owner: owner.publicKey, mint: w.mint, index, enabled })], [owner]);
}

/** App fees into the pool, then the whole stream released. */
async function feed(w: World, amount: bigint) {
  const payer = fundedKeypair(w.svm, 10_000);
  if (w.quote !== WSOL) fundQuote(w.svm, payer, payer.publicKey, w.quote, amount);
  send(w.svm, [await client.depositReward({ payer: payer.publicKey, mint: w.mint, quote: w.quote, amount, kind: FeeKind.Buy })], [payer]);
  await settleStream(w, payer);
}

/** A pool on the real curve price with `locker` holding a 30-day lock of `amount`. */
async function lockedPool(q: Quote, amount: bigint, opts: { whaleBuy?: bigint } = {}) {
  const locker = Keypair.generate();
  const w = await openPool({ quote: q, realPrice: true, whaleBuy: opts.whaleBuy ?? 40n * q.unit, extraHolders: [{ owner: locker.publicKey, amount }] });
  w.svm.airdrop(locker.publicKey, 100_000_000_000n);
  send(
    w.svm,
    [await client.lock({ owner: locker.publicKey, mint: w.mint, quote: w.quote, index: 0, amount, durationSecs: 180 * DAY })],
    [locker],
  );
  return { w, locker };
}

/** Compound `owner`'s lock as `payer` and check every effect against the quote. */
async function compoundAndCheck(w: World, payer: Payer, owner: PublicKey, graduated = false) {
  const quoteIn = await compoundable(w, owner);
  assert.ok(quoteIn >= MIN_COMPOUND_QUOTE, `enough to compound: ${quoteIn}`);
  const quoted = quoteCompound(venue(w, graduated), quoteIn);
  assert.ok(!quoted.capped);
  const before = readPosition(w.svm, w.mint, owner, 0)!;
  const vaultBefore = tokenAmount(w.svm, tokenVaultPda(w.mint));
  const rewardsBefore = rewardBalance(w.svm, w.mint);
  const payerBefore = lamports(w.svm, payer.publicKey);
  const locked = readPool(w.svm, w.mint).totalLocked;
  const ixs = await compoundIx(w, { payer: payer.publicKey, owner, minTokensOut: compoundMinOut(quoted.tokensOut), graduated });
  const logs = sendAs(w, ixs, payer).split("\n");

  const after = readPosition(w.svm, w.mint, owner, 0)!;
  const out = after.amount - before.amount;
  assert.equal(out, quoted.tokensOut, "bought exactly what the venue quoted");
  assert.ok(out >= quoted.floor);
  assert.equal(tokenAmount(w.svm, tokenVaultPda(w.mint)) - vaultBefore, out, "the coins landed in the pool's vault");
  assert.equal(readPool(w.svm, w.mint).totalLocked - locked, out);
  assert.equal(after.claimed - before.claimed, quoteIn, "the spend counts as paid to the lock");
  assert.equal(after.lockEnd, before.lockEnd, "unlock time unchanged");
  assert.ok(after.weight > before.weight);
  assert.ok(after.rewardCap > before.rewardCap);
  assert.equal(rewardsBefore - rewardBalance(w.svm, w.mint), quoteIn, "exactly the compounded quote left the vault");
  assert.ok(payerBefore - lamports(w.svm, payer.publicKey) <= 10_000n, "the payer only pays the fee (WSOL rent refunded)");
  const event = logs
    .filter((line) => line.startsWith("Program data: "))
    .map((line) => client.program.coder.events.decode(line.slice("Program data: ".length)))
    .find((e) => e?.name === "compounded" || e?.name === "Compounded");
  assert.ok(event, "Compounded emitted");
  const data = event.data as Record<string, { toArrayLike(ctor: typeof Buffer, endian: string): Buffer; toString(): string }>;
  const big = (k: string) => BigInt(`0x${data[k].toArrayLike(Buffer, "be").toString("hex") || "0"}`);
  assert.equal(big("quoteIn"), quoteIn);
  assert.equal(big("tokensOut"), out);
  assert.equal(big("newAmount"), after.amount);
  assert.equal(big("newWeight"), after.weight);
  assert.equal(data.owner.toString(), owner.toBase58());
  return { quoteIn, out };
}

for (const q of [WSOL, SPYX] as Quote[]) {
  describe(`auto-compound (${q.symbol} quote)`, () => {
    it("is opt-in and owner-toggled; only the owner or the IMAGINE keeper may compound", async () => {
      const { w, locker } = await lockedPool(q, 50_000_000n * TOKEN);
      await feed(w, 2n * q.unit);
      const keeper = keeperOf(w);
      const cranker = fundedKeypair(w.svm);
      const as = async (payer: PublicKey, minTokensOut: bigint) =>
        compoundIx(w, { payer, owner: locker.publicKey, minTokensOut });
      assert.equal(readPosition(w.svm, w.mint, locker.publicKey, 0)!.autoCompound, false, "off by default");

      // Off: even the keeper may not compound someone else's lock.
      assert.match(sendAs(w, await as(keeper.publicKey, 1n), keeper, true), /CompoundNotEnabled/);
      // Nobody but the owner may toggle it.
      const forged = await client.setAutoCompound({ owner: locker.publicKey, mint: w.mint, index: 0, enabled: true });
      forged.keys[0] = { pubkey: cranker.publicKey, isSigner: true, isWritable: false };
      assert.match(sendExpectingError(w.svm, [forged], [cranker]), /ConstraintSeeds|ConstraintHasOne/);
      assert.equal(readPosition(w.svm, w.mint, locker.publicKey, 0)!.autoCompound, false);

      await toggle(w, locker, true);
      assert.equal(readPosition(w.svm, w.mint, locker.publicKey, 0)!.autoCompound, true);
      // On: still nobody but the keeper, and the keeper only with a limit.
      assert.match(sendAs(w, await as(cranker.publicKey, 1n), cranker, true), /NotKeeper/);
      assert.match(sendAs(w, await as(keeper.publicKey, 0n), keeper, true), /InvalidParameter/);
      await compoundAndCheck(w, keeper, locker.publicKey);
      assertSolvent(w.svm, w.mint, [
        { owner: w.creator.publicKey, index: 0 },
        { owner: locker.publicKey, index: 0 },
      ]);

      // Off again: keepers stop, the owner's one-click compound still works.
      await toggle(w, locker, false);
      await feed(w, 2n * q.unit);
      assert.match(sendAs(w, await as(keeper.publicKey, 1n), keeper, true), /CompoundNotEnabled/);
      assert.match(sendAs(w, await as(cranker.publicKey, 1n), cranker, true), /NotKeeper/);
      await compoundAndCheck(w, locker, locker.publicKey);
      assertSolvent(w.svm, w.mint, [
        { owner: w.creator.publicKey, index: 0 },
        { owner: locker.publicKey, index: 0 },
      ]);
    });

    it("compounds on the CPMM pool once the coin has graduated", async () => {
      const locker = Keypair.generate();
      const w = await openPool({ quote: q, realPrice: true, extraHolders: [{ owner: locker.publicKey, amount: 50_000_000n * TOKEN }] });
      w.svm.airdrop(locker.publicKey, 100_000_000_000n);
      curveBuy(w.svm, fundedKeypair(w.svm, 10_000), w.mint, q, 200n * q.unit);
      const cpPool = migrateToCpmm(w, w.mint, q);
      const cp = decodeCpmmPool(Buffer.from(w.svm.getAccount(cpPool)!.data));
      warp(w.svm, Math.max(Number(cp.openTime) - now(w.svm), 0) + 1);
      const valuation = valuationAccounts(w.mint, q.mint, CPMM_AMM_CONFIG);
      send(
        w.svm,
        [await client.lock({ owner: locker.publicKey, mint: w.mint, quote: q, index: 0, amount: 50_000_000n * TOKEN, durationSecs: 180 * DAY, valuation })],
        [locker],
      );
      await feed(w, 2n * q.unit);
      await toggle(w, locker, true);
      const keeper = keeperOf(w);
      // The curve route is refused once migrated: it needs the CPMM accounts.
      sendAs(w, await compoundIx(w, { payer: keeper.publicKey, owner: locker.publicKey, minTokensOut: 1n }), keeper, true);
      await compoundAndCheck(w, keeper, locker.publicKey, true);
      assertSolvent(w.svm, w.mint, [
        { owner: w.creator.publicKey, index: 0 },
        { owner: locker.publicKey, index: 0 },
      ]);
    });

    it("refuses a fill under the keeper's quote (price pushed up first) and over 3% under spot", async () => {
      const { w, locker } = await lockedPool(q, 200_000_000n * TOKEN);
      await toggle(w, locker, true);
      const keeper = keeperOf(w);

      // A small compound quoted honestly, then the price is pumped before it lands.
      await feed(w, q.unit / 2n);
      const quoteIn = await compoundable(w, locker.publicKey);
      const quoted = quoteCompound(venue(w, false), quoteIn);
      curveBuy(w.svm, fundedKeypair(w.svm, 10_000), w.mint, q, 10n * q.unit);
      const pumped = await compoundIx(w, { payer: keeper.publicKey, owner: locker.publicKey, minTokensOut: compoundMinOut(quoted.tokensOut) });
      assert.match(sendAs(w, pumped, keeper, true), /CompoundSlippage/);

      // With only a token limit, the program's own guard still refuses a buy
      // that moves the curve more than COMPOUND_SLIPPAGE_BPS against it.
      await feed(w, 30n * q.unit);
      const big = await compoundable(w, locker.publicKey);
      const bigQuote = quoteCompound(venue(w, false), big);
      assert.ok(bigQuote.tokensOut < bigQuote.floor, `the quote itself is under the floor (${bigQuote.tokensOut} < ${bigQuote.floor})`);
      assert.match(
        sendAs(w, await compoundIx(w, { payer: keeper.publicKey, owner: locker.publicKey, minTokensOut: 1n }), keeper, true),
        /CompoundSlippage/,
      );
      assertSolvent(w.svm, w.mint, [
        { owner: w.creator.publicKey, index: 0 },
        { owner: locker.publicKey, index: 0 },
      ]);
    });

    it("spends no more than the lock's cap allows; the excess goes to the treasury", async () => {
      // A lock taken at the real price, then a big lock taken while the coin
      // is priced far higher: same weight per coin, a much larger cap. The
      // stream fills the first lock well past its own cap.
      const { w, locker } = await lockedPool(q, 2_000_000n * TOKEN);
      await toggle(w, locker, true);
      const rich = Keypair.generate();
      transferCoins(w.svm, w.whale, rich.publicKey, w.mint, 20_000_000n * TOKEN);
      w.svm.airdrop(rich.publicKey, 10_000_000_000n);
      const virtualQuote = readLaunchLabPool(w.svm, w.mint, q).virtualQuote;
      setVirtualQuote(w.svm, w.mint, q, virtualQuote * 1_000n);
      send(
        w.svm,
        [await client.lock({ owner: rich.publicKey, mint: w.mint, quote: q, index: 0, amount: 20_000_000n * TOKEN, durationSecs: 180 * DAY })],
        [rich],
      );
      setVirtualQuote(w.svm, w.mint, q, virtualQuote);
      await feed(w, 20n * q.unit);
      send(w.svm, [await client.sync({ mint: w.mint, quote: w.quote })], [fundedKeypair(w.svm)]);
      const pool0 = readPool(w.svm, w.mint);
      const p0 = readPosition(w.svm, w.mint, locker.publicKey, 0)!;
      const room = p0.rewardCap - p0.claimed;
      const pending = claimableFor({ ...p0, rewardCap: 1n << 120n }, pool0);
      assert.ok(pending > room, `accrued ${pending} is over the cap room ${room}`);
      assert.ok(room >= MIN_COMPOUND_QUOTE, `room ${room}`);
      const keeper = keeperOf(w);
      const { quoteIn } = await compoundAndCheck(w, keeper, locker.publicKey);
      assert.equal(quoteIn, room);
      const p1 = readPosition(w.svm, w.mint, locker.publicKey, 0)!;
      assert.equal(p1.claimed, p0.rewardCap, "paid exactly to the old cap");
      assert.equal(readPool(w.svm, w.mint).treasuryClaimable - pool0.treasuryClaimable, pending - room, "the excess is the treasury's");
      assertSolvent(w.svm, w.mint, [
        { owner: w.creator.publicKey, index: 0 },
        { owner: locker.publicKey, index: 0 },
        { owner: rich.publicKey, index: 0 },
      ]);
    });

    it("refuses renounced and forever locks, matured locks and dust", async () => {
      const { w, locker } = await lockedPool(q, 50_000_000n * TOKEN);
      const keeper = keeperOf(w);

      // Dust: below MIN_COMPOUND_QUOTE.
      await toggle(w, locker, true);
      assert.match(
        sendAs(w, await compoundIx(w, { payer: keeper.publicKey, owner: locker.publicKey, minTokensOut: 1n }), keeper, true),
        /CompoundTooSmall/,
      );

      // Forever (the creator's lock): no toggle, no compound.
      send(w.svm, [await client.lockForever({ owner: w.creator.publicKey, mint: w.mint, quote: q, index: 0 })], [w.creator]);
      assert.match(
        sendExpectingError(w.svm, [await client.setAutoCompound({ owner: w.creator.publicKey, mint: w.mint, index: 0, enabled: true })], [w.creator]),
        /PositionLockedForever/,
      );
      assert.match(
        sendExpectingError(w.svm, await compoundIx(w, { payer: w.creator.publicKey, owner: w.creator.publicKey, minTokensOut: 0n }), [w.creator]),
        /PositionLockedForever/,
      );

      // Matured: nothing to add to.
      await feed(w, 2n * q.unit);
      warp(w.svm, 181 * DAY);
      assert.match(
        sendAs(w, await compoundIx(w, { payer: keeper.publicKey, owner: locker.publicKey, minTokensOut: 1n }), keeper, true),
        /PositionMatured/,
      );

      // Renounced: the flag is cleared and cannot be set again.
      const other = Keypair.generate();
      transferCoins(w.svm, w.whale, other.publicKey, w.mint, 1_000n * TOKEN);
      w.svm.airdrop(other.publicKey, 10_000_000_000n);
      send(
        w.svm,
        [await client.lock({ owner: other.publicKey, mint: w.mint, quote: q, index: 0, amount: 1_000n * TOKEN, durationSecs: 30 * DAY })],
        [other],
      );
      await toggle(w, other, true);
      send(w.svm, [await client.renounce({ owner: other.publicKey, mint: w.mint, quote: q, index: 0 })], [other]);
      assert.equal(readPosition(w.svm, w.mint, other.publicKey, 0)!.autoCompound, false, "renouncing turns it off");
      assert.match(
        sendExpectingError(w.svm, [await client.setAutoCompound({ owner: other.publicKey, mint: w.mint, index: 0, enabled: true })], [other]),
        /PositionRenounced/,
      );
      assert.match(
        sendExpectingError(w.svm, await compoundIx(w, { payer: other.publicKey, owner: other.publicKey, minTokensOut: 0n }), [other]),
        /PositionRenounced/,
      );
    });

    it("stays solvent through churn with compounding", async () => {
      const lockers = [Keypair.generate(), Keypair.generate(), Keypair.generate(), Keypair.generate()];
      const amounts = [30_000_000n, 5_000_000n, 60_000_000n, 1_000_000n].map((a) => a * TOKEN);
      const w = await openPool({
        quote: q,
        realPrice: true,
        whaleBuy: 40n * q.unit,
        extraHolders: lockers.map((l, i) => ({ owner: l.publicKey, amount: amounts[i] * 2n })),
      });
      const keeper = fundedKeypair(w.svm, 10_000);
      const imagineKeeper = keeperOf(w);
      const positions = [{ owner: w.creator.publicKey, index: 0 }, ...lockers.map((l) => ({ owner: l.publicKey, index: 0 }))];
      for (const [i, l] of lockers.entries()) {
        w.svm.airdrop(l.publicKey, 100_000_000_000n);
        send(
          w.svm,
          [await client.lock({ owner: l.publicKey, mint: w.mint, quote: q, index: 0, amount: amounts[i], durationSecs: (60 + 30 * i) * DAY })],
          [l],
        );
        if (i % 2 === 0) await toggle(w, l, true);
      }
      const trader = fundedKeypair(w.svm, 100_000);
      let compounded = 0;
      for (let round = 0; round < 6; round++) {
        curveBuy(w.svm, trader, w.mint, q, q.unit / 2n);
        const payer = fundedKeypair(w.svm, 10_000);
        if (q !== WSOL) fundQuote(w.svm, payer, payer.publicKey, q, q.unit);
        send(w.svm, [await client.depositReward({ payer: payer.publicKey, mint: w.mint, quote: q, amount: q.unit / 2n + BigInt(round) * 7_777n, kind: FeeKind.Buy })], [payer]);
        warp(w.svm, 3_600 * (round + 1));
        send(w.svm, await client.collectCreatorFee({ payer: keeper.publicKey, mint: w.mint, quote: q }), [keeper]);
        for (const [i, l] of lockers.entries()) {
          const p = readPosition(w.svm, w.mint, l.publicKey, 0);
          if (!p) continue;
          const due = await compoundable(w, l.publicKey);
          if (due < MIN_COMPOUND_QUOTE) continue;
          const quoted = quoteCompound(venue(w, false), due);
          if (quoted.capped || quoted.tokensOut < quoted.floor) continue;
          const minTokensOut = compoundMinOut(quoted.tokensOut);
          if (p.autoCompound) {
            sendAs(w, await compoundIx(w, { payer: imagineKeeper.publicKey, owner: l.publicKey, minTokensOut }), imagineKeeper);
            compounded++;
          } else if (round % 2 === 1) {
            send(w.svm, await client.claim({ owner: l.publicKey, mint: w.mint, quote: q, index: 0 }), [l]);
          } else if (i === 1) {
            send(w.svm, await compoundIx(w, { payer: l.publicKey, owner: l.publicKey, minTokensOut }), [l]);
            compounded++;
          }
          assertSolvent(w.svm, w.mint, positions);
        }
        if (round === 3) {
          // One compounder breaks early; its forfeit streams to the rest.
          send(w.svm, await client.unlock({ owner: lockers[2].publicKey, mint: w.mint, quote: q, index: 0, early: true }), [lockers[2]]);
        }
        assertSolvent(w.svm, w.mint, positions);
      }
      assert.ok(compounded >= 4, `compounded ${compounded} times`);

      // Everyone leaves at maturity; the vault still covers every party.
      warp(w.svm, 200 * DAY);
      await settleStream(w, keeper);
      for (const l of lockers) {
        if (!readPosition(w.svm, w.mint, l.publicKey, 0)) continue;
        send(w.svm, await client.unlock({ owner: l.publicKey, payer: keeper.publicKey, mint: w.mint, quote: q, index: 0, early: false }), [keeper]);
        assert.ok(tokenBalance(w.svm, w.mint, l.publicKey) > 0n);
      }
      assertSolvent(w.svm, w.mint, positions);
      const pool = readPool(w.svm, w.mint);
      assert.equal(pool.totalLocked, readPosition(w.svm, w.mint, w.creator.publicKey, 0)!.amount);
      assert.equal(tokenAmount(w.svm, tokenVaultPda(w.mint)), pool.totalLocked, "the vault holds exactly what is locked");
      send(w.svm, await client.claimTreasury({ payer: keeper.publicKey, mint: w.mint, quote: q, treasury: w.treasury.publicKey }), [keeper]);
      send(w.svm, await client.claimCreator({ creator: w.creator.publicKey, mint: w.mint, quote: q }), [w.creator]);
      assertSolvent(w.svm, w.mint, positions);
    });
  });
}
