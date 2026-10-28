import { PublicKey, SystemProgram, type AccountMeta, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AccountReader, BorshWriter, disc } from "./layout.ts";

/**
 * Raydium LaunchLab (`raydium_launchpad`) and Raydium CPMM (`raydium_cp_swap`, where LaunchLab pools
 * graduate), mainnet: program ids, PDAs, account decoders by byte offset, the constant-product curve
 * with virtual reserves (curve_type 0) and its fee rules, CPMM swap math, and the public trade
 * instructions. Layouts and rules follow the on-chain IDLs and raydium-sdk-V2.
 */

export const LAUNCHLAB_PROGRAM_ID = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
export const CPMM_PROGRAM_ID = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");

export const RAYDIUM_LAUNCHPAD_URL = "https://raydium.io/launchpad";

/** The coin's page on Raydium's launchpad. */
export const raydiumTokenUrl = (mint: PublicKey | string): string => `${RAYDIUM_LAUNCHPAD_URL}/token/?mint=${mint.toString()}`;

/** Rates are in millionths. */
export const FEE_RATE_DENOMINATOR = 1_000_000n;
/** `curve_type` of the constant-product curve. */
export const CONSTANT_CURVE = 0;
/** `migrate_type` CPMM; the only one `initialize_with_token_2022` accepts. */
export const MIGRATE_TO_CPMM = 1;

export const POOL_STATUS = { fund: 0, migrate: 1, trade: 2 } as const;

/** CPMM `status` bit that disables swaps. */
export const CPMM_SWAP_DISABLED_BIT = 1 << 2;

const enc = (s: string) => Buffer.from(s, "utf8");
const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];
const ceilDiv = (num: bigint, den: bigint) => (num + den - 1n) / den;
const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });

// ---------------- LaunchLab PDAs ----------------

/** `["vault_auth_seed"]`: owner of every pool vault, mint authority while a mint is created. */
export const launchLabAuthorityPda = (program = LAUNCHLAB_PROGRAM_ID) => pda([enc("vault_auth_seed")], program);
export const launchLabEventAuthorityPda = (program = LAUNCHLAB_PROGRAM_ID) => pda([enc("__event_authority")], program);
export const creatorFeeVaultAuthorityPda = (program = LAUNCHLAB_PROGRAM_ID) => pda([enc("creator_fee_vault_auth_seed")], program);
export const platformFeeVaultAuthorityPda = (program = LAUNCHLAB_PROGRAM_ID) => pda([enc("platform_fee_vault_auth_seed")], program);

/** `["global_config", quote_mint, curve_type, index (u16)]`. */
export function globalConfigPda(quoteMint: PublicKey, program = LAUNCHLAB_PROGRAM_ID, curveType = CONSTANT_CURVE, index = 0): PublicKey {
  const idx = Buffer.alloc(2);
  idx.writeUInt16BE(index);
  return pda([enc("global_config"), quoteMint.toBuffer(), Buffer.from([curveType]), idx], program);
}

export const platformConfigPda = (platformAdmin: PublicKey, program = LAUNCHLAB_PROGRAM_ID) =>
  pda([enc("platform_config"), platformAdmin.toBuffer()], program);

export const launchLabPoolPda = (baseMint: PublicKey, quoteMint: PublicKey, program = LAUNCHLAB_PROGRAM_ID) =>
  pda([enc("pool"), baseMint.toBuffer(), quoteMint.toBuffer()], program);

export const launchLabPoolVaultPda = (pool: PublicKey, mint: PublicKey, program = LAUNCHLAB_PROGRAM_ID) =>
  pda([enc("pool_vault"), pool.toBuffer(), mint.toBuffer()], program);

/** Token account collecting the platform's trade fee in `quoteMint`: `[platform_config, quote_mint]`. */
export const platformFeeVaultPda = (platformConfig: PublicKey, quoteMint: PublicKey, program = LAUNCHLAB_PROGRAM_ID) =>
  pda([platformConfig.toBuffer(), quoteMint.toBuffer()], program);

/** Token account collecting a creator's fee in `quoteMint`: `[creator, quote_mint]`, one per (creator, quote) across all their pools. */
export const creatorFeeVaultPda = (creator: PublicKey, quoteMint: PublicKey, program = LAUNCHLAB_PROGRAM_ID) =>
  pda([creator.toBuffer(), quoteMint.toBuffer()], program);

export const platformAllowConfigPda = (platformConfig: PublicKey, globalConfig: PublicKey, program = LAUNCHLAB_PROGRAM_ID) =>
  pda([enc("platform_allow_config"), platformConfig.toBuffer(), globalConfig.toBuffer()], program);

export const platformCurveRulePda = (platformConfig: PublicKey, globalConfig: PublicKey, program = LAUNCHLAB_PROGRAM_ID) =>
  pda([enc("platform_curve_rule"), platformConfig.toBuffer(), globalConfig.toBuffer()], program);

// ---------------- LaunchLab account decoders ----------------

/** Anchor `PoolState` discriminator, shared by the LaunchLab and CPMM pool accounts. */
const POOL_STATE_DISC = disc("f7ede3f5d7c3de46");
const GLOBAL_CONFIG_DISC = disc("95089ccaa0fcb0d9");
const PLATFORM_CONFIG_DISC = disc("a04e8000f853e6a0");
export const GLOBAL_CONFIG_LEN = 371;
export const LAUNCHLAB_POOL_LEN = 429;
export const PLATFORM_CONFIG_LEN = 944;

/** Per-quote curve config (one per quote mint, curve type and index), owned by Raydium. */
export interface GlobalConfig {
  curveType: number;
  index: number;
  /** Quote raw units taken out of the raise at migration. */
  migrateFee: bigint;
  /** Protocol trade fee, millionths. */
  tradeFeeRate: bigint;
  /** Upper bound of a trade's `share_fee_rate` (0 on the xStock configs). */
  maxShareFeeRate: bigint;
  /** Whole base tokens (× 10^decimals). */
  minBaseSupply: bigint;
  maxLockRate: bigint;
  minBaseSellRate: bigint;
  minBaseMigrateRate: bigint;
  /** Smallest `total_quote_fund_raising` a pool may use, quote raw units. */
  minQuoteFundRaising: bigint;
  quoteMint: PublicKey;
  protocolFeeOwner: PublicKey;
  migrateFeeOwner: PublicKey;
  migrateToAmmWallet: PublicKey;
  /** The only key allowed to run `migrate_to_cpswap` (Raydium's crank). */
  migrateToCpswapWallet: PublicKey;
}

export function decodeGlobalConfig(data: Buffer | Uint8Array): GlobalConfig {
  const r = new AccountReader(data, "LaunchLab GlobalConfig", GLOBAL_CONFIG_DISC, GLOBAL_CONFIG_LEN);
  return {
    curveType: r.u8(16),
    index: r.u16(17),
    migrateFee: r.u64(19),
    tradeFeeRate: r.u64(27),
    maxShareFeeRate: r.u64(35),
    minBaseSupply: r.u64(43),
    maxLockRate: r.u64(51),
    minBaseSellRate: r.u64(59),
    minBaseMigrateRate: r.u64(67),
    minQuoteFundRaising: r.u64(75),
    quoteMint: r.pubkey(83),
    protocolFeeOwner: r.pubkey(115),
    migrateFeeOwner: r.pubkey(147),
    migrateToAmmWallet: r.pubkey(179),
    migrateToCpswapWallet: r.pubkey(211),
  };
}

/** The curve's reserves: what every quote below reads. A decoded `LaunchLabPool` is one. */
export interface CurveReserves {
  virtualBase: bigint;
  virtualQuote: bigint;
  /** Base sold so far. */
  realBase: bigint;
  /** Net quote raised so far (fees excluded). */
  realQuote: bigint;
  totalBaseSell: bigint;
}

export interface LaunchLabPool extends CurveReserves {
  /** `POOL_STATUS`: 0 trading on the curve, 1 funded and waiting for migration, 2 migrated to CPMM. */
  status: number;
  baseDecimals: number;
  quoteDecimals: number;
  migrateType: number;
  supply: bigint;
  totalQuoteFundRaising: bigint;
  /** Protocol fee sitting in `quoteVault` until Raydium collects it. */
  quoteProtocolFee: bigint;
  platformFee: bigint;
  migrateFee: bigint;
  vestingTotalLocked: bigint;
  globalConfig: PublicKey;
  platformConfig: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  /** The launch's creator: key of its creator fee vault (`creatorFeeVaultPda(creator, quoteMint)`). */
  creator: PublicKey;
  baseTokenProgram: PublicKey;
  quoteTokenProgram: PublicKey;
  /** CPMM `creator_fee_on` after graduation: 0 quote token only, 1 both tokens. */
  ammCreatorFeeOn: number;
}

export function decodeLaunchLabPool(data: Buffer | Uint8Array): LaunchLabPool {
  const r = new AccountReader(data, "LaunchLab PoolState", POOL_STATE_DISC, LAUNCHLAB_POOL_LEN);
  const programFlag = r.u8(365);
  return {
    status: r.u8(17),
    baseDecimals: r.u8(18),
    quoteDecimals: r.u8(19),
    migrateType: r.u8(20),
    supply: r.u64(21),
    totalBaseSell: r.u64(29),
    virtualBase: r.u64(37),
    virtualQuote: r.u64(45),
    realBase: r.u64(53),
    realQuote: r.u64(61),
    totalQuoteFundRaising: r.u64(69),
    quoteProtocolFee: r.u64(77),
    platformFee: r.u64(85),
    migrateFee: r.u64(93),
    vestingTotalLocked: r.u64(101),
    globalConfig: r.pubkey(141),
    platformConfig: r.pubkey(173),
    baseMint: r.pubkey(205),
    quoteMint: r.pubkey(237),
    baseVault: r.pubkey(269),
    quoteVault: r.pubkey(301),
    creator: r.pubkey(333),
    baseTokenProgram: programFlag & 1 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    quoteTokenProgram: programFlag & 2 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    ammCreatorFeeOn: r.u8(366),
  };
}

/** A platform's config: its trade fees, fee wallets and the CPMM config its pools graduate into. */
export interface PlatformConfig {
  platformFeeWallet: PublicKey;
  /** Receives the locked-LP Fee-Key NFT at graduation. */
  platformNftWallet: PublicKey;
  platformScale: bigint;
  creatorScale: bigint;
  burnScale: bigint;
  /** Platform trade fee, millionths. */
  feeRate: bigint;
  name: string;
  web: string;
  img: string;
  /** CPMM AmmConfig used at migration. */
  cpswapConfig: PublicKey;
  /** Creator trade fee, millionths. */
  creatorFeeRate: bigint;
  transferFeeExtensionAuth: PublicKey;
  platformVestingWallet: PublicKey;
  platformVestingScale: bigint;
  /** CPMM `pool_creator` override; default = each pool's LaunchLab creator. */
  platformCpCreator: PublicKey;
  /** 1 = `initialize` needs the platform allow-config account. */
  restrictGlobalConfig: number;
  /** 1 = `initialize` needs the platform curve-rule account. */
  restrictCurveParam: number;
  curveRuleManager: PublicKey;
}

export function decodePlatformConfig(data: Buffer | Uint8Array): PlatformConfig {
  const r = new AccountReader(data, "LaunchLab PlatformConfig", PLATFORM_CONFIG_DISC, PLATFORM_CONFIG_LEN);
  return {
    platformFeeWallet: r.pubkey(16),
    platformNftWallet: r.pubkey(48),
    platformScale: r.u64(80),
    creatorScale: r.u64(88),
    burnScale: r.u64(96),
    feeRate: r.u64(104),
    name: r.fixedString(112, 64),
    web: r.fixedString(176, 256),
    img: r.fixedString(432, 256),
    cpswapConfig: r.pubkey(688),
    creatorFeeRate: r.u64(720),
    transferFeeExtensionAuth: r.pubkey(728),
    platformVestingWallet: r.pubkey(760),
    platformVestingScale: r.u64(792),
    platformCpCreator: r.pubkey(800),
    restrictGlobalConfig: r.u8(832),
    restrictCurveParam: r.u8(833),
    curveRuleManager: r.pubkey(834),
  };
}

// ---------------- curve math ----------------

/**
 * Virtual reserves LaunchLab computes at `initialize` (SDK `getInitParam`, integer division):
 * `N = S − T − L`, `tf = F − M`, `den = tf·T/N − F`, `vA = (tf·T·T/N)/den`, `vB = F·F/den`.
 * The curve then ends at `(F − M)/N` quote per base, the CPMM opening price.
 */
export function initVirtualReserves(p: {
  supply: bigint;
  totalBaseSell: bigint;
  totalQuoteFundRaising: bigint;
  lockedAmount?: bigint;
  migrateFee?: bigint;
}): { virtualBase: bigint; virtualQuote: bigint } {
  const f = p.totalQuoteFundRaising;
  const left = p.supply - p.totalBaseSell - (p.lockedAmount ?? 0n);
  if (p.supply <= p.totalBaseSell || left <= 0n) throw new Error("supply must exceed total sell plus locked amount");
  const tf = f - (p.migrateFee ?? 0n);
  if (tf <= 0n) throw new Error("fund raising must exceed the migrate fee");
  const den = (tf * p.totalBaseSell) / left - f;
  if (den <= 0n) throw new Error("curve parameters give no positive virtual reserves");
  return {
    virtualBase: (tf * p.totalBaseSell * p.totalBaseSell) / left / den,
    virtualQuote: (f * f) / den,
  };
}

/** A fresh pool's reserves for the given curve parameters. */
export function freshCurve(p: { supply: bigint; totalBaseSell: bigint; totalQuoteFundRaising: bigint }): CurveReserves {
  return { ...initVirtualReserves(p), realBase: 0n, realQuote: 0n, totalBaseSell: p.totalBaseSell };
}

/** Quote-side reserve `vB + rB`. */
export const curveQuoteReserve = (c: CurveReserves) => c.virtualQuote + c.realQuote;
/** Base-side reserve `vA − rA`. */
export const curveBaseReserve = (c: CurveReserves) => c.virtualBase - c.realBase;
/** Base still for sale on the curve: `T − rA`. A buy that takes all of it completes the curve. */
export const curveBaseLeft = (c: CurveReserves) => c.totalBaseSell - c.realBase;

/** `floor(in·outR / (inR + in))`. */
export function curveAmountOut(amountIn: bigint, inReserve: bigint, outReserve: bigint): bigint {
  return (amountIn * outReserve) / (inReserve + amountIn);
}

/** `ceil(inR·out / (outR − out))`; `out` must be below `outR`. */
export function curveAmountIn(amountOut: bigint, inReserve: bigint, outReserve: bigint): bigint {
  if (amountOut >= outReserve) throw new Error("insufficient curve liquidity");
  return ceilDiv(inReserve * amountOut, outReserve - amountOut);
}

/** Spot price as Q64.64 raw quote per raw base: `(vB + rB) / (vA − rA)`. */
export function curvePriceQ64(c: CurveReserves): bigint {
  return (curveQuoteReserve(c) << 64n) / curveBaseReserve(c);
}

/** Spot price as a number, quote base units per coin base unit: `(vB + rB) / (vA − rA)`. */
export function curveSpotPrice(c: CurveReserves): number {
  return Number(curveQuoteReserve(c)) / Number(curveBaseReserve(c));
}

/** Share of the raise collected, `realQuote / totalQuoteFundRaising` in [0, 1]; 1 once the pool left the curve. */
export function curveProgress(pool: Pick<LaunchLabPool, "status" | "realQuote" | "totalQuoteFundRaising">): number {
  if (pool.status !== POOL_STATUS.fund || pool.totalQuoteFundRaising === 0n) return 1;
  return Math.min(1, Math.max(0, Number(pool.realQuote) / Number(pool.totalQuoteFundRaising)));
}

/** The fee rates one trade pays, millionths of the quote amount. */
export interface CurveFeeRates {
  /** `GlobalConfig.trade_fee_rate` (stays in the pool vault for Raydium). */
  protocol: bigint;
  /** `PlatformConfig.fee_rate` (to the platform fee vault). */
  platform: bigint;
  /** `PlatformConfig.creator_fee_rate` (to the creator fee vault). */
  creator: bigint;
  /** The trade's `share_fee_rate` argument (to the share-fee receiver). */
  share: bigint;
}

export function curveFeeRates(global: Pick<GlobalConfig, "tradeFeeRate">, platform: Pick<PlatformConfig, "feeRate" | "creatorFeeRate">, shareFeeRate = 0n): CurveFeeRates {
  return { protocol: global.tradeFeeRate, platform: platform.feeRate, creator: platform.creatorFeeRate, share: shareFeeRate };
}

export function totalFeeRate(r: CurveFeeRates): bigint {
  const total = r.protocol + r.platform + r.creator + r.share;
  if (total > FEE_RATE_DENOMINATOR) throw new Error("total fee rate above 100%");
  return total;
}

/** A trade's quote fee split by rate; the protocol takes the rounding dust. */
export interface CurveFeeSplit {
  protocol: bigint;
  platform: bigint;
  creator: bigint;
  share: bigint;
}

export function splitFee(fee: bigint, r: CurveFeeRates): CurveFeeSplit {
  const total = totalFeeRate(r);
  if (total === 0n) return { protocol: fee, platform: 0n, creator: 0n, share: 0n };
  const platform = (fee * r.platform) / total;
  const share = (fee * r.share) / total;
  const creator = (fee * r.creator) / total;
  return { protocol: fee - platform - share - creator, platform, creator, share };
}

/** Fee on a quote amount: `ceil(amount·rate / 1e6)`. */
export const feeOf = (amount: bigint, rate: bigint) => ceilDiv(amount * rate, FEE_RATE_DENOMINATOR);

/** Gross amount whose fee leaves `net`: `ceil(net·1e6 / (1e6 − rate))`. */
export function grossOf(net: bigint, rate: bigint): bigint {
  if (rate === 0n) return net;
  return ceilDiv(net * FEE_RATE_DENOMINATOR, FEE_RATE_DENOMINATOR - rate);
}

/** A curve trade's fill: quote paid/received gross of fees, base moved, and the fee taken. */
export interface CurveFill {
  /** Buys: quote the payer is charged. Sells: quote the payer receives (after fees). */
  quote: bigint;
  base: bigint;
  /** Net quote that moves the curve (`realQuote` changes by this). */
  curveQuote: bigint;
  fee: bigint;
  split: CurveFeeSplit;
  /** The fill takes the last base for sale: the pool stops trading and waits for migration. */
  completes: boolean;
}

/**
 * `buy_exact_in(quoteIn)`: fee `ceil(in·rate)`, base out of the net. A buy past the base left for sale
 * is capped to it and charged only `grossOf(curveAmountIn(baseLeft))`.
 */
export function buyExactIn(c: CurveReserves, quoteIn: bigint, rates: CurveFeeRates): CurveFill {
  const rate = totalFeeRate(rates);
  const fee = feeOf(quoteIn, rate);
  const net = quoteIn - fee;
  const out = curveAmountOut(net, curveQuoteReserve(c), curveBaseReserve(c));
  const left = curveBaseLeft(c);
  if (out <= left) return { quote: quoteIn, base: out, curveQuote: net, fee, split: splitFee(fee, rates), completes: out === left };
  const capped = curveAmountIn(left, curveQuoteReserve(c), curveBaseReserve(c));
  const gross = grossOf(capped, rate);
  return { quote: gross, base: left, curveQuote: capped, fee: gross - capped, split: splitFee(gross - capped, rates), completes: true };
}

/** `buy_exact_out(baseOut)`: net quote `ceil` for the base (capped to what is left), grossed up by the fee. */
export function buyExactOut(c: CurveReserves, baseOut: bigint, rates: CurveFeeRates): CurveFill {
  const left = curveBaseLeft(c);
  const base = baseOut > left ? left : baseOut;
  const net = curveAmountIn(base, curveQuoteReserve(c), curveBaseReserve(c));
  const gross = grossOf(net, totalFeeRate(rates));
  return { quote: gross, base, curveQuote: net, fee: gross - net, split: splitFee(gross - net, rates), completes: base === left };
}

/** `sell_exact_in(baseIn)`: gross quote out of the curve, fee `ceil(gross·rate)` off it. */
export function sellExactIn(c: CurveReserves, baseIn: bigint, rates: CurveFeeRates): CurveFill {
  const gross = curveAmountOut(baseIn, curveBaseReserve(c), curveQuoteReserve(c));
  const fee = feeOf(gross, totalFeeRate(rates));
  return { quote: gross - fee, base: baseIn, curveQuote: gross, fee, split: splitFee(fee, rates), completes: false };
}

/** `sell_exact_out(quoteOut)`: gross `grossOf(out)` must be within `realQuote`; base in `ceil`. */
export function sellExactOut(c: CurveReserves, quoteOut: bigint, rates: CurveFeeRates): CurveFill {
  const gross = grossOf(quoteOut, totalFeeRate(rates));
  if (gross > c.realQuote) throw new Error("insufficient curve liquidity");
  const base = curveAmountIn(gross, curveBaseReserve(c), curveQuoteReserve(c));
  return { quote: quoteOut, base, curveQuote: gross, fee: gross - quoteOut, split: splitFee(gross - quoteOut, rates), completes: false };
}

/** Reserves after a fill (buys add `curveQuote` and `base`, sells remove them). */
export function applyCurveFill(c: CurveReserves, side: "buy" | "sell", f: Pick<CurveFill, "base" | "curveQuote">): CurveReserves {
  return side === "buy"
    ? { ...c, realBase: c.realBase + f.base, realQuote: c.realQuote + f.curveQuote }
    : { ...c, realBase: c.realBase - f.base, realQuote: c.realQuote - f.curveQuote };
}

// ---------------- LaunchLab instructions ----------------

export type LaunchLabTradeKind = "buyExactIn" | "buyExactOut" | "sellExactIn" | "sellExactOut";

const TRADE_DISC: Record<LaunchLabTradeKind, Uint8Array> = {
  buyExactIn: disc("faea0d7bd59c13ec"),
  buyExactOut: disc("18d3742869039938"),
  sellExactIn: disc("9527de9bd37c981a"),
  sellExactOut: disc("5fc8472208090ba6"),
};

/** What a trade needs from a pool: a decoded `LaunchLabPool` plus its address. */
export type LaunchLabPoolRef = Pick<
  LaunchLabPool,
  "globalConfig" | "platformConfig" | "baseMint" | "quoteMint" | "baseVault" | "quoteVault" | "creator" | "baseTokenProgram" | "quoteTokenProgram"
> & { address: PublicKey };

/**
 * A public curve trade by `payer`. The arguments are the instruction's own:
 * - `buyExactIn(amountIn = quote, limit = minimum base out)`
 * - `buyExactOut(amount = base out, limit = maximum quote in)`
 * - `sellExactIn(amount = base in, limit = minimum quote out)`
 * - `sellExactOut(amount = quote out, limit = maximum base in)`
 *
 * Both user token accounts must exist (default: `payer`'s ATAs); the base one is a Token-2022 account
 * for Token-2022 launches. The mandatory remaining accounts are appended: share-fee receiver (only with
 * `shareFeeRate > 0`), system program, platform fee vault, creator fee vault.
 */
export function launchLabTradeIx(p: {
  programId?: PublicKey;
  kind: LaunchLabTradeKind;
  pool: LaunchLabPoolRef;
  payer: PublicKey;
  amount: bigint;
  limit: bigint;
  shareFeeRate?: bigint;
  shareFeeReceiver?: PublicKey;
  userBaseToken?: PublicKey;
  userQuoteToken?: PublicKey;
}): TransactionInstruction {
  const { pool } = p;
  const programId = p.programId ?? LAUNCHLAB_PROGRAM_ID;
  const shareFeeRate = p.shareFeeRate ?? 0n;
  if (shareFeeRate > 0n && !p.shareFeeReceiver) throw new Error("a share fee needs its receiver token account");
  const userBase = p.userBaseToken ?? getAssociatedTokenAddressSync(pool.baseMint, p.payer, true, pool.baseTokenProgram);
  const userQuote = p.userQuoteToken ?? getAssociatedTokenAddressSync(pool.quoteMint, p.payer, true, pool.quoteTokenProgram);
  const keys: AccountMeta[] = [
    { pubkey: p.payer, isSigner: true, isWritable: true },
    ro(launchLabAuthorityPda(programId)),
    ro(pool.globalConfig),
    ro(pool.platformConfig),
    rw(pool.address),
    rw(userBase),
    rw(userQuote),
    rw(pool.baseVault),
    rw(pool.quoteVault),
    ro(pool.baseMint),
    ro(pool.quoteMint),
    ro(pool.baseTokenProgram),
    ro(pool.quoteTokenProgram),
    ro(launchLabEventAuthorityPda(programId)),
    ro(programId),
    ...(shareFeeRate > 0n ? [rw(p.shareFeeReceiver!)] : []),
    ro(SystemProgram.programId),
    rw(platformFeeVaultPda(pool.platformConfig, pool.quoteMint, programId)),
    rw(creatorFeeVaultPda(pool.creator, pool.quoteMint, programId)),
  ];
  const data = new BorshWriter(TRADE_DISC[p.kind]).u64(p.amount).u64(p.limit).u64(shareFeeRate).build();
  return new TransactionInstruction({ programId, keys, data });
}

/** `create_platform_config` arguments. Scales are millionths of the graduated LP and must sum to 1e6. */
export interface PlatformConfigParams {
  platformScale: bigint;
  creatorScale: bigint;
  burnScale: bigint;
  /** Platform trade fee, millionths (≤ 50,000). */
  feeRate: bigint;
  name: string;
  web: string;
  img: string;
  /** Creator trade fee, millionths (≤ 5,000). */
  creatorFeeRate: bigint;
  platformVestingScale: bigint;
}

/**
 * LaunchLab's ceilings on a platform's fee rates (millionths), enforced by
 * `create_platform_config`: verified against the mainnet build in this
 * package's tests (5,001 creator / 50,001 platform are rejected).
 */
export const LAUNCHLAB_MAX_CREATOR_FEE_RATE = 5_000n;
export const LAUNCHLAB_MAX_PLATFORM_FEE_RATE = 50_000n;

/**
 * The IMAGINE platform: no platform fee, the maximum creator fee (paid to each
 * coin's creator, which is its pool's reward vault), all graduated LP locked
 * with the Fee-Key NFT to `platform_nft_wallet`, no vesting.
 */
export const IMAGINE_PLATFORM_PARAMS: Readonly<PlatformConfigParams> = {
  platformScale: 1_000_000n,
  creatorScale: 0n,
  burnScale: 0n,
  feeRate: 0n,
  name: "IMAGINE",
  web: "https://imagine.fun",
  img: "https://imagine.fun/brand/imagine-512.png",
  creatorFeeRate: LAUNCHLAB_MAX_CREATOR_FEE_RATE,
  platformVestingScale: 0n,
};

/**
 * `create_platform_config` for the IMAGINE platform (`IMAGINE_PLATFORM_PARAMS`)
 * under `admin`; its address is `platformConfigPda(admin)`. `cpswapConfig` is
 * the CPMM AmmConfig graduated pools are created under (pick one with a
 * creator fee: the pool's vault collects it after graduation).
 * `platform_cp_creator` stays default, so the CPMM pool creator is each coin's
 * LaunchLab creator — its reward vault.
 */
export function imaginePlatformConfigIx(p: {
  admin: PublicKey;
  nftWallet: PublicKey;
  cpswapConfig: PublicKey;
  /** Receives the (zero) platform fee; defaults to `admin`. */
  feeWallet?: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  return createPlatformConfigIx({
    programId: p.programId,
    platformAdmin: p.admin,
    platformFeeWallet: p.feeWallet ?? p.admin,
    platformNftWallet: p.nftWallet,
    cpswapConfig: p.cpswapConfig,
    transferFeeExtensionAuthority: p.admin,
    platformVestingWallet: p.admin,
    params: IMAGINE_PLATFORM_PARAMS,
  });
}

/** `create_platform_config` by `platformAdmin` (signer, payer): the PlatformConfig PDA of that admin. */
export function createPlatformConfigIx(p: {
  programId?: PublicKey;
  platformAdmin: PublicKey;
  platformFeeWallet: PublicKey;
  platformNftWallet: PublicKey;
  /** CPMM AmmConfig graduated pools are created with. */
  cpswapConfig: PublicKey;
  transferFeeExtensionAuthority: PublicKey;
  platformVestingWallet: PublicKey;
  params: PlatformConfigParams;
}): TransactionInstruction {
  const programId = p.programId ?? LAUNCHLAB_PROGRAM_ID;
  const a = p.params;
  const data = new BorshWriter(disc("b05ac4affd71dc14"))
    .u64(a.platformScale)
    .u64(a.creatorScale)
    .u64(a.burnScale)
    .u64(a.feeRate)
    .string(a.name)
    .string(a.web)
    .string(a.img)
    .u64(a.creatorFeeRate)
    .u64(a.platformVestingScale)
    .build();
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: p.platformAdmin, isSigner: true, isWritable: true },
      ro(p.platformFeeWallet),
      ro(p.platformNftWallet),
      rw(platformConfigPda(p.platformAdmin, programId)),
      ro(p.cpswapConfig),
      ro(SystemProgram.programId),
      ro(p.transferFeeExtensionAuthority),
      ro(p.platformVestingWallet),
    ],
    data,
  });
}

/**
 * One field `update_platform_config` changes (`PlatformConfigParam`, variant index = Borsh tag, per
 * LaunchLab's on-chain IDL and raydium-sdk-V2 `updatePlatformConfig`). `AllInfo` is not supported.
 */
export type PlatformConfigUpdate =
  | { kind: "feeWallet"; value: PublicKey }
  | { kind: "nftWallet"; value: PublicKey }
  | { kind: "migrateNftInfo"; platformScale: bigint; creatorScale: bigint; burnScale: bigint }
  | { kind: "feeRate"; value: bigint }
  | { kind: "name" | "web" | "img"; value: string }
  /** The new CPMM AmmConfig rides as a third account, not in the data. */
  | { kind: "cpswapConfig"; value: PublicKey }
  | { kind: "vestingWallet"; value: PublicKey }
  | { kind: "platformVestingScale"; value: bigint }
  | { kind: "platformCpCreator"; value: PublicKey }
  | { kind: "restrictGlobalConfig" | "restrictCurveParam"; value: bigint }
  | { kind: "curveRuleManager"; value: PublicKey };

const PLATFORM_CONFIG_PARAM_TAG: Record<PlatformConfigUpdate["kind"], number> = {
  feeWallet: 0,
  nftWallet: 1,
  migrateNftInfo: 2,
  feeRate: 3,
  name: 4,
  web: 5,
  img: 6,
  cpswapConfig: 7,
  vestingWallet: 9,
  platformVestingScale: 10,
  platformCpCreator: 11,
  restrictGlobalConfig: 12,
  restrictCurveParam: 13,
  curveRuleManager: 14,
};

/**
 * `update_platform_config`: `admin` (signer) changes one field of its PlatformConfig
 * (`platformConfigPda(admin)`); every other field is left as is.
 */
export function updatePlatformConfigIx(p: { admin: PublicKey; platformConfig?: PublicKey; param: PlatformConfigUpdate; programId?: PublicKey }): TransactionInstruction {
  const programId = p.programId ?? LAUNCHLAB_PROGRAM_ID;
  const param = p.param;
  const w = new BorshWriter(disc("c33c4c81922d438f")).u8(PLATFORM_CONFIG_PARAM_TAG[param.kind]);
  const keys: AccountMeta[] = [
    { pubkey: p.admin, isSigner: true, isWritable: false },
    rw(p.platformConfig ?? platformConfigPda(p.admin, programId)),
  ];
  switch (param.kind) {
    case "feeWallet":
    case "nftWallet":
    case "vestingWallet":
    case "platformCpCreator":
    case "curveRuleManager":
      w.pubkey(param.value);
      break;
    case "migrateNftInfo":
      w.u64(param.platformScale).u64(param.creatorScale).u64(param.burnScale);
      break;
    case "feeRate":
    case "platformVestingScale":
    case "restrictGlobalConfig":
    case "restrictCurveParam":
      w.u64(param.value);
      break;
    case "name":
    case "web":
    case "img":
      w.string(param.value);
      break;
    case "cpswapConfig":
      keys.push(ro(param.value));
      break;
  }
  return new TransactionInstruction({ programId, keys, data: w.build() });
}

/**
 * `claim_platform_fee_from_vault`: drains the platform fee vault of `quoteMint` into the platform fee
 * wallet's ATA (created if needed). Signed by the platform fee wallet.
 */
export function claimPlatformFeeIx(p: {
  programId?: PublicKey;
  platformFeeWallet: PublicKey;
  platformConfig: PublicKey;
  quoteMint: PublicKey;
  quoteTokenProgram: PublicKey;
}): TransactionInstruction {
  const programId = p.programId ?? LAUNCHLAB_PROGRAM_ID;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: p.platformFeeWallet, isSigner: true, isWritable: true },
      ro(platformFeeVaultAuthorityPda(programId)),
      ro(p.platformConfig),
      rw(platformFeeVaultPda(p.platformConfig, p.quoteMint, programId)),
      rw(getAssociatedTokenAddressSync(p.quoteMint, p.platformFeeWallet, true, p.quoteTokenProgram)),
      ro(p.quoteMint),
      ro(p.quoteTokenProgram),
      ro(SystemProgram.programId),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
    ],
    data: Buffer.from(disc("75f1c6a8f8da501d")),
  });
}

// ---------------- CPMM PDAs ----------------

export const cpmmAuthorityPda = (program = CPMM_PROGRAM_ID) => pda([enc("vault_and_lp_mint_auth_seed")], program);

/** `["amm_config", index (u16 big-endian)]`. */
export function cpmmAmmConfigPda(index: number, program = CPMM_PROGRAM_ID): PublicKey {
  const idx = Buffer.alloc(2);
  idx.writeUInt16BE(index);
  return pda([enc("amm_config"), idx], program);
}

/** The two mints in CPMM order: token 0 sorts below token 1 by pubkey bytes. */
export function cpmmTokenOrder(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] {
  return Buffer.compare(a.toBuffer(), b.toBuffer()) < 0 ? [a, b] : [b, a];
}

/** `["pool", amm_config, token0, token1]`: where a LaunchLab pool of these mints graduates under `ammConfig`. */
export function cpmmPoolPda(ammConfig: PublicKey, mintA: PublicKey, mintB: PublicKey, program = CPMM_PROGRAM_ID): PublicKey {
  const [token0, token1] = cpmmTokenOrder(mintA, mintB);
  return pda([enc("pool"), ammConfig.toBuffer(), token0.toBuffer(), token1.toBuffer()], program);
}

export const cpmmLpMintPda = (pool: PublicKey, program = CPMM_PROGRAM_ID) => pda([enc("pool_lp_mint"), pool.toBuffer()], program);
export const cpmmVaultPda = (pool: PublicKey, mint: PublicKey, program = CPMM_PROGRAM_ID) =>
  pda([enc("pool_vault"), pool.toBuffer(), mint.toBuffer()], program);
export const cpmmObservationPda = (pool: PublicKey, program = CPMM_PROGRAM_ID) => pda([enc("observation"), pool.toBuffer()], program);
/** Passed to every creator-fee collect, initialized or not. */
export const cpmmCreatorFeeSharePda = (creator: PublicKey, ammConfig: PublicKey, program = CPMM_PROGRAM_ID) =>
  pda([enc("creator_fee_share"), creator.toBuffer(), ammConfig.toBuffer()], program);
export const cpmmPermissionPda = (owner: PublicKey, program = CPMM_PROGRAM_ID) => pda([enc("permission"), owner.toBuffer()], program);
export const cpmmSupportMintPda = (mint: PublicKey, program = CPMM_PROGRAM_ID) => pda([enc("support_mint"), mint.toBuffer()], program);

// ---------------- CPMM account decoders ----------------

const AMM_CONFIG_DISC = disc("daf42168cbcb2b6f");
export const CPMM_POOL_LEN = 637;
export const CPMM_AMM_CONFIG_LEN = 236;

export interface CpmmPool {
  ammConfig: PublicKey;
  /** Who may collect creator fees (LaunchLab: `platform_cp_creator` if set, else the launch's creator). */
  poolCreator: PublicKey;
  token0Vault: PublicKey;
  token1Vault: PublicKey;
  lpMint: PublicKey;
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  token0Program: PublicKey;
  token1Program: PublicKey;
  observationKey: PublicKey;
  /** Bits: 0 deposit, 1 withdraw, 2 swap disabled. */
  status: number;
  mint0Decimals: number;
  mint1Decimals: number;
  lpSupply: bigint;
  protocolFeesToken0: bigint;
  protocolFeesToken1: bigint;
  fundFeesToken0: bigint;
  fundFeesToken1: bigint;
  openTime: bigint;
  /** 0 both tokens, 1 only token 0, 2 only token 1: which input side pays the creator fee. */
  creatorFeeOn: number;
  enableCreatorFee: boolean;
  creatorFeesToken0: bigint;
  creatorFeesToken1: bigint;
}

export function decodeCpmmPool(data: Buffer | Uint8Array): CpmmPool {
  const r = new AccountReader(data, "CPMM PoolState", POOL_STATE_DISC, CPMM_POOL_LEN);
  return {
    ammConfig: r.pubkey(8),
    poolCreator: r.pubkey(40),
    token0Vault: r.pubkey(72),
    token1Vault: r.pubkey(104),
    lpMint: r.pubkey(136),
    token0Mint: r.pubkey(168),
    token1Mint: r.pubkey(200),
    token0Program: r.pubkey(232),
    token1Program: r.pubkey(264),
    observationKey: r.pubkey(296),
    status: r.u8(329),
    mint0Decimals: r.u8(331),
    mint1Decimals: r.u8(332),
    lpSupply: r.u64(333),
    protocolFeesToken0: r.u64(341),
    protocolFeesToken1: r.u64(349),
    fundFeesToken0: r.u64(357),
    fundFeesToken1: r.u64(365),
    openTime: r.u64(373),
    creatorFeeOn: r.u8(389),
    enableCreatorFee: r.bool(390),
    creatorFeesToken0: r.u64(397),
    creatorFeesToken1: r.u64(405),
  };
}

export interface CpmmAmmConfig {
  index: number;
  disableCreatePool: boolean;
  /** LP trade fee, millionths of the input. */
  tradeFeeRate: bigint;
  /** Millionths of the trade fee. */
  protocolFeeRate: bigint;
  /** Millionths of the trade fee. */
  fundFeeRate: bigint;
  createPoolFee: bigint;
  /** Millionths of the volume, on top of the trade fee (only on pools with `enableCreatorFee`). */
  creatorFeeRate: bigint;
}

export function decodeCpmmAmmConfig(data: Buffer | Uint8Array): CpmmAmmConfig {
  const r = new AccountReader(data, "CPMM AmmConfig", AMM_CONFIG_DISC, CPMM_AMM_CONFIG_LEN);
  return {
    disableCreatePool: r.bool(9),
    index: r.u16(10),
    tradeFeeRate: r.u64(12),
    protocolFeeRate: r.u64(20),
    fundFeeRate: r.u64(28),
    createPoolFee: r.u64(36),
    creatorFeeRate: r.u64(108),
  };
}

// ---------------- CPMM swap math ----------------

/**
 * Tradable reserves (`vault_amount_without_fee`): vault balances minus the protocol, fund and creator
 * fee counters that still sit in the vaults.
 */
export function cpmmReserves(pool: CpmmPool, vault0Amount: bigint, vault1Amount: bigint): { reserve0: bigint; reserve1: bigint } {
  const reserve0 = vault0Amount - pool.protocolFeesToken0 - pool.fundFeesToken0 - pool.creatorFeesToken0;
  const reserve1 = vault1Amount - pool.protocolFeesToken1 - pool.fundFeesToken1 - pool.creatorFeesToken1;
  if (reserve0 < 0n || reserve1 < 0n) throw new Error("CPMM vault below its fee counters");
  return { reserve0, reserve1 };
}

/** One side's view of a swap: the reserves in and out, and where the creator fee is charged. */
export interface CpmmSwapSide {
  inputReserve: bigint;
  outputReserve: bigint;
  /** 0 when the pool has creator fees disabled. */
  creatorFeeRate: bigint;
  creatorFeeOnInput: boolean;
}

/** The swap side for `inputMint` at the given vault balances (`get_swap_params`). */
export function cpmmSwapSide(pool: CpmmPool, vault0Amount: bigint, vault1Amount: bigint, inputMint: PublicKey, config: CpmmAmmConfig): CpmmSwapSide {
  const { reserve0, reserve1 } = cpmmReserves(pool, vault0Amount, vault1Amount);
  const zeroForOne = inputMint.equals(pool.token0Mint);
  if (!zeroForOne && !inputMint.equals(pool.token1Mint)) throw new Error("mint is not in this CPMM pool");
  const creatorFeeOnInput = pool.creatorFeeOn === 0 || (pool.creatorFeeOn === 1 && zeroForOne) || (pool.creatorFeeOn === 2 && !zeroForOne);
  return {
    inputReserve: zeroForOne ? reserve0 : reserve1,
    outputReserve: zeroForOne ? reserve1 : reserve0,
    creatorFeeRate: pool.enableCreatorFee ? config.creatorFeeRate : 0n,
    creatorFeeOnInput,
  };
}

export interface CpmmSwapResult {
  /** Input charged, fees included. */
  amountIn: bigint;
  /** Output paid to the user, creator fee (when on output) taken. */
  amountOut: bigint;
  /** Trade fee (LP + protocol + fund), in the input token. */
  tradeFee: bigint;
  protocolFee: bigint;
  fundFee: bigint;
  /** Creator fee, in the input token or (when charged on output) the output token. */
  creatorFee: bigint;
  /** Input that enters the curve. */
  inputToCurve: bigint;
  /**
   * What the input side's tradable reserve (`cpmmReserves`) grows by: the vault receives all of
   * `amountIn`, only the protocol and fund fees (and an input-side creator fee) go to its fee
   * counters, so the LP share of the trade fee stays in the reserve.
   */
  inputToReserve: bigint;
  /** Output that leaves the curve and the output side's reserve (`amountOut` + an output-side creator fee). */
  outputFromCurve: bigint;
}

/** `swap_base_input`: exact input, floored output. */
export function cpmmSwapBaseInput(s: CpmmSwapSide, amountIn: bigint, config: CpmmAmmConfig): CpmmSwapResult {
  let tradeFee: bigint;
  let creatorFee = 0n;
  let net: bigint;
  if (s.creatorFeeOnInput) {
    const total = ceilDiv(amountIn * (config.tradeFeeRate + s.creatorFeeRate), FEE_RATE_DENOMINATOR);
    const rateSum = config.tradeFeeRate + s.creatorFeeRate;
    creatorFee = rateSum === 0n ? 0n : (total * s.creatorFeeRate) / rateSum;
    tradeFee = total - creatorFee;
    net = amountIn - total;
  } else {
    tradeFee = ceilDiv(amountIn * config.tradeFeeRate, FEE_RATE_DENOMINATOR);
    net = amountIn - tradeFee;
  }
  const swapped = (net * s.outputReserve) / (s.inputReserve + net);
  let amountOut = swapped;
  if (!s.creatorFeeOnInput) {
    creatorFee = ceilDiv(swapped * s.creatorFeeRate, FEE_RATE_DENOMINATOR);
    amountOut = swapped - creatorFee;
  }
  const protocolFee = (tradeFee * config.protocolFeeRate) / FEE_RATE_DENOMINATOR;
  const fundFee = (tradeFee * config.fundFeeRate) / FEE_RATE_DENOMINATOR;
  return {
    amountIn,
    amountOut,
    tradeFee,
    protocolFee,
    fundFee,
    creatorFee,
    inputToCurve: net,
    inputToReserve: amountIn - protocolFee - fundFee - (s.creatorFeeOnInput ? creatorFee : 0n),
    outputFromCurve: swapped,
  };
}

const preFee = (post: bigint, rate: bigint) => (rate === 0n ? post : ceilDiv(post * FEE_RATE_DENOMINATOR, FEE_RATE_DENOMINATOR - rate));

/** `swap_base_output`: exact output, ceiled input. */
export function cpmmSwapBaseOutput(s: CpmmSwapSide, amountOut: bigint, config: CpmmAmmConfig): CpmmSwapResult {
  let creatorFee = 0n;
  let fromCurve = amountOut;
  if (!s.creatorFeeOnInput) {
    fromCurve = preFee(amountOut, s.creatorFeeRate);
    creatorFee = fromCurve - amountOut;
  }
  if (fromCurve >= s.outputReserve) throw new Error("insufficient CPMM liquidity");
  const swapped = ceilDiv(s.inputReserve * fromCurve, s.outputReserve - fromCurve);
  let tradeFee: bigint;
  let amountIn: bigint;
  if (s.creatorFeeOnInput) {
    const rateSum = config.tradeFeeRate + s.creatorFeeRate;
    amountIn = preFee(swapped, rateSum);
    const total = amountIn - swapped;
    creatorFee = rateSum === 0n ? 0n : (total * s.creatorFeeRate) / rateSum;
    tradeFee = total - creatorFee;
  } else {
    amountIn = preFee(swapped, config.tradeFeeRate);
    tradeFee = amountIn - swapped;
  }
  const protocolFee = (tradeFee * config.protocolFeeRate) / FEE_RATE_DENOMINATOR;
  const fundFee = (tradeFee * config.fundFeeRate) / FEE_RATE_DENOMINATOR;
  return {
    amountIn,
    amountOut,
    tradeFee,
    protocolFee,
    fundFee,
    creatorFee,
    inputToCurve: swapped,
    inputToReserve: amountIn - protocolFee - fundFee - (s.creatorFeeOnInput ? creatorFee : 0n),
    outputFromCurve: fromCurve,
  };
}

/** Base and quote tradable reserves of `baseMint`'s pool side. */
function cpmmBaseQuote(pool: CpmmPool, vault0Amount: bigint, vault1Amount: bigint, baseMint: PublicKey): [bigint, bigint] {
  const { reserve0, reserve1 } = cpmmReserves(pool, vault0Amount, vault1Amount);
  if (baseMint.equals(pool.token0Mint)) return [reserve0, reserve1];
  if (baseMint.equals(pool.token1Mint)) return [reserve1, reserve0];
  throw new Error("mint is not in this CPMM pool");
}

/** Spot price of `baseMint` as Q64.64 raw quote per raw base from tradable reserves. */
export function cpmmPriceQ64(pool: CpmmPool, vault0Amount: bigint, vault1Amount: bigint, baseMint: PublicKey): bigint {
  const [base, quote] = cpmmBaseQuote(pool, vault0Amount, vault1Amount, baseMint);
  return (quote << 64n) / base;
}

/** Spot price of `baseMint` as a number, raw quote per raw base, from tradable reserves. */
export function cpmmSpotPrice(pool: CpmmPool, vault0Amount: bigint, vault1Amount: bigint, baseMint: PublicKey): number {
  const [base, quote] = cpmmBaseQuote(pool, vault0Amount, vault1Amount, baseMint);
  return Number(quote) / Number(base);
}

// ---------------- CPMM instructions ----------------

/** What a swap needs from a pool: a decoded `CpmmPool` plus its address. */
export type CpmmPoolRef = Pick<
  CpmmPool,
  "ammConfig" | "token0Vault" | "token1Vault" | "token0Mint" | "token1Mint" | "token0Program" | "token1Program" | "observationKey"
> & { address: PublicKey };

/**
 * A public CPMM swap by `payer` of `inputMint` into the pool's other mint.
 * `swapBaseInput(amount = exact input, limit = minimum output)`;
 * `swapBaseOutput(amount = exact output, limit = maximum input)`.
 * Token accounts default to `payer`'s ATAs; the output one must exist.
 */
export function cpmmSwapIx(p: {
  programId?: PublicKey;
  kind: "swapBaseInput" | "swapBaseOutput";
  pool: CpmmPoolRef;
  payer: PublicKey;
  inputMint: PublicKey;
  amount: bigint;
  limit: bigint;
  inputTokenAccount?: PublicKey;
  outputTokenAccount?: PublicKey;
}): TransactionInstruction {
  const { pool } = p;
  const programId = p.programId ?? CPMM_PROGRAM_ID;
  const zeroForOne = p.inputMint.equals(pool.token0Mint);
  if (!zeroForOne && !p.inputMint.equals(pool.token1Mint)) throw new Error("mint is not in this CPMM pool");
  const [inMint, outMint] = zeroForOne ? [pool.token0Mint, pool.token1Mint] : [pool.token1Mint, pool.token0Mint];
  const [inVault, outVault] = zeroForOne ? [pool.token0Vault, pool.token1Vault] : [pool.token1Vault, pool.token0Vault];
  const [inProgram, outProgram] = zeroForOne ? [pool.token0Program, pool.token1Program] : [pool.token1Program, pool.token0Program];
  const data =
    p.kind === "swapBaseInput"
      ? new BorshWriter(disc("8fbe5adac41e33de")).u64(p.amount).u64(p.limit).build()
      : new BorshWriter(disc("37d96256a34ab4ad")).u64(p.limit).u64(p.amount).build();
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: p.payer, isSigner: true, isWritable: false },
      ro(cpmmAuthorityPda(programId)),
      ro(pool.ammConfig),
      rw(pool.address),
      rw(p.inputTokenAccount ?? getAssociatedTokenAddressSync(inMint, p.payer, true, inProgram)),
      rw(p.outputTokenAccount ?? getAssociatedTokenAddressSync(outMint, p.payer, true, outProgram)),
      rw(inVault),
      rw(outVault),
      ro(inProgram),
      ro(outProgram),
      ro(inMint),
      ro(outMint),
      rw(pool.observationKey),
    ],
    data,
  });
}
