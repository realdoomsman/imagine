import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  appFeeAmount,
  buyExactIn,
  CPMM_PROGRAM_ID,
  cpmmPoolPda,
  cpmmPriceQ64,
  cpmmSwapBaseInput,
  cpmmSwapIx,
  cpmmSwapSide,
  creatorFeeVaultPda,
  curveFeeRates,
  curvePriceQ64,
  decodeCpmmAmmConfig,
  decodeCpmmPool,
  decodeGlobalConfig,
  decodeLaunchLabPool,
  decodePlatformConfig,
  FeeKind,
  formatTokenAmount,
  freshCurve,
  LAUNCHLAB_PROGRAM_ID,
  launchLabPoolPda,
  launchLabPoolVaultPda,
  launchLabTradeIx,
  metadataUri,
  poolPda,
  rewardVaultPda,
  sellExactIn,
  type CpmmAmmConfig,
  type CpmmPool,
  type CurveFeeRates,
  type GlobalConfig,
  type LaunchLabPool,
  type PlatformConfig,
  type PoolAccount,
  type QuoteRef,
} from "@imagine/sdk";
import { sql } from "./db.ts";
import { ActionError } from "./errors.ts";
import { swapSolToQuote } from "./jupiter.ts";
import { launchableQuotes, launchCurve, quoteDisplay, type QuoteDisplay } from "./quotes.ts";
import { chainConfig, connection, imagine } from "./solana.ts";
import { budgetInstructions, fits, launchLookupTable, tablesFor } from "./transactions.ts";

/**
 * Raydium LaunchLab, under IMAGINE's own platform config: reading a coin's
 * market, and building the transactions that launch and trade it with the
 * IMAGINE app fee attached.
 *
 * Every coin here is a LaunchLab Token-2022 coin under the IMAGINE
 * PlatformConfig (`config.launchlab_platform`), paired with a quote asset
 * (SOL, USDC, a tokenized stock, …). It trades on its LaunchLab curve until
 * the raise fills, then on the Raydium CPMM pool it migrates into. The
 * platform's on-chain trading fee (LaunchLab's `creator_fee_rate`, whose
 * "creator" is the pool's reward vault) accrues to the pool on every curve
 * trade anywhere; trades routed here add the app fee on top. Prices and fees
 * are in quote base units throughout.
 */

const isNative = (quoteMint: PublicKey) => quoteMint.equals(NATIVE_MINT);

// --- read-mostly LaunchLab / CPMM accounts --------------------------------

const ACCOUNT_TTL_MS = 10 * 60_000;
const accountCache = new Map<string, { at: number; value: unknown }>();

/** A config-like account, decoded and cached: these change only by admin action. */
async function cachedAccount<T>(address: PublicKey, decode: (data: Buffer) => T): Promise<T> {
  const key = address.toBase58();
  const hit = accountCache.get(key);
  if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) return hit.value as T;
  const info = await connection.getAccountInfo(address);
  if (!info) throw new Error(`account ${key} not found`);
  const value = decode(info.data);
  accountCache.set(key, { at: Date.now(), value });
  return value;
}

const globalConfig = (address: PublicKey): Promise<GlobalConfig> => cachedAccount(address, decodeGlobalConfig);
/** A LaunchLab PlatformConfig, decoded and cached. */
export const platformConfig = (address: PublicKey): Promise<PlatformConfig> => cachedAccount(address, decodePlatformConfig);
const ammConfig = (address: PublicKey): Promise<CpmmAmmConfig> => cachedAccount(address, decodeCpmmAmmConfig);

/** Every fee a curve trade pays: LaunchLab's protocol fee, the platform fee (0 for IMAGINE) and the pool's trading fee. */
async function feeRates(state: Pick<LaunchLabPool, "globalConfig" | "platformConfig">): Promise<CurveFeeRates> {
  const [global, platform] = await Promise.all([globalConfig(state.globalConfig), platformConfig(state.platformConfig)]);
  return curveFeeRates(global, platform);
}

function tokenAmount(data: Buffer | null | undefined): bigint | null {
  if (!data || data.length < AccountLayout.span) return null;
  return AccountLayout.decode(data.subarray(0, AccountLayout.span)).amount;
}

// --- market ---------------------------------------------------------------

export type MarketStatus = "curve" | "migrating" | "graduated";

export interface CpmmMarket {
  address: PublicKey;
  pool: CpmmPool;
  config: CpmmAmmConfig;
  vault0: bigint;
  vault1: bigint;
}

export interface Market {
  /** The LaunchLab PoolState. */
  address: PublicKey;
  state: LaunchLabPool;
  status: MarketStatus;
  /** Share of the raise filled, 0–1; 1 once the curve is complete. */
  progress: number;
  /** Quote UI units (base units / 10^quote decimals) per whole coin; null when unreadable. */
  priceQuote: number | null;
  /** Raydium CPMM pool once migrated; null on the curve or before the pool exists. */
  cpmm: CpmmMarket | null;
}

const STATUS: Record<number, MarketStatus> = { 0: "curve", 1: "migrating", 2: "graduated" };

/** Raw quote per raw coin as Q64.64, to quote UI per whole coin. */
function q64ToPrice(q64: bigint, coinDecimals: number, quoteDecimals: number): number {
  return (Number(q64) / 2 ** 64) * 10 ** (coinDecimals - quoteDecimals);
}

/** The canonical CPMM pool a coin migrates into (the platform's `cpswap_config`), read with its vault balances. */
async function readCpmm(state: LaunchLabPool): Promise<CpmmMarket | null> {
  const platform = await platformConfig(state.platformConfig);
  const address = cpmmPoolPda(platform.cpswapConfig, state.baseMint, state.quoteMint, CPMM_PROGRAM_ID);
  const info = await connection.getAccountInfo(address);
  if (!info || !info.owner.equals(CPMM_PROGRAM_ID)) return null;
  const pool = decodeCpmmPool(info.data);
  const [[vault0, vault1], config] = await Promise.all([
    connection.getMultipleAccountsInfo([pool.token0Vault, pool.token1Vault]),
    ammConfig(pool.ammConfig),
  ]);
  const amount0 = tokenAmount(vault0?.data);
  const amount1 = tokenAmount(vault1?.data);
  if (amount0 === null || amount1 === null) return null;
  return { address, pool, config, vault0: amount0, vault1: amount1 };
}

/**
 * Where `mint` trades now and at what price. Null when there is no LaunchLab
 * pool for the pair (or something other than LaunchLab owns that address).
 */
export async function readMarket(mint: PublicKey, quoteMint: PublicKey): Promise<Market | null> {
  const address = launchLabPoolPda(mint, quoteMint, LAUNCHLAB_PROGRAM_ID);
  const info = await connection.getAccountInfo(address);
  if (!info || !info.owner.equals(LAUNCHLAB_PROGRAM_ID)) return null;
  const state = decodeLaunchLabPool(info.data);
  if (!state.baseMint.equals(mint) || !state.quoteMint.equals(quoteMint)) return null;
  const status = STATUS[state.status] ?? "migrating";
  if (status === "graduated") {
    const cpmm = await readCpmm(state);
    const priceQuote =
      cpmm && cpmm.vault0 > 0n && cpmm.vault1 > 0n
        ? q64ToPrice(cpmmPriceQ64(cpmm.pool, cpmm.vault0, cpmm.vault1, mint), state.baseDecimals, state.quoteDecimals)
        : null;
    return { address, state, status, progress: 1, priceQuote, cpmm };
  }
  const progress =
    status === "curve" && state.totalQuoteFundRaising > 0n
      ? Math.min(Number(state.realQuote) / Number(state.totalQuoteFundRaising), 1)
      : 1;
  return {
    address,
    state,
    status,
    progress,
    priceQuote: q64ToPrice(curvePriceQ64(state), state.baseDecimals, state.quoteDecimals),
    cpmm: null,
  };
}

/** Market cap in quote base units: price × supply. */
export function marketCapQuote(market: Market, supply: bigint): bigint | null {
  if (market.priceQuote === null) return null;
  const perRawCoin = market.priceQuote * 10 ** (market.state.quoteDecimals - market.state.baseDecimals);
  return BigInt(Math.round(perRawCoin * Number(supply)));
}

/**
 * Remaining accounts the program prices a lock against: none while the coin is
 * on its curve (the program reads the pinned PoolState), the CPMM pool state
 * and its coin and quote vaults once migrated.
 */
export function valuationAccounts(market: Market | null): PublicKey[] {
  if (!market?.cpmm) return [];
  const { address, pool } = market.cpmm;
  const coinIs0 = pool.token0Mint.equals(market.state.baseMint);
  return coinIs0 ? [address, pool.token0Vault, pool.token1Vault] : [address, pool.token1Vault, pool.token0Vault];
}

// --- reward vault ---------------------------------------------------------

/**
 * Reward balance that has arrived since the pool last synced: collected
 * trading fees, donations sent straight to the vault, anything a `sync` would
 * fold in. Native SOL above the vault's rent reserve for a SOL-paired pool;
 * the reward token account's balance otherwise. Zero before the pool is
 * founded, when `sync` does nothing.
 */
export async function unsyncedRewards(pool: PoolAccount): Promise<bigint> {
  if (!pool.founded) return 0n;
  let balance: bigint;
  if (isNative(pool.quoteMint)) {
    const lamports = BigInt(await connection.getBalance(pool.rewardVault, "confirmed"));
    balance = lamports > pool.vaultReserve ? lamports - pool.vaultReserve : 0n;
  } else {
    const info = await connection.getAccountInfo(pool.rewardTokenAccount, "confirmed");
    balance = tokenAmount(info?.data) ?? 0n;
  }
  return balance > pool.lastVaultBalance ? balance - pool.lastVaultBalance : 0n;
}

/**
 * The pool's trading fee earned on Raydium but not yet pulled into the vault:
 * the LaunchLab creator-fee vault of (reward vault, quote) — the vault PDA is
 * the LaunchLab "creator" — plus, once migrated, the CPMM pool's creator fees
 * on the quote side (gross: CPMM keeps a protocol share of those when they are
 * collected). `collect_creator_fee` moves both into the vault and syncs.
 */
export async function uncollectedFees(pool: PoolAccount, market: Market | null): Promise<bigint> {
  const feeVault = creatorFeeVaultPda(pool.rewardVault, pool.quoteMint, LAUNCHLAB_PROGRAM_ID);
  const info = await connection.getAccountInfo(feeVault, "confirmed");
  let total = tokenAmount(info?.data) ?? 0n;
  if (market?.cpmm) {
    const { pool: cpmm } = market.cpmm;
    total += cpmm.token0Mint.equals(pool.quoteMint) ? cpmm.creatorFeesToken0 : cpmm.creatorFeesToken1;
  }
  return total;
}

/**
 * `collect_creator_fee` for a pool: pulls its trading fee out of LaunchLab
 * (and CPMM after graduation) into the reward vault, then syncs inline.
 * Permissionless; `payer` funds any token account it creates.
 */
export async function collectFeesInstructions(payer: PublicKey, pool: PoolAccount, market: Market | null) {
  return imagine.collectCreatorFee({
    payer,
    mint: pool.mint,
    quote: { mint: pool.quoteMint, tokenProgram: pool.quoteTokenProgram },
    graduated: market?.cpmm ? { ammConfig: market.cpmm.pool.ammConfig } : undefined,
  });
}

// --- SOL wrapping ---------------------------------------------------------

/** Native SOL into the owner's WSOL account (created if missing), ready to spend. */
function wrapSol(owner: PublicKey, lamports: bigint): TransactionInstruction[] {
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, owner, true);
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, NATIVE_MINT),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports }),
    createSyncNativeInstruction(ata),
  ];
}

/** Close the owner's WSOL account: its balance and rent return as native SOL. */
function unwrapSol(owner: PublicKey): TransactionInstruction {
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, owner, true);
  return createCloseAccountInstruction(ata, owner, owner);
}

const minusSlippage = (amount: bigint, slippageBps: number) => (amount * BigInt(10_000 - slippageBps)) / 10_000n;

// --- app fee --------------------------------------------------------------

/**
 * The IMAGINE app fee, as an instruction appended to a trade: `trade_fee_bps`
 * of the trade's quote leg, deposited into the coin's own pool in the quote
 * asset. The fee a trader pays is exactly the money that coin's lockers are
 * paid, and it settles atomically with the trade: if the trade fails, no fee
 * is taken.
 */
export async function appFeeInstruction(params: {
  payer: PublicKey;
  mint: PublicKey;
  quote: QuoteRef;
  quoteLeg: bigint;
  side: "buy" | "sell";
}): Promise<{ instruction: TransactionInstruction; amount: bigint; bps: number } | null> {
  const { tradeFeeBps } = await chainConfig();
  const amount = appFeeAmount(params.quoteLeg, tradeFeeBps);
  if (amount <= 0n) return null;
  const instruction = await imagine.depositReward({
    payer: params.payer,
    mint: params.mint,
    quote: params.quote,
    amount,
    kind: params.side === "buy" ? FeeKind.Buy : FeeKind.Sell,
  });
  return { instruction, amount, bps: tradeFeeBps };
}

// --- trades ---------------------------------------------------------------

export interface TradeRequest {
  user: PublicKey;
  mint: PublicKey;
  side: "buy" | "sell";
  /** Buy: quote base units in (lamports with `payWithSol`). Sell: coin base units in. */
  amount: bigint;
  slippageBps: number;
  /** Buy only: pay in SOL on a coin paired with something else (Jupiter SOL → quote first). */
  payWithSol: boolean;
  priorityFeeMicroLamports: number;
}

export interface BuiltTrade {
  instructions: TransactionInstruction[];
  /** Empty when it fits as a legacy transaction. */
  lookupTables: AddressLookupTableAccount[];
  meta: Record<string, string | number>;
}

/** Account budgets for Jupiter's route, tried in turn until route + buy + fee fit one packet. */
const JUPITER_ACCOUNT_BUDGETS = [24, 18, 12];

/**
 * A trade on an IMAGINE coin with the app fee attached: LaunchLab
 * `buy_exact_in` / `sell_exact_in` while on the curve, CPMM `swap_base_input`
 * once migrated, then `deposit_reward` of the fee in the quote asset.
 *
 * Buys net the fee out of the stated budget first, so the budget is exactly
 * what leaves the wallet; sells charge it on the quote that comes back.
 */
export async function buildTrade(request: TradeRequest): Promise<BuiltTrade> {
  const { user, mint, side, amount, slippageBps } = request;
  const pool = await imagine.fetchPool(mint);
  if (!pool || !pool.founded) throw new ActionError(404, "this coin has no IMAGINE pool");
  const quoteMint = pool.quoteMint;
  const native = isNative(quoteMint);
  const quoteRef: QuoteRef = { mint: quoteMint, tokenProgram: pool.quoteTokenProgram };
  const market = await readMarket(mint, quoteMint);
  if (!market) throw new ActionError(404, "this coin's LaunchLab pool was not found");
  if (market.status === "migrating") {
    throw new ActionError(409, "this coin filled its curve and is migrating to Raydium; trading resumes once it lands");
  }
  if (market.status === "graduated" && !market.cpmm) {
    throw new ActionError(409, "this coin graduated but its Raydium pool is not readable yet; try again shortly");
  }
  const quote = await quoteDisplay(quoteMint.toBase58());
  const { tradeFeeBps } = await chainConfig();
  const coinAta = getAssociatedTokenAddressSync(mint, user, true, TOKEN_2022_PROGRAM_ID);
  const quoteAta = getAssociatedTokenAddressSync(quoteMint, user, true, pool.quoteTokenProgram);
  const rates = market.status === "curve" ? await feeRates(market.state) : null;
  const venue = market.status === "curve" ? "curve" : "cpmm";

  /** Coin out for `quoteIn`, or quote out for `coinIn`, at the venue's current state. */
  const venueQuote = (input: bigint): bigint => {
    if (market.cpmm) {
      const { pool: cpmm, vault0, vault1, config } = market.cpmm;
      const inputMint = side === "buy" ? quoteMint : mint;
      return cpmmSwapBaseInput(cpmmSwapSide(cpmm, vault0, vault1, inputMint, config), input, config).amountOut;
    }
    return side === "buy" ? buyExactIn(market.state, input, rates!).base : sellExactIn(market.state, input, rates!).quote;
  };
  const venueIx = (input: bigint, minOut: bigint): TransactionInstruction =>
    market.cpmm
      ? cpmmSwapIx({
          programId: CPMM_PROGRAM_ID,
          kind: "swapBaseInput",
          pool: { ...market.cpmm.pool, address: market.cpmm.address },
          payer: user,
          inputMint: side === "buy" ? quoteMint : mint,
          amount: input,
          limit: minOut,
        })
      : launchLabTradeIx({
          programId: LAUNCHLAB_PROGRAM_ID,
          kind: side === "buy" ? "buyExactIn" : "sellExactIn",
          pool: { ...market.state, address: market.address },
          payer: user,
          amount: input,
          limit: minOut,
        });

  const instructions: TransactionInstruction[] = [];
  const candidateTables: AddressLookupTableAccount[] = [];
  const launchTable = await launchLookupTable();
  if (launchTable) candidateTables.push(launchTable);

  /** The buy after the quote is in hand: venue buy of `budget` less the fee, then the fee. */
  const buyTail = async (budget: bigint) => {
    const fee = appFeeAmount(budget, tradeFeeBps);
    const toVenue = budget - fee;
    if (toVenue <= 0n) throw new ActionError(400, "amount too small");
    const expectedOut = venueQuote(toVenue);
    if (expectedOut <= 0n) throw new ActionError(400, "amount too small to buy anything");
    const ixs = [createAssociatedTokenAccountIdempotentInstruction(user, coinAta, user, mint, TOKEN_2022_PROGRAM_ID)];
    if (native) ixs.push(...wrapSol(user, toVenue));
    ixs.push(venueIx(toVenue, minusSlippage(expectedOut, slippageBps)));
    if (native) ixs.push(unwrapSol(user));
    const feeIx = await appFeeInstruction({ payer: user, mint, quote: quoteRef, quoteLeg: budget, side });
    if (feeIx) ixs.push(feeIx.instruction);
    return {
      instructions: ixs,
      meta: {
        appFee: (feeIx?.amount ?? 0n).toString(),
        appFeeBps: feeIx?.bps ?? 0,
        quoteLeg: toVenue.toString(),
        expectedOut: expectedOut.toString(),
      },
    };
  };

  if (side === "buy" && request.payWithSol && !native) {
    // Jupiter's route shares the packet with the buy and the fee: ask for
    // progressively tighter routes until one fits.
    for (const [attempt, maxAccounts] of JUPITER_ACCOUNT_BUDGETS.entries()) {
      let swap;
      try {
        swap = await swapSolToQuote({ user, quoteMint, lamportsIn: amount, slippageBps, maxAccounts });
      } catch (error) {
        // A tighter budget can run out of routes; that ends the search.
        if (attempt > 0) break;
        throw new ActionError(502, `could not route SOL into ${quote.symbol} right now: ${(error as Error).message}`);
      }
      const tail = await buyTail(swap.minOutAmount);
      const all = [...budgetInstructions(request.priorityFeeMicroLamports, 700_000), ...swap.instructions, ...tail.instructions];
      try {
        const lookupTables = tablesFor(all, user, [...candidateTables, ...swap.lookupTables]);
        return { instructions: all, lookupTables, meta: { venue, solIn: amount.toString(), ...tail.meta } };
      } catch {
        // too large; try a tighter route
      }
    }
    throw new ActionError(
      409,
      `no SOL route into ${quote.symbol} fits in one transaction with the buy; swap to ${quote.symbol} first, then buy with ${quote.symbol}`,
    );
  }

  let meta: Record<string, string | number>;
  if (side === "buy") {
    const tail = await buyTail(amount);
    instructions.push(...tail.instructions);
    meta = { venue, ...tail.meta };
  } else {
    const expectedOut = venueQuote(amount);
    if (expectedOut <= 0n) throw new ActionError(400, "amount too small to sell");
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(user, quoteAta, user, quoteMint, pool.quoteTokenProgram));
    instructions.push(venueIx(amount, minusSlippage(expectedOut, slippageBps)));
    // The fee is paid from what the sell returned: native SOL once unwrapped.
    if (native) instructions.push(unwrapSol(user));
    const feeIx = await appFeeInstruction({ payer: user, mint, quote: quoteRef, quoteLeg: expectedOut, side });
    if (feeIx) instructions.push(feeIx.instruction);
    meta = {
      venue,
      appFee: (feeIx?.amount ?? 0n).toString(),
      appFeeBps: feeIx?.bps ?? 0,
      quoteLeg: expectedOut.toString(),
      expectedOut: expectedOut.toString(),
    };
  }

  const all = [...budgetInstructions(request.priorityFeeMicroLamports, 300_000), ...instructions];
  try {
    return { instructions: all, lookupTables: tablesFor(all, user, candidateTables), meta };
  } catch {
    throw new ActionError(409, "this trade does not fit in one transaction");
  }
}

// --- launch ---------------------------------------------------------------

export interface LaunchRequest {
  creator: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  quoteMint: PublicKey;
  /** Quote base units (lamports with `payWithSol`). */
  devBuy: bigint;
  payWithSol: boolean;
  /** Share of the dev buy the creator locks, 10–100%. */
  lockPercent: number;
  lockDurationSecs: number;
  slippageBps: number;
  priorityFeeMicroLamports: number;
}

/** One transaction of a launch, in the order it must land. */
export interface LaunchStep {
  label: string;
  instructions: TransactionInstruction[];
  /** Empty: a legacy transaction. Else compile v0 through these. */
  lookupTables: AddressLookupTableAccount[];
  /** The mint keypair co-signs this step (it creates the mint). */
  mintSigns: boolean;
}

export interface LaunchPlan {
  mint: string;
  pool: string;
  quote: QuoteDisplay;
  expectedTokens: string;
  lockAmount: string;
  steps: LaunchStep[];
}

/** Compute for imagine.launch (LaunchLab initialize CPI) + dev buy + found, with headroom. */
const LAUNCH_UNITS = 1_000_000;
const STEP_UNITS = 500_000;

/**
 * Nobody but IMAGINE launches a coin called IMAGINE: fakes would use the site
 * to pass as the official coin. Catches the ticker inside a longer one and
 * common letter swaps (1/l/|/! for i, 0 for o, a leading $).
 */
function impersonatesImagine(name: string, symbol: string): boolean {
  const fold = (text: string) =>
    text.toLowerCase().replace(/[1l|!]/g, "i").replace(/0/g, "o").replace(/[^a-z]/g, "");
  return fold(symbol).includes("imagine") || name.split(/\s+/).some((word) => fold(word).startsWith("imagine"));
}

/**
 * A launch, as the ordered transactions the creator signs back to back.
 *
 * Normally one v0 transaction through the `LAUNCH_ALT` table:
 *   1. `imagine.launch` — opens the pool and CPIs LaunchLab
 *      `initialize_with_token_2022` under the IMAGINE platform config, with
 *      the pool's reward vault as the LaunchLab creator, so the platform's
 *      on-chain trading fee accrues to the pool;
 *   2. LaunchLab `buy_exact_in` — the creator's dev buy, priced exactly on the
 *      fresh curve: nothing can trade between create and buy;
 *   3. `imagine.found` — the creator's founding lock opens position 0.
 * Paying in SOL for a coin paired with something else puts a Jupiter
 * SOL → quote swap first, as its own transaction. Without the table the
 * launch is split in two (create; buy + found).
 *
 * Re-requesting a mint whose launch stopped partway (the pool exists, not yet
 * founded) returns only what is left: the dev buy if it is missing, and
 * `found`.
 */
export async function buildLaunch(request: LaunchRequest): Promise<LaunchPlan> {
  const { creator, mint, quoteMint, slippageBps } = request;
  const mintKey = mint.toBase58();
  const native = isNative(quoteMint);
  if (request.devBuy <= 0n) {
    throw new ActionError(400, "a launch needs a dev buy: the creator must lock coins to open the pool");
  }
  if (impersonatesImagine(request.name, request.symbol)) {
    throw new ActionError(403, "the IMAGINE name and ticker are reserved for the official $IMAGINE coin");
  }

  // The metadata must be the document hosted here for this mint, whose
  // website is the coin's IMAGINE page (routes/metadata.ts).
  const [files] = await sql`SELECT name, symbol FROM coin_files WHERE mint = ${mintKey}`;
  if (!files || request.uri !== metadataUri(mintKey)) {
    throw new ActionError(400, "upload the coin's image and details through imagine.fun for this mint before launching");
  }
  if (files.name !== request.name || files.symbol !== request.symbol) {
    throw new ActionError(400, "the name and ticker must match the uploaded metadata");
  }

  const launchable = await launchableQuotes();
  if (!launchable.some((quote) => quote.mint === quoteMint.toBase58())) {
    throw new ActionError(400, "this pair can't be launched right now: it has no LaunchLab config or no USD price");
  }
  const quote = await quoteDisplay(quoteMint.toBase58());
  const [config, chain, curveParams, existing] = await Promise.all([
    imagine.fetchConfig(),
    chainConfig(),
    launchCurve(quoteMint),
    imagine.fetchPool(mint),
  ]);
  if (!config) throw new Error("IMAGINE config is not initialised on this cluster; run scripts/init-config.ts");
  const platform = await platformConfig(chain.launchlabPlatform);
  if (existing?.founded) throw new ActionError(409, "this coin is already launched on IMAGINE");
  if (existing && !existing.creator.equals(creator)) {
    throw new ActionError(403, "only the wallet that launched this coin can finish its launch");
  }
  if (request.lockDurationSecs < config.defaultMinLockSecs || request.lockDurationSecs > config.defaultMaxLockSecs) {
    throw new ActionError(400, "the founding lock's term is outside the allowed window");
  }

  const steps: LaunchStep[] = [];
  // Paying in SOL for a non-SOL pair: Jupiter first, and the buy spends what
  // the swap guarantees. A resumed launch spends the quote the wallet already
  // holds (an earlier run's swap landed and left it there).
  let quoteIn = request.devBuy;
  if (request.payWithSol && !native) {
    if (existing) {
      const quoteAta = getAssociatedTokenAddressSync(quoteMint, creator, true, new PublicKey(quote.tokenProgram));
      quoteIn = await connection
        .getTokenAccountBalance(quoteAta, "confirmed")
        .then((balance) => BigInt(balance.value.amount))
        .catch(() => 0n);
    } else {
      const swap = await swapSolToQuote({ user: creator, quoteMint, lamportsIn: request.devBuy, slippageBps }).catch(
        (error: unknown) => {
          throw new ActionError(502, `could not route SOL into ${quote.symbol} right now: ${(error as Error).message}`);
        },
      );
      const instructions = [...budgetInstructions(request.priorityFeeMicroLamports, 600_000), ...swap.instructions];
      steps.push({
        label: `Swap SOL for ${quote.symbol}`,
        instructions,
        lookupTables: fits(instructions, creator) ? [] : swap.lookupTables,
        mintSigns: false,
      });
      quoteIn = swap.minOutAmount;
    }
  }

  const launchlabPool = launchLabPoolPda(mint, quoteMint, LAUNCHLAB_PROGRAM_ID);
  const poolRef = {
    address: launchlabPool,
    globalConfig: curveParams.globalConfig,
    platformConfig: chain.launchlabPlatform,
    baseMint: mint,
    quoteMint,
    baseVault: launchLabPoolVaultPda(launchlabPool, mint, LAUNCHLAB_PROGRAM_ID),
    quoteVault: launchLabPoolVaultPda(launchlabPool, quoteMint, LAUNCHLAB_PROGRAM_ID),
    creator: rewardVaultPda(mint),
    baseTokenProgram: TOKEN_2022_PROGRAM_ID,
    quoteTokenProgram: new PublicKey(quote.tokenProgram),
  };
  const coinAta = getAssociatedTokenAddressSync(mint, creator, true, TOKEN_2022_PROGRAM_ID);
  const buyInstructions = (minOut: bigint): TransactionInstruction[] => [
    createAssociatedTokenAccountIdempotentInstruction(creator, coinAta, creator, mint, TOKEN_2022_PROGRAM_ID),
    ...(native ? wrapSol(creator, quoteIn) : []),
    launchLabTradeIx({
      programId: LAUNCHLAB_PROGRAM_ID,
      kind: "buyExactIn",
      pool: poolRef,
      payer: creator,
      amount: quoteIn,
      limit: minOut,
    }),
    ...(native ? [unwrapSol(creator)] : []),
  ];
  const assertLock = (lockAmount: bigint) => {
    if (lockAmount < config.defaultMinLockAmount) {
      throw new ActionError(
        409,
        `a founding lock of ${formatTokenAmount(lockAmount, curveParams.baseDecimals)} is below the pool minimum of ${formatTokenAmount(config.defaultMinLockAmount, curveParams.baseDecimals)}; buy more or lock a larger share`,
      );
    }
  };
  const table = await launchLookupTable();

  if (!existing) {
    if (await connection.getAccountInfo(mint)) {
      throw new ActionError(409, "this mint address is already taken; start a new launch");
    }
    // Priced on the curve `launch` is about to create: nothing else can trade
    // it before this buy, so the quote is exact; the limit is only a guard.
    const rates = await feeRates({ globalConfig: curveParams.globalConfig, platformConfig: chain.launchlabPlatform });
    const curve = freshCurve({ supply: curveParams.supply, totalBaseSell: curveParams.totalSell, totalQuoteFundRaising: curveParams.fundRaising });
    const fill = buyExactIn(curve, quoteIn, rates);
    const minOut = minusSlippage(fill.base, slippageBps);
    const lockAmount = (minOut * BigInt(request.lockPercent)) / 100n;
    assertLock(lockAmount);
    const launchIx = await imagine.launch({
      creator,
      mint,
      quote: { mint: quoteMint, tokenProgram: poolRef.quoteTokenProgram },
      treasury: chain.treasury,
      name: request.name,
      symbol: request.symbol,
      uri: request.uri,
      supply: curveParams.supply,
      totalSell: curveParams.totalSell,
      fundRaising: curveParams.fundRaising,
      creatorShareBps: 0,
      globalConfig: curveParams.globalConfig,
      platform: chain.launchlabPlatform,
      restricted: platform.restrictGlobalConfig !== 0 || platform.restrictCurveParam !== 0,
    });
    const foundIx = await imagine.found({
      creator,
      mint,
      quoteMint,
      initialLockAmount: lockAmount,
      initialLockDuration: request.lockDurationSecs,
    });
    const atomic = [
      ...budgetInstructions(request.priorityFeeMicroLamports, LAUNCH_UNITS),
      launchIx,
      ...buyInstructions(minOut),
      foundIx,
    ];
    if (table && fits(atomic, creator, [table])) {
      steps.push({ label: "Launch on Raydium, buy the first bag and lock it", instructions: atomic, lookupTables: [table], mintSigns: true });
    } else {
      console.warn("launch: launch + dev buy + found does not fit one transaction; set LAUNCH_ALT (scripts/create-alt.ts). Splitting the launch");
      const create = [...budgetInstructions(request.priorityFeeMicroLamports, STEP_UNITS), launchIx];
      const rest = [...budgetInstructions(request.priorityFeeMicroLamports, STEP_UNITS), ...buyInstructions(minOut), foundIx];
      steps.push({ label: "Launch the coin on Raydium", instructions: create, lookupTables: tablesFor(create, creator, table ? [table] : []), mintSigns: true });
      steps.push({ label: "Buy the first bag and lock it", instructions: rest, lookupTables: tablesFor(rest, creator, table ? [table] : []), mintSigns: false });
    }
    return {
      mint: mintKey,
      pool: poolPda(mint).toBase58(),
      quote,
      expectedTokens: fill.base.toString(),
      lockAmount: lockAmount.toString(),
      steps,
    };
  }

  // Resume: the pool and its LaunchLab curve exist; the founding lock does not.
  const market = await readMarket(mint, quoteMint);
  if (!market) throw new ActionError(409, "this coin's LaunchLab pool was not found");
  const held = await connection
    .getTokenAccountBalance(coinAta, "confirmed")
    .then((balance) => BigInt(balance.value.amount))
    .catch(() => 0n);
  const instructions = [...budgetInstructions(request.priorityFeeMicroLamports, STEP_UNITS)];
  let lockBasis = held;
  let expected = held;
  if (market.status === "curve") {
    const fill = buyExactIn(market.state, quoteIn, await feeRates(market.state));
    // The dev buy counts as landed only once the wallet holds most of what it
    // would buy now: anyone can send the creator a few units, and that must
    // not stand in for the founding bag.
    if (held * 10n < fill.base * 9n) {
      const minOut = minusSlippage(fill.base, slippageBps);
      instructions.push(...buyInstructions(minOut));
      lockBasis = held + minOut;
      expected = held + fill.base;
    }
  }
  const lockAmount = (lockBasis * BigInt(request.lockPercent)) / 100n;
  assertLock(lockAmount);
  instructions.push(
    await imagine.found({
      creator,
      mint,
      quoteMint,
      initialLockAmount: lockAmount,
      initialLockDuration: request.lockDurationSecs,
      valuation: valuationAccounts(market),
    }),
  );
  steps.push({
    label: instructions.length > 3 ? "Buy the first bag and lock it" : "Lock your founding bag",
    instructions,
    lookupTables: tablesFor(instructions, creator, table ? [table] : []),
    mintSigns: false,
  });
  return {
    mint: mintKey,
    pool: poolPda(mint).toBase58(),
    quote,
    expectedTokens: expected.toString(),
    lockAmount: lockAmount.toString(),
    steps,
  };
}
