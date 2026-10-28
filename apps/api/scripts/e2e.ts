/**
 * End-to-end run against the mainnet fork (scripts/mainnet-fork.sh) through
 * the API, for a SOL-paired and an SPYx-paired coin, in the order a user goes:
 *
 *   1. upload the coin's image and details (/api/metadata), read them back
 *      from /files/*;
 *   2. launch on Raydium LaunchLab under the IMAGINE platform: imagine.launch
 *      + LaunchLab dev buy + imagine.found (/api/tx/launch), signed by the
 *      creator and the mint;
 *   3. a trader buys on imagine.fun — the app fee (config trade_fee_bps) goes
 *      straight into the pool — then sells part;
 *   4. a direct LaunchLab buy, as Raydium's own UI or any bot would send it:
 *      no app fee, but the platform's on-chain trading fee (0.5%) accrues to
 *      the pool in LaunchLab's creator-fee vault (the vault PDA is the
 *      LaunchLab "creator");
 *   5. the trader locks;
 *   6. `collect_creator_fee` (the API's sync action) pulls those fees into the
 *      vault and syncs them into the lockers' stream;
 *   7. both lockers claim real quote; the trader breaks their lock early.
 *
 * Every API transaction is signed here, exactly as a wallet would. Needs the
 * API running against the fork with a database, the IMAGINE program deployed
 * there, the IMAGINE platform created (scripts/setup-platform.ts) and the
 * config pointing at it (scripts/init-config.ts).
 *
 *   API_URL=http://localhost:8080 RPC_URL=http://127.0.0.1:8999 node scripts/e2e.ts [sol|spyx]
 */
import { setTimeout as sleep } from "node:timers/promises";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  buyExactIn,
  creatorFeeVaultPda,
  curveFeeRates,
  decodeGlobalConfig,
  decodeLaunchLabPool,
  decodePlatformConfig,
  ECONOMICS,
  ImagineClient,
  LAUNCHLAB_PROGRAM_ID,
  launchLabPoolPda,
  launchLabTradeIx,
  rewardVaultPda,
} from "@imagine/sdk";
import { forkWallet, SPYX_MINT } from "./fork-fixtures.ts";

const API = (process.env.API_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const connection = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8999", "confirmed");
const imagine = new ImagineClient(connection);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
const step = (title: string) => console.log(`\n${title}`);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, init);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Sign an API-built transaction with `signers`, send it, and wait for confirmation. */
async function signAndSend(base64: string, signers: Keypair[], label: string): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  tx.sign(signers);
  const latest = await connection.getLatestBlockhash("confirmed");
  try {
    const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
    const result = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (result.value.err) throw new Error(`failed on chain: ${JSON.stringify(result.value.err)}`);
    console.log(`       ${label}: ${signature}`);
    return signature;
  } catch (error) {
    const logs = (error as { logs?: string[] }).logs;
    console.error(`\n${label} failed: ${(error as Error).message}`);
    if (logs) console.error(logs.join("\n"));
    throw error;
  }
}

async function action(owner: Keypair, body: Record<string, unknown>, label: string) {
  const built = await post<Record<string, string | number> & { transaction: string }>("/api/tx/action", {
    owner: owner.publicKey.toBase58(),
    ...body,
  });
  const signature = await signAndSend(built.transaction, [owner], label);
  return { signature, meta: built };
}

async function airdrop(to: PublicKey, sol: number) {
  const signature = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
}

/** Balance of a token account by address; 0 when it does not exist. */
async function tokenBalanceOf(account: PublicKey): Promise<bigint> {
  return connection
    .getTokenAccountBalance(account, "confirmed")
    .then((b) => BigInt(b.value.amount))
    .catch(() => 0n);
}

async function tokenBalance(mint: PublicKey, owner: PublicKey, program: PublicKey): Promise<bigint> {
  return tokenBalanceOf(getAssociatedTokenAddressSync(mint, owner, true, program));
}

/** What a wallet holds of a quote: native lamports for SOL, else its token balance. */
async function quoteBalance(quote: PublicKey, program: PublicKey, owner: PublicKey): Promise<bigint> {
  return quote.equals(NATIVE_MINT)
    ? BigInt(await connection.getBalance(owner, "confirmed"))
    : tokenBalance(quote, owner, program);
}

/** The smallest valid PNG (1×1, transparent). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

interface QuoteRow {
  mint: string;
  symbol: string;
  decimals: number;
  tokenProgram: string;
}

async function run(label: "sol" | "spyx", creator: Keypair, trader: Keypair) {
  const quoteMint = label === "sol" ? NATIVE_MINT : SPYX_MINT;
  const quotes = await api<QuoteRow[]>("/api/quotes");
  const quote = quotes.find((q) => q.mint === quoteMint.toBase58());
  check(`${label}: /api/quotes lists the pair`, Boolean(quote), `${quotes.length} launchable quotes`);
  if (!quote) return;
  const quoteProgram = new PublicKey(quote.tokenProgram);
  const one = 10n ** BigInt(quote.decimals);
  const native = quoteMint.equals(NATIVE_MINT);

  step(`[${label}] 1. metadata`);
  const mint = Keypair.generate();
  const symbol = label === "sol" ? "DREAM" : "DRMSPY";
  const form = new FormData();
  form.append("mint", mint.publicKey.toBase58());
  form.append("name", `Dream ${label.toUpperCase()}`);
  form.append("symbol", symbol);
  form.append("description", `End-to-end test coin paired with ${quote.symbol}`);
  form.append("file", new Blob([PNG_1X1], { type: "image/png" }), "coin.png");
  const uploaded = await api<{ uri: string; image: string }>("/api/metadata", { method: "POST", body: form });
  const doc = (await (await fetch(uploaded.uri)).json()) as { name: string; image: string; website: string };
  const image = Buffer.from(await (await fetch(uploaded.image)).arrayBuffer());
  check("metadata JSON is served", doc.name === `Dream ${label.toUpperCase()}`, uploaded.uri);
  check("its website is the coin's IMAGINE page", doc.website === `https://imagine.fun/coins/${mint.publicKey.toBase58()}`);
  check("image round-trips byte for byte", image.equals(PNG_1X1), uploaded.image);

  step(`[${label}] 2. launch on Raydium LaunchLab (IMAGINE platform)`);
  const config = await imagine.fetchConfig();
  if (!config) throw new Error("config not initialised; run scripts/init-config.ts");
  const devBuy = native ? LAMPORTS_PER_SOL / 2 : Number(one / 20n);
  const launch = await post<{
    pool: string;
    lockAmount: string;
    expectedTokens: string;
    transactions: Array<{ label: string; transaction: string; mintSigns: boolean }>;
  }>("/api/tx/launch", {
    creator: creator.publicKey.toBase58(),
    mint: mint.publicKey.toBase58(),
    name: `Dream ${label.toUpperCase()}`,
    symbol,
    uri: uploaded.uri,
    quoteMint: quoteMint.toBase58(),
    devBuy: String(devBuy),
    lockPercent: 50,
    lockDurationSecs: config.defaultMaxLockSecs,
  });
  check("launch fits in one transaction", launch.transactions.length === 1, `${launch.transactions.length} step(s)`);
  for (const tx of launch.transactions) {
    await signAndSend(tx.transaction, tx.mintSigns ? [creator, mint] : [creator], tx.label);
  }
  const pool = await imagine.fetchPool(mint.publicKey);
  check("pool is founded", pool?.founded === true);
  check("pool is paid in the pair asset", pool?.quoteMint.equals(quoteMint) === true, pool?.quoteMint.toBase58());
  const llInfo = await connection.getAccountInfo(launchLabPoolPda(mint.publicKey, quoteMint));
  const ll = llInfo ? decodeLaunchLabPool(llInfo.data) : null;
  check("LaunchLab pool is under the IMAGINE platform", ll?.platformConfig.equals(config.launchlabPlatform) === true, config.launchlabPlatform.toBase58());
  check(
    "LaunchLab creator is the pool's reward vault",
    ll?.creator.equals(rewardVaultPda(mint.publicKey)) === true,
    ll?.creator.toBase58(),
  );
  const founding = await imagine.fetchPosition(mint.publicKey, creator.publicKey, 0);
  check("founding lock opened position 0", founding?.amount === BigInt(launch.lockAmount), `${founding?.amount} locked`);
  if (!pool || !founding) return;

  const detail = await api<{ quote: { mint: string }; curve: { status: string } | null; links: { raydium: string } }>(
    `/api/pools/${mint.publicKey.toBase58()}`,
  );
  check("/api/pools/:mint reads the curve", detail.curve?.status === "curve", detail.links.raydium);

  step(`[${label}] 3. trade on imagine.fun (app fee into the pool)`);
  const inflowBefore = pool.lifetimeInflow;
  const buyAmount = native ? LAMPORTS_PER_SOL / 5 : Number(one / 50n);
  const buy = await action(trader, { kind: "swap", mint: mint.publicKey.toBase58(), side: "buy", amount: String(buyAmount) }, "buy");
  const fee = BigInt(buy.meta.appFee as string);
  check(`app fee is ${config.tradeFeeBps / 100}% of the buy`, fee === (BigInt(buyAmount) * BigInt(config.tradeFeeBps)) / 10_000n, `${fee} of ${buyAmount}`);
  const afterBuy = await imagine.fetchPool(mint.publicKey);
  check("fee reached the pool", afterBuy !== null && afterBuy.lifetimeInflow - inflowBefore === fee, `inflow +${afterBuy && afterBuy.lifetimeInflow - inflowBefore}`);
  const held = await tokenBalance(mint.publicKey, trader.publicKey, TOKEN_2022_PROGRAM_ID);
  check("trader received coins", held > 0n, `${held}`);
  const sell = await action(trader, { kind: "swap", mint: mint.publicKey.toBase58(), side: "sell", amount: String(held / 4n) }, "sell");
  check("sell paid an app fee too", BigInt(sell.meta.appFee as string) > 0n, `${sell.meta.appFee}`);

  step(`[${label}] 4. a direct LaunchLab buy (no app fee; the pool's on-chain trading fee only)`);
  const feeVault = creatorFeeVaultPda(pool.rewardVault, quoteMint, LAUNCHLAB_PROGRAM_ID);
  const uncollectedBefore = await tokenBalanceOf(feeVault);
  const curveInfo = await connection.getAccountInfo(launchLabPoolPda(mint.publicKey, quoteMint));
  const curveState = decodeLaunchLabPool(curveInfo!.data);
  const [globalInfo, platformInfo] = await connection.getMultipleAccountsInfo([curveState.globalConfig, curveState.platformConfig]);
  const rates = curveFeeRates(decodeGlobalConfig(globalInfo!.data), decodePlatformConfig(platformInfo!.data));
  check("pool trading fee is 0.5% (LaunchLab creator_fee_rate 5,000)", rates.creator === 5_000n && rates.platform === 0n, `creator ${rates.creator}, platform ${rates.platform}`);
  const directAmount = native ? BigInt(LAMPORTS_PER_SOL / 10) : one / 100n;
  const fill = buyExactIn(curveState, directAmount, rates);
  const coinAta = getAssociatedTokenAddressSync(mint.publicKey, trader.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey, true);
  const directTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    createAssociatedTokenAccountIdempotentInstruction(trader.publicKey, coinAta, trader.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    ...(native
      ? [
          createAssociatedTokenAccountIdempotentInstruction(trader.publicKey, wsolAta, trader.publicKey, NATIVE_MINT),
          SystemProgram.transfer({ fromPubkey: trader.publicKey, toPubkey: wsolAta, lamports: directAmount }),
          createSyncNativeInstruction(wsolAta),
        ]
      : []),
    launchLabTradeIx({
      programId: LAUNCHLAB_PROGRAM_ID,
      kind: "buyExactIn",
      pool: { ...curveState, address: launchLabPoolPda(mint.publicKey, quoteMint) },
      payer: trader.publicKey,
      amount: directAmount,
      limit: (fill.base * 97n) / 100n,
    }),
    ...(native ? [createCloseAccountInstruction(wsolAta, trader.publicKey, trader.publicKey)] : []),
  );
  const inflowBeforeDirect = (await imagine.fetchPool(mint.publicKey))!.lifetimeInflow;
  const directSig = await sendAndConfirmTransaction(connection, directTx, [trader], { commitment: "confirmed" });
  console.log(`       direct LaunchLab buy: ${directSig}`);
  const uncollectedAfter = await tokenBalanceOf(feeVault);
  const accrued = uncollectedAfter - uncollectedBefore;
  check(
    "direct buy paid the pool 0.5% on-chain",
    accrued === fill.split.creator,
    `+${accrued} in the LaunchLab fee vault (expected ${fill.split.creator} of ${directAmount})`,
  );
  check("direct buy took no app fee", (await imagine.fetchPool(mint.publicKey))!.lifetimeInflow === inflowBeforeDirect);

  step(`[${label}] 5. lock`);
  const lockAmount = await tokenBalance(mint.publicKey, trader.publicKey, TOKEN_2022_PROGRAM_ID);
  await action(
    trader,
    { kind: "lock", mint: mint.publicKey.toBase58(), index: 0, amount: String(lockAmount), durationSecs: config.defaultMinLockSecs },
    "lock",
  );
  const traderLock = await imagine.fetchPosition(mint.publicKey, trader.publicKey, 0);
  check("trader's lock is open", traderLock?.amount === lockAmount, `${traderLock?.amount}`);

  step(`[${label}] 6. collect_creator_fee + sync`);
  const toCollect = await tokenBalanceOf(feeVault);
  const beforeSync = await imagine.fetchPool(mint.publicKey);
  const collected = await action(trader, { kind: "sync", mint: mint.publicKey.toBase58() }, "collect_creator_fee");
  check("API saw the uncollected trading fees", BigInt(collected.meta.uncollected as string) === toCollect, `${collected.meta.uncollected}`);
  const afterSync = await imagine.fetchPool(mint.publicKey);
  const gained = afterSync && beforeSync ? afterSync.lifetimeInflow - beforeSync.lifetimeInflow : -1n;
  check(
    "collected fees joined the pool's inflow",
    gained === toCollect + BigInt(collected.meta.unsynced as string),
    `inflow +${gained} (dev buy + imagine.fun trades + direct buy, 0.5% each)`,
  );
  check("LaunchLab fee vault emptied", (await tokenBalanceOf(feeVault)) === 0n);

  step(`[${label}] 7. claim and break a lock`);
  await sleep(5_000); // let the stream release something
  for (const [who, wallet] of [
    ["creator", creator],
    ["trader", trader],
  ] as const) {
    const before = await quoteBalance(quoteMint, quoteProgram, wallet.publicKey);
    const claimed = await action(wallet, { kind: "claim", mint: mint.publicKey.toBase58(), index: 0 }, `${who} claim`);
    const position = await imagine.fetchPosition(mint.publicKey, wallet.publicKey, 0);
    const after = await quoteBalance(quoteMint, quoteProgram, wallet.publicKey);
    check(`${who} was paid in ${quote.symbol}`, (position?.claimed ?? 0n) > 0n, `claimed ${position?.claimed}, balance ${before} → ${after} (${claimed.signature})`);
  }
  await action(trader, { kind: "unlock", mint: mint.publicKey.toBase58(), index: 0, early: true }, "early unlock");
  check("trader's lock is closed", (await imagine.fetchPosition(mint.publicKey, trader.publicKey, 0)) === null);
  const final = await imagine.fetchPool(mint.publicKey);
  check("pool still holds the founding lock", final?.totalLocked === founding.amount, `${final?.totalLocked}`);
}

const which = process.argv[2];
const creator = forkWallet("creator");
const trader = forkWallet("trader");
console.log(`creator ${creator.publicKey.toBase58()}, trader ${trader.publicKey.toBase58()}`);
await airdrop(creator.publicKey, 20);
await airdrop(trader.publicKey, 20);
console.log(`economics: trade fee ${ECONOMICS.tradeFeeBps} bps, treasury ${ECONOMICS.treasuryShareBps} bps`);

for (const label of ["sol", "spyx"] as const) {
  if (which && which !== label) continue;
  try {
    await run(label, creator, trader);
  } catch (error) {
    failures += 1;
    console.error(`[${label}] aborted:`, error instanceof Error ? error.message : error);
  }
}

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
