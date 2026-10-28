import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  FEE_RATE_DENOMINATOR,
  POOL_STATUS,
  applyCurveFill,
  buyExactIn,
  buyExactOut,
  cpmmPoolPda,
  cpmmPriceQ64,
  cpmmReserves,
  cpmmSpotPrice,
  cpmmSwapBaseInput,
  cpmmSwapBaseOutput,
  cpmmSwapIx,
  cpmmSwapSide,
  cpmmTokenOrder,
  creatorFeeVaultPda,
  curveAmountIn,
  curvePriceQ64,
  curveProgress,
  curveSpotPrice,
  decodeCpmmAmmConfig,
  decodeGlobalConfig,
  decodePlatformConfig,
  freshCurve,
  globalConfigPda,
  grossOf,
  initVirtualReserves,
  launchLabTradeIx,
  platformFeeVaultPda,
  sellExactIn,
  sellExactOut,
  splitFee,
  stonkfunTokenUrl,
  type CpmmAmmConfig,
  type CpmmPool,
  type CurveFeeRates,
} from "../src/launchlab.ts";
import { QUOTES, QUOTE_CATEGORIES, WSOL_MINT, findQuote, isNativeQuote, parseQuotesJson, quoteByMint, quoteMintViolations, readMintRisk, readUiMultiplier } from "../src/quotes.ts";
import { ammConfigStonkfun, globalConfigSpyx, mintSpyx, mintWsol, platformRaydium } from "./fixtures/launchlab.ts";

/** LaunchLab's standard curve: 1B coins (6 decimals), 793.1M sold on the curve. */
const TOTAL_SUPPLY = 1_000_000_000_000_000n;
const TOTAL_SELL = 793_100_000_000_000n;
const SPYX = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
/** StonkFun's SPYx raise (`/launchlab/pricing?quoteMint=SPYx`, 2026-10-26). */
const SPYX_F = 1_119_761_750n;
/** protocol 0.25% + platform 0.5% + creator 0.5%. */
const RATES: CurveFeeRates = { protocol: 2_500n, platform: 5_000n, creator: 5_000n, share: 0n };

// ---------------- LaunchLab ----------------

test("init virtual reserves match StonkFun's SPYx curve", () => {
  const v = initVirtualReserves({ supply: TOTAL_SUPPLY, totalBaseSell: TOTAL_SELL, totalQuoteFundRaising: SPYX_F });
  assert.equal(v.virtualBase, 1_073_025_605_642_766n);
  assert.equal(v.virtualQuote, 395_221_265n);
});

test("GlobalConfig PDA and decoder", () => {
  assert.equal(globalConfigPda(SPYX).toBase58(), "B7ctMMdGvy46Am56myTtzfkNzt9kWZVTNGM2BWrJ9adg");
  assert.equal(globalConfigPda(WSOL_MINT).toBase58(), "6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX");
  const g = decodeGlobalConfig(globalConfigSpyx);
  assert.equal(g.curveType, 0);
  assert.equal(g.index, 0);
  assert.equal(g.tradeFeeRate, 2_500n);
  assert.equal(g.migrateFee, 0n);
  assert.equal(g.maxShareFeeRate, 0n);
  assert.equal(g.minQuoteFundRaising, 1n);
  assert.equal(g.minBaseMigrateRate, 150_000n);
  assert.ok(g.quoteMint.equals(SPYX));
  assert.equal(g.migrateToCpswapWallet.toBase58(), "RAYpQbFNq9i3mu6cKpTKKRwwHFDeK5AuZz8xvxUrCgw");
  assert.throws(() => decodeGlobalConfig(platformRaydium), /discriminator/);
});

test("PlatformConfig decoder (Raydium's default platform)", () => {
  const p = decodePlatformConfig(platformRaydium);
  assert.equal(p.feeRate, 7_500n);
  assert.equal(p.creatorFeeRate, 500n);
  assert.equal(p.cpswapConfig.toBase58(), "D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2");
  assert.equal(p.restrictGlobalConfig, 0);
  assert.equal(p.restrictCurveParam, 0);
  assert.equal(p.platformScale + p.creatorScale + p.burnScale, 1_000_000n);
});

test("buy_exact_in: fee rounds up, split floors, protocol takes the dust", () => {
  const c = freshCurve({ supply: TOTAL_SUPPLY, totalBaseSell: TOTAL_SELL, totalQuoteFundRaising: SPYX_F });
  const f = buyExactIn(c, 1_000n, RATES);
  assert.equal(f.fee, 13n);
  assert.equal(f.curveQuote, 987n);
  assert.equal(f.base, (987n * c.virtualBase) / (c.virtualQuote + 987n));
  assert.deepEqual(f.split, { platform: 5n, creator: 5n, share: 0n, protocol: 3n });
  assert.equal(f.quote, 1_000n);
  assert.equal(f.completes, false);
  assert.equal(buyExactIn(c, 80_000n, RATES).fee, 1_000n);
});

test("buy_exact_in past the curve is capped to what is left and charged only for it", () => {
  const c = freshCurve({ supply: TOTAL_SUPPLY, totalBaseSell: TOTAL_SELL, totalQuoteFundRaising: SPYX_F });
  const f = buyExactIn(c, SPYX_F * 2n, RATES);
  assert.equal(f.base, TOTAL_SELL);
  assert.equal(f.completes, true);
  const net = curveAmountIn(TOTAL_SELL, c.virtualQuote, c.virtualBase);
  assert.equal(f.curveQuote, net);
  assert.equal(f.quote, grossOf(net, 12_500n));
  assert.ok(net - SPYX_F <= 2n && SPYX_F - net <= 2n, `net ${net} vs F ${SPYX_F}`);
  const end = curvePriceQ64(applyCurveFill(c, "buy", f));
  const open = (SPYX_F << 64n) / (TOTAL_SUPPLY - TOTAL_SELL);
  const gap = end > open ? end - open : open - end;
  assert.ok(gap < open / 1_000_000n, `end ${end} vs open ${open}`);
});

test("buy_exact_out charges the grossed-up net; buy_exact_in of that amount delivers at least the tokens", () => {
  const c = freshCurve({ supply: TOTAL_SUPPLY, totalBaseSell: TOTAL_SELL, totalQuoteFundRaising: SPYX_F });
  const want = 50_000_000_000_000n;
  const out = buyExactOut(c, want, RATES);
  assert.equal(out.base, want);
  assert.equal(out.curveQuote, curveAmountIn(want, c.virtualQuote, c.virtualBase));
  assert.equal(out.quote, (out.curveQuote * FEE_RATE_DENOMINATOR + (FEE_RATE_DENOMINATOR - 12_500n) - 1n) / (FEE_RATE_DENOMINATOR - 12_500n));
  assert.equal(out.fee, out.quote - out.curveQuote);
  assert.ok(buyExactIn(c, out.quote, RATES).base >= want);
});

test("sell_exact_in / sell_exact_out fees and round trip", () => {
  const fresh = freshCurve({ supply: TOTAL_SUPPLY, totalBaseSell: TOTAL_SELL, totalQuoteFundRaising: SPYX_F });
  const buy = buyExactIn(fresh, 100_000_000n, RATES);
  const c = applyCurveFill(fresh, "buy", buy);
  const sell = sellExactIn(c, buy.base, RATES);
  assert.equal(sell.fee, (sell.curveQuote * 12_500n + FEE_RATE_DENOMINATOR - 1n) / FEE_RATE_DENOMINATOR);
  assert.equal(sell.quote, sell.curveQuote - sell.fee);
  assert.ok(sell.curveQuote <= buy.curveQuote);
  const exact = sellExactOut(c, sell.quote, RATES);
  assert.ok(exact.base <= buy.base);
  assert.ok(sellExactIn(c, exact.base, RATES).quote >= sell.quote);
  assert.throws(() => sellExactOut(c, c.realQuote, RATES), /liquidity/);
});

test("splitFee with a share fee", () => {
  const s = splitFee(1_001n, { protocol: 2_500n, platform: 5_000n, creator: 5_000n, share: 2_500n });
  assert.deepEqual(s, { platform: 333n, share: 166n, creator: 333n, protocol: 169n });
});

test("spot price, progress and StonkFun URL", () => {
  const c = freshCurve({ supply: TOTAL_SUPPLY, totalBaseSell: TOTAL_SELL, totalQuoteFundRaising: SPYX_F });
  assert.equal(curveSpotPrice(c), 395_221_265 / 1_073_025_605_642_766);
  const half = { status: POOL_STATUS.fund, realQuote: SPYX_F / 2n, totalQuoteFundRaising: SPYX_F };
  assert.ok(Math.abs(curveProgress(half) - 0.5) < 1e-9);
  assert.equal(curveProgress({ ...half, realQuote: SPYX_F * 2n }), 1);
  assert.equal(curveProgress({ ...half, status: POOL_STATUS.trade }), 1);
  assert.equal(stonkfunTokenUrl(SPYX), `https://www.stonkfun.xyz/token/${SPYX.toBase58()}`);
});

test("trade instruction: 15 accounts plus the mandatory remaining accounts", () => {
  const payer = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const platformConfig = Keypair.generate().publicKey;
  const pool = {
    address: Keypair.generate().publicKey,
    globalConfig: globalConfigPda(SPYX),
    platformConfig,
    baseMint: Keypair.generate().publicKey,
    quoteMint: SPYX,
    baseVault: Keypair.generate().publicKey,
    quoteVault: Keypair.generate().publicKey,
    creator,
    baseTokenProgram: TOKEN_2022_PROGRAM_ID,
    quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
  };
  const ix = launchLabTradeIx({ kind: "buyExactIn", pool, payer, amount: 7n, limit: 5n });
  assert.equal(ix.keys.length, 18);
  assert.ok(ix.keys[0]!.isSigner && ix.keys[0]!.isWritable);
  assert.ok(ix.keys[15]!.pubkey.equals(SystemProgram.programId));
  assert.ok(ix.keys[16]!.pubkey.equals(platformFeeVaultPda(platformConfig, SPYX)) && ix.keys[16]!.isWritable);
  assert.ok(ix.keys[17]!.pubkey.equals(creatorFeeVaultPda(creator, SPYX)) && ix.keys[17]!.isWritable);
  assert.equal(ix.data.toString("hex"), "faea0d7bd59c13ec" + "0700000000000000" + "0500000000000000" + "0000000000000000");
  const receiver = Keypair.generate().publicKey;
  const shared = launchLabTradeIx({ kind: "sellExactIn", pool, payer, amount: 1n, limit: 0n, shareFeeRate: 100n, shareFeeReceiver: receiver });
  assert.equal(shared.keys.length, 19);
  assert.ok(shared.keys[15]!.pubkey.equals(receiver) && shared.keys[15]!.isWritable);
  assert.equal(shared.data.subarray(0, 8).toString("hex"), "9527de9bd37c981a");
});

// ---------------- CPMM ----------------

/** StonkFun's graduation config: trade 0.25% (protocol 12%, fund 4% of it), creator 1%. */
const CONFIG: CpmmAmmConfig = decodeCpmmAmmConfig(ammConfigStonkfun);
const MINTS = cpmmTokenOrder(Keypair.generate().publicKey, Keypair.generate().publicKey);

function cpmmPool(creatorFeeOn: number, [m0, m1]: [PublicKey, PublicKey]): CpmmPool {
  return {
    ammConfig: Keypair.generate().publicKey,
    poolCreator: Keypair.generate().publicKey,
    token0Vault: Keypair.generate().publicKey,
    token1Vault: Keypair.generate().publicKey,
    lpMint: Keypair.generate().publicKey,
    token0Mint: m0,
    token1Mint: m1,
    token0Program: TOKEN_2022_PROGRAM_ID,
    token1Program: TOKEN_PROGRAM_ID,
    observationKey: Keypair.generate().publicKey,
    status: 0,
    mint0Decimals: 6,
    mint1Decimals: 9,
    lpSupply: 0n,
    protocolFeesToken0: 100n,
    protocolFeesToken1: 1_000n,
    fundFeesToken0: 20n,
    fundFeesToken1: 300n,
    openTime: 0n,
    creatorFeeOn,
    enableCreatorFee: true,
    creatorFeesToken0: 5n,
    creatorFeesToken1: 7_000n,
  };
}

test("AmmConfig decoder", () => {
  assert.equal(CONFIG.index, 11);
  assert.equal(CONFIG.tradeFeeRate, 2_500n);
  assert.equal(CONFIG.creatorFeeRate, 10_000n);
  assert.equal(CONFIG.protocolFeeRate, 120_000n);
  assert.equal(CONFIG.fundFeeRate, 40_000n);
});

test("reserves are vault balances minus the protocol, fund and creator fee counters", () => {
  const p = cpmmPool(0, MINTS);
  assert.deepEqual(cpmmReserves(p, 1_000_125n, 2_008_300n), { reserve0: 1_000_000n, reserve1: 2_000_000n });
  assert.throws(() => cpmmReserves(p, 100n, 2_008_300n), /fee counters/);
  assert.equal(cpmmPriceQ64(p, 1_000_125n, 2_008_300n, MINTS[0]), (2_000_000n << 64n) / 1_000_000n);
  assert.equal(cpmmSpotPrice(p, 1_000_125n, 2_008_300n, MINTS[0]), 2);
  assert.equal(cpmmSpotPrice(p, 1_000_125n, 2_008_300n, MINTS[1]), 0.5);
});

test("swap_base_input with the creator fee on the input", () => {
  const side = cpmmSwapSide(cpmmPool(0, MINTS), 1_000_000_000_125n, 5_000_000_008_300n, MINTS[0], CONFIG);
  assert.equal(side.creatorFeeOnInput, true);
  const r = cpmmSwapBaseInput(side, 1_000_000n, CONFIG);
  assert.equal(r.creatorFee, 10_000n);
  assert.equal(r.tradeFee, 2_500n);
  assert.equal(r.protocolFee, 300n);
  assert.equal(r.fundFee, 100n);
  assert.equal(r.inputToCurve, 987_500n);
  assert.equal(r.amountOut, (987_500n * 5_000_000_000_000n) / (1_000_000_000_000n + 987_500n));
  assert.equal(r.outputFromCurve, r.amountOut);
});

test("swap_base_input with the creator fee on the output rounds it up", () => {
  const side = cpmmSwapSide(cpmmPool(2, MINTS), 1_000_000_000_125n, 5_000_000_008_300n, MINTS[0], CONFIG);
  assert.equal(side.creatorFeeOnInput, false);
  const r = cpmmSwapBaseInput(side, 1_000_001n, CONFIG);
  assert.equal(r.tradeFee, 2_501n);
  const swapped = (997_500n * 5_000_000_000_000n) / (1_000_000_000_000n + 997_500n);
  assert.equal(r.outputFromCurve, swapped);
  assert.equal(r.creatorFee, (swapped * 10_000n + 999_999n) / 1_000_000n);
  assert.equal(r.amountOut, swapped - r.creatorFee);
});

test("creator fee off when the pool has it disabled", () => {
  const side = cpmmSwapSide({ ...cpmmPool(0, MINTS), enableCreatorFee: false }, 1_000_000_000_125n, 5_000_000_008_300n, MINTS[1], CONFIG);
  assert.equal(side.creatorFeeRate, 0n);
  assert.equal(cpmmSwapBaseInput(side, 1_000_000n, CONFIG).creatorFee, 0n);
});

test("swap_base_output: the input it charges buys at least the output back", () => {
  for (const feeOn of [0, 1, 2]) {
    const side = cpmmSwapSide(cpmmPool(feeOn, MINTS), 1_000_000_000_125n, 5_000_000_008_300n, MINTS[1], CONFIG);
    const r = cpmmSwapBaseOutput(side, 123_456n, CONFIG);
    assert.equal(r.amountOut, 123_456n);
    assert.ok(cpmmSwapBaseInput(side, r.amountIn, CONFIG).amountOut >= 123_456n, `creatorFeeOn ${feeOn}`);
    assert.ok(cpmmSwapBaseInput(side, r.amountIn - 10n, CONFIG).amountOut < 123_456n, `creatorFeeOn ${feeOn}: overcharged`);
  }
});

test("reserves after a swap keep the LP share of the trade fee", () => {
  for (const feeOn of [0, 2]) {
    const p = cpmmPool(feeOn, MINTS);
    const [vault0, vault1] = [1_000_000_000_125n, 5_000_000_008_300n];
    const side = cpmmSwapSide(p, vault0, vault1, MINTS[0], CONFIG);
    const res = cpmmSwapBaseInput(side, 1_000_000n, CONFIG);
    const after: CpmmPool = {
      ...p,
      protocolFeesToken0: p.protocolFeesToken0 + res.protocolFee,
      fundFeesToken0: p.fundFeesToken0 + res.fundFee,
      creatorFeesToken0: p.creatorFeesToken0 + (side.creatorFeeOnInput ? res.creatorFee : 0n),
      creatorFeesToken1: p.creatorFeesToken1 + (side.creatorFeeOnInput ? 0n : res.creatorFee),
    };
    const before = cpmmReserves(p, vault0, vault1);
    const reread = cpmmReserves(after, vault0 + res.amountIn, vault1 - res.amountOut);
    assert.equal(reread.reserve0, before.reserve0 + res.inputToReserve, `creatorFeeOn ${feeOn}`);
    assert.equal(reread.reserve1, before.reserve1 - res.outputFromCurve, `creatorFeeOn ${feeOn}`);
    assert.ok(res.inputToReserve > res.inputToCurve);
  }
});

test("pool PDA is order-independent; swap instruction layout", () => {
  const [a, b] = MINTS;
  const cfg = Keypair.generate().publicKey;
  assert.ok(cpmmPoolPda(cfg, a, b).equals(cpmmPoolPda(cfg, b, a)));
  const p = { ...cpmmPool(0, MINTS), address: Keypair.generate().publicKey };
  const payer = Keypair.generate().publicKey;
  const ix = cpmmSwapIx({ kind: "swapBaseInput", pool: p, payer, inputMint: b, amount: 10n, limit: 9n });
  assert.equal(ix.keys.length, 13);
  assert.ok(ix.keys[6]!.pubkey.equals(p.token1Vault) && ix.keys[7]!.pubkey.equals(p.token0Vault));
  assert.ok(ix.keys[8]!.pubkey.equals(TOKEN_PROGRAM_ID) && ix.keys[9]!.pubkey.equals(TOKEN_2022_PROGRAM_ID));
  assert.ok(ix.keys[10]!.pubkey.equals(b) && ix.keys[11]!.pubkey.equals(a));
  assert.equal(ix.data.toString("hex"), "8fbe5adac41e33de" + "0a00000000000000" + "0900000000000000");
  const out = cpmmSwapIx({ kind: "swapBaseOutput", pool: p, payer, inputMint: a, amount: 10n, limit: 12n });
  assert.equal(out.data.toString("hex"), "37d96256a34ab4ad" + "0c00000000000000" + "0a00000000000000");
});

// ---------------- quotes ----------------

test("SPYx ScaledUiAmount multiplier switches at its effective timestamp", () => {
  const effective = Date.parse("2026-06-18T04:00:00Z") / 1000;
  assert.equal(readUiMultiplier(mintSpyx, effective - 1), 1.003909240011759);
  assert.equal(readUiMultiplier(mintSpyx, effective), 1.005714560286254);
  assert.equal(readUiMultiplier(mintWsol), 1);
});

test("SPYx issuer powers", () => {
  assert.deepEqual(readMintRisk(mintSpyx), { permanentDelegate: true, pausable: true, freezable: true, transferHookActive: false, transferFeeBps: 0, paused: false });
  assert.deepEqual(readMintRisk(mintWsol), { permanentDelegate: false, pausable: false, freezable: false, transferHookActive: false, transferFeeBps: 0, paused: false });
});

test("every quote's GlobalConfig is its canonical PDA", () => {
  for (const q of QUOTES) assert.equal(q.globalConfig, globalConfigPda(new PublicKey(q.mint)).toBase58(), q.symbol);
});

test("registry contents, lookups and JSON round trip", () => {
  for (const symbol of ["SOL", "USDC", "SPYx", "NVDAx", "QQQx", "TSLAx", "AAPLx", "MSTRx"]) assert.ok(QUOTES.some((q) => q.symbol === symbol), symbol);
  const categories = new Set(QUOTE_CATEGORIES.map((c) => c.id));
  for (const q of QUOTES) assert.ok(categories.has(q.category), `${q.symbol} category`);
  assert.equal(quoteByMint(SPYX)?.symbol, "SPYx");
  assert.equal(quoteByMint(WSOL_MINT)?.issuer, "native");
  assert.ok(isNativeQuote(WSOL_MINT) && isNativeQuote(WSOL_MINT.toBase58()) && !isNativeQuote(SPYX));
  assert.equal(quoteByMint("PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF"), undefined);
  const list = [...QUOTES];
  const keyed = list.map((q) => ({ ...q, pythFeedId: q.pythFeedId, priceMint: q.priceMint }));
  assert.deepEqual(parseQuotesJson(JSON.stringify(list)), keyed);
  assert.equal(findQuote(list, SPYX.toBase58())?.symbol, "SPYx");
  assert.throws(() => parseQuotesJson(JSON.stringify([list[0], list[0]])), /duplicate/);
  assert.throws(() => parseQuotesJson(JSON.stringify([{ ...list[0], tokenProgram: list[0]!.mint }])), /tokenProgram/);
  assert.throws(() => parseQuotesJson(JSON.stringify([{ ...list[0], issuer: "prestocks" }])), /issuer/);
  const { category: _c, ...uncategorized } = { ...list[0]!, issuer: "xstocks" as const };
  assert.equal(parseQuotesJson(JSON.stringify([uncategorized]))[0]!.category, "stocks");
  assert.throws(() => parseQuotesJson(JSON.stringify([{ ...list[0], category: "bonds" }])), /category/);
});

test("quoteMintViolations flags Token-2022 extensions that break plain transfers", () => {
  assert.deepEqual(quoteMintViolations(mintWsol), []);
  assert.deepEqual(quoteMintViolations(mintSpyx), []);
  const mint = (...entries: [number, Buffer][]) => {
    const head = Buffer.alloc(166);
    head[165] = 1;
    const tlv = entries.map(([type, value]) => {
      const h = Buffer.alloc(4);
      h.writeUInt16LE(type, 0);
      h.writeUInt16LE(value.length, 2);
      return Buffer.concat([h, value]);
    });
    return Buffer.concat([head, ...tlv]);
  };
  const fee = Buffer.alloc(108);
  assert.deepEqual(quoteMintViolations(mint([1, fee])), []);
  fee.writeUInt16LE(100, 106);
  assert.deepEqual(quoteMintViolations(mint([1, fee])), ["transfer fee 100 bps"]);
  const feeAuthority = Buffer.alloc(108);
  feeAuthority[0] = 7;
  assert.deepEqual(quoteMintViolations(mint([1, feeAuthority])), ["transfer fee 0 bps (fee authority set)"]);
  const hook = Buffer.alloc(64);
  hook[0] = 1;
  assert.deepEqual(quoteMintViolations(mint([14, hook])), []);
  hook[40] = 1;
  assert.deepEqual(quoteMintViolations(mint([14, hook])), ["transfer hook program active"]);
  assert.deepEqual(quoteMintViolations(mint([6, Buffer.from([2])])), ["new accounts frozen by default"]);
  assert.deepEqual(quoteMintViolations(mint([6, Buffer.from([1])])), []);
  assert.deepEqual(quoteMintViolations(mint([9, Buffer.alloc(0)])), ["non-transferable"]);
});
