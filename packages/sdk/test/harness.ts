import {
  ACCOUNT_SIZE,
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
  type AccountMeta,
} from "@solana/web3.js";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePool } from "../src/accounts.ts";
import { ImagineClient, type QuoteRef } from "../src/client.ts";
import { IMAGINE_PROGRAM_ID, metadataUri } from "../src/constants.ts";
import {
  CPMM_PROGRAM_ID,
  cpmmAuthorityPda,
  cpmmLpMintPda,
  cpmmObservationPda,
  cpmmPermissionPda,
  cpmmPoolPda,
  cpmmSupportMintPda,
  cpmmTokenOrder,
  cpmmVaultPda,
  decodeLaunchLabPool,
  launchLabAuthorityPda,
  launchLabPoolPda,
  launchLabTradeIx,
  LAUNCHLAB_PROGRAM_ID,
  imaginePlatformConfigIx,
  platformConfigPda,
  type LaunchLabPool,
  type LaunchLabPoolRef,
} from "../src/launchlab.ts";
import { distributableBalance } from "../src/math.ts";
import { poolPda, rewardVaultPda } from "../src/pda.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../..");
// LiteSVM executes SBPF v0; the deployable is built for v3. The build keeps the
// v0 build of the same source alongside it for this suite.
export const PROGRAM_SO = resolve(ROOT, "target/deploy/imagine-v0.so");
/**
 * Mainnet builds and accounts read over JSON-RPC (see tests/fixtures/raydium):
 * LaunchLab, CPMM, LP-Lock, Metaplex, Token-2022 (litesvm's bundled
 * Token-2022 predates the xStocks' ScaledUiAmount / Pausable extensions), the
 * WSOL and SPYx LaunchLab GlobalConfigs, Raydium's index-0 CPMM AmmConfig and
 * both quote mints. The IMAGINE PlatformConfig is created in each test through
 * the real `create_platform_config`.
 */
const FIXTURES = resolve(ROOT, "tests/fixtures/raydium");

export const PROGRAM_ID = IMAGINE_PROGRAM_ID;

/**
 * Raydium's index-0 CPMM AmmConfig (trade 0.25%, creator 0.05%): the
 * `cpswap_config` of the test platform, so graduated pools carry a creator fee.
 */
export const CPMM_AMM_CONFIG = new PublicKey("D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2");
/** Fixed admin of the test IMAGINE platform, so its address is a constant. */
export const PLATFORM_ADMIN = Keypair.fromSeed(Buffer.alloc(32, 7));
export const IMAGINE_PLATFORM = platformConfigPda(PLATFORM_ADMIN.publicKey);
export const DAY = 86_400;
export const TOKEN = 1_000_000n; // one whole coin at 6 decimals

export const LOCK_PROGRAM_ID = new PublicKey("LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE");
export const MPL_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
/** CPMM's hard-coded create-pool fee receiver (a WSOL token account). */
const CPMM_CREATE_POOL_FEE = new PublicKey("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** The upgradeable BPF loader, owner of every ProgramData account. */
export const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export const client = new ImagineClient(new Connection("http://127.0.0.1:8899"));

/** A LaunchLab quote the suite launches against. */
export interface Quote extends QuoteRef {
  symbol: string;
  decimals: number;
  globalConfig: PublicKey;
  /** One whole unit in base units. */
  unit: bigint;
}

export const WSOL: Quote = {
  symbol: "SOL",
  mint: NATIVE_MINT,
  tokenProgram: TOKEN_PROGRAM_ID,
  decimals: 9,
  globalConfig: new PublicKey("6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX"),
  unit: 1_000_000_000n,
};

export const SPYX: Quote = {
  symbol: "SPYx",
  mint: new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W"),
  tokenProgram: TOKEN_2022_PROGRAM_ID,
  decimals: 8,
  globalConfig: new PublicKey("B7ctMMdGvy46Am56myTtzfkNzt9kWZVTNGM2BWrJ9adg"),
  unit: 100_000_000n,
};

export const QUOTES_UNDER_TEST = [WSOL, SPYX] as const;

/** IMAGINE's curve shape: 1e15 supply, 79.31% sold on the curve. */
export const SUPPLY = 1_000_000_000_000_000n;
export const TOTAL_SELL = 793_100_000_000_000n;
/** 85 whole units of the quote raised per curve (above both configs' floors). */
export const fundRaising = (q: Quote) => 85n * q.unit;

export interface Ctx {
  svm: LiteSVM;
  admin: Keypair;
  treasury: Keypair;
  /** Signs `migrate_to_cpswap` (patched into both GlobalConfigs). */
  migrateWallet: Keypair;
}

function fixtureAccount(name: string): { pubkey: PublicKey; lamports: number; data: Buffer; owner: PublicKey } {
  const json = JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8"));
  return {
    pubkey: new PublicKey(json.pubkey),
    lamports: json.account.lamports,
    data: Buffer.from(json.account.data[0], "base64"),
    owner: new PublicKey(json.account.owner),
  };
}

export function setup(): Ctx {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM_ID, PROGRAM_SO);
  for (const [id, so] of [
    [LAUNCHLAB_PROGRAM_ID, "raydium_launchpad.so"],
    [CPMM_PROGRAM_ID, "raydium_cp_swap.so"],
    [LOCK_PROGRAM_ID, "raydium_lock_cp.so"],
    [MPL_PROGRAM_ID, "mpl_token_metadata.so"],
    [TOKEN_2022_PROGRAM_ID, "spl_token_2022.so"],
  ] as const) {
    svm.addProgramFromFile(id, resolve(FIXTURES, so));
  }

  const migrateWallet = Keypair.generate();
  for (const name of ["globalconfig_wsol.json", "globalconfig_spyx.json"]) {
    const a = fixtureAccount(name);
    migrateWallet.publicKey.toBuffer().copy(a.data, 211);
    svm.setAccount(a.pubkey, { lamports: a.lamports, data: a.data, owner: a.owner, executable: false });
  }
  for (const name of [
    "mint_wsol.json",
    "mint_spyx.json",
    "cpmm_ammconfig_raydium.json",
    "cpmm_permission_launchlab.json",
    "cpmm_support_mint_spyx.json",
  ]) {
    const a = fixtureAccount(name);
    svm.setAccount(a.pubkey, { lamports: a.lamports, data: a.data, owner: a.owner, executable: false });
  }
  // Empty WSOL token account at CPMM's create-pool fee receiver.
  const feeAccount = Buffer.alloc(ACCOUNT_SIZE);
  const rent = svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE));
  AccountLayout.encode(
    {
      mint: NATIVE_MINT,
      owner: Keypair.generate().publicKey,
      amount: 0n,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 1,
      isNative: rent,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    feeAccount,
  );
  svm.setAccount(CPMM_CREATE_POOL_FEE, {
    lamports: Number(rent),
    data: feeAccount,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });

  const admin = Keypair.generate();
  const treasury = Keypair.generate();
  svm.airdrop(admin.publicKey, BigInt(1_000 * LAMPORTS_PER_SOL));
  svm.airdrop(treasury.publicKey, BigInt(LAMPORTS_PER_SOL));
  svm.airdrop(migrateWallet.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
  svm.airdrop(PLATFORM_ADMIN.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  send(
    svm,
    [imaginePlatformConfigIx({ admin: PLATFORM_ADMIN.publicKey, nftWallet: treasury.publicKey, cpswapConfig: CPMM_AMM_CONFIG })],
    [PLATFORM_ADMIN],
  );
  return { svm, admin, treasury, migrateWallet };
}

export function fundedKeypair(svm: LiteSVM, sol = 1_000): Keypair {
  const kp = Keypair.generate();
  svm.airdrop(kp.publicKey, BigInt(sol) * BigInt(LAMPORTS_PER_SOL));
  return kp;
}

function buildTx(svm: LiteSVM, ixs: TransactionInstruction[], signers: Keypair[]): Transaction {
  const tx = new Transaction();
  tx.recentBlockhash = svm.latestBlockhash();
  tx.feePayer = signers[0].publicKey;
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  for (const ix of ixs) tx.add(ix);
  tx.sign(...signers);
  return tx;
}

/** Send and assert success, surfacing program logs when it fails. */
export function send(svm: LiteSVM, ixs: TransactionInstruction[], signers: Keypair[]): string[] {
  const result = svm.sendTransaction(buildTx(svm, ixs, signers));
  if (result instanceof FailedTransactionMetadata) {
    throw new Error(`tx failed: ${result.err().toString()}\n${result.meta().logs().join("\n")}`);
  }
  // Same instructions may be sent again in the same slot (e.g. two claims).
  svm.expireBlockhash();
  return result.logs();
}

const ALT_PROGRAM_ID = new PublicKey("AddressLookupTab1e1111111111111111111111111");

/**
 * Send as a v0 transaction through an address lookup table holding every
 * non-signer account, for instructions too large for a legacy transaction.
 * The table is written directly (frozen, extended at slot 0) and the bank
 * advanced a slot so its addresses are live.
 */
export function sendWithLookupTable(svm: LiteSVM, ixs: TransactionInstruction[], signers: Keypair[]): string[] {
  const signerKeys = new Set(signers.map((k) => k.publicKey.toBase58()));
  const addresses: PublicKey[] = [];
  const seen = new Set<string>();
  for (const ix of ixs) {
    for (const key of [...ix.keys.map((k) => k.pubkey), ix.programId]) {
      const b58 = key.toBase58();
      if (signerKeys.has(b58) || seen.has(b58)) continue;
      seen.add(b58);
      addresses.push(key);
    }
  }
  const table = Keypair.generate().publicKey;
  const meta = Buffer.alloc(56);
  meta.writeUInt32LE(1, 0); // ProgramState::LookupTable
  meta.writeBigUInt64LE(0xffff_ffff_ffff_ffffn, 4); // deactivation_slot: active
  meta.writeBigUInt64LE(0n, 12); // last_extended_slot
  meta.writeUInt8(0, 20); // last_extended_slot_start_index
  meta.writeUInt8(0, 21); // authority: None (frozen)
  const data = Buffer.concat([meta, ...addresses.map((a) => a.toBuffer())]);
  svm.setAccount(table, {
    lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    data,
    owner: ALT_PROGRAM_ID,
    executable: false,
  });
  svm.warpToSlot(svm.getClock().slot + 1n);
  const lookup = new AddressLookupTableAccount({
    key: table,
    state: { deactivationSlot: 0xffff_ffff_ffff_ffffn, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses },
  });
  const message = new TransactionMessage({
    payerKey: signers[0].publicKey,
    recentBlockhash: svm.latestBlockhash(),
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs],
  }).compileToV0Message([lookup]);
  const tx = new VersionedTransaction(message);
  tx.sign(signers);
  const result = svm.sendTransaction(tx);
  if (result instanceof FailedTransactionMetadata) {
    throw new Error(`tx failed: ${result.err().toString()}\n${result.meta().logs().join("\n")}`);
  }
  svm.expireBlockhash();
  return result.logs();
}

/** Send expecting failure; returns the joined logs for assertion. */
export function sendExpectingError(
  svm: LiteSVM,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): string {
  const result = svm.sendTransaction(buildTx(svm, ixs, signers));
  if (!(result instanceof FailedTransactionMetadata)) {
    throw new Error("expected transaction to fail, but it succeeded");
  }
  svm.expireBlockhash();
  return result.meta().logs().join("\n");
}

export function warp(svm: LiteSVM, seconds: number): void {
  const clock = svm.getClock();
  clock.unixTimestamp = clock.unixTimestamp + BigInt(seconds);
  svm.setClock(clock);
  svm.expireBlockhash();
}

export function now(svm: LiteSVM): number {
  return Number(svm.getClock().unixTimestamp);
}

/** Address of the BPF loader's ProgramData account for the IMAGINE program. */
export function programDataAddress(): PublicKey {
  return PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE)[0];
}

/**
 * Install a ProgramData account naming `authority` as the upgrade authority.
 * LiteSVM loads a program without the loader's bookkeeping account, so the
 * on-chain check that only the upgrade authority may create the config has
 * nothing to read until this writes one. Layout: 4-byte enum (3 =
 * ProgramData), 8-byte slot, 1-byte Option tag, 32-byte authority.
 */
export function setUpgradeAuthority(svm: LiteSVM, authority: PublicKey): void {
  const data = Buffer.alloc(45);
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(0n, 4);
  data.writeUInt8(1, 12);
  authority.toBuffer().copy(data, 13);
  svm.setAccount(programDataAddress(), {
    lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    data,
    owner: BPF_LOADER_UPGRADEABLE,
    executable: false,
  });
}

export function quoteAta(owner: PublicKey, q: QuoteRef): PublicKey {
  return getAssociatedTokenAddressSync(q.mint, owner, true, q.tokenProgram);
}

export function coinAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
}

/**
 * Give `owner` +`amount` quote base units in its quote ATA (created if
 * missing). WSOL: lamports onto the ATA plus `sync_native`. SPYx: the ATA is
 * created through the real ATA + Token-2022 programs (so it carries SPYx's
 * account extensions) and its `amount` is patched; the mint supply is not.
 */
export function fundQuote(svm: LiteSVM, payer: Keypair, owner: PublicKey, q: Quote, amount: bigint): PublicKey {
  const ata = quoteAta(owner, q);
  send(svm, [createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, q.mint, q.tokenProgram)], [payer]);
  if (q.mint.equals(NATIVE_MINT)) {
    const acc = svm.getAccount(ata)!;
    svm.setAccount(ata, { ...acc, lamports: acc.lamports + Number(amount) });
    send(svm, [createSyncNativeInstruction(ata)], [payer]);
  } else {
    addTokenAmount(svm, ata, amount);
  }
  return ata;
}

/** Patch a token account's `amount` (offset 64) by `delta`. */
export function addTokenAmount(svm: LiteSVM, account: PublicKey, delta: bigint): void {
  const acc = svm.getAccount(account)!;
  const data = Buffer.from(acc.data);
  data.writeBigUInt64LE(data.readBigUInt64LE(64) + delta, 64);
  svm.setAccount(account, { ...acc, data });
}

export function tokenAmount(svm: LiteSVM, account: PublicKey): bigint {
  const acc = svm.getAccount(account);
  if (!acc || acc.data.length < 72) return 0n;
  return Buffer.from(acc.data).readBigUInt64LE(64);
}

export function tokenBalance(svm: LiteSVM, mint: PublicKey, owner: PublicKey): bigint {
  return tokenAmount(svm, coinAta(owner, mint));
}

export function mintSupply(svm: LiteSVM, mint: PublicKey): bigint {
  const account = svm.getAccount(mint);
  if (!account) throw new Error("mint not found");
  return Buffer.from(account.data).readBigUInt64LE(36);
}

export function lamports(svm: LiteSVM, address: PublicKey): bigint {
  return svm.getBalance(address) ?? 0n;
}

/** Quote `owner` holds in the pool's asset: lamports for SOL, the quote ATA otherwise. */
export function quoteHeld(svm: LiteSVM, owner: PublicKey, q: Quote): bigint {
  return q.mint.equals(NATIVE_MINT) ? lamports(svm, owner) : tokenAmount(svm, quoteAta(owner, q));
}

export function readLaunchLabPool(svm: LiteSVM, mint: PublicKey, q: QuoteRef): LaunchLabPool & { address: PublicKey } {
  const address = launchLabPoolPda(mint, q.mint);
  const acc = svm.getAccount(address);
  if (!acc) throw new Error("LaunchLab pool missing");
  return { ...decodeLaunchLabPool(Buffer.from(acc.data)), address };
}

/** The pool's distributable reward balance, read the way the program reads it. */
export function rewardBalance(svm: LiteSVM, mint: PublicKey): bigint {
  const pool = decodePool(Buffer.from(svm.getAccount(poolPda(mint))!.data));
  return distributableBalance(pool, {
    vaultLamports: lamports(svm, pool.rewardVault),
    rewardTokenAmount: tokenAmount(svm, pool.rewardTokenAccount),
  });
}

/**
 * Buy `quoteIn` worth of the coin on its LaunchLab curve (creating the
 * buyer's coin ATA, and funding its quote ATA with exactly `quoteIn`).
 */
export function curveBuy(svm: LiteSVM, buyer: Keypair, mint: PublicKey, q: Quote, quoteIn: bigint): bigint {
  fundQuote(svm, buyer, buyer.publicKey, q, quoteIn);
  const before = tokenBalance(svm, mint, buyer.publicKey);
  const pool: LaunchLabPoolRef = readLaunchLabPool(svm, mint, q);
  send(
    svm,
    [
      createAssociatedTokenAccountIdempotentInstruction(
        buyer.publicKey,
        coinAta(buyer.publicKey, mint),
        buyer.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID,
      ),
      launchLabTradeIx({ kind: "buyExactIn", pool, payer: buyer.publicKey, amount: quoteIn, limit: 1n }),
    ],
    [buyer],
  );
  return tokenBalance(svm, mint, buyer.publicKey) - before;
}

/** Sell `amount` of the coin back to its curve. */
export function curveSell(svm: LiteSVM, seller: Keypair, mint: PublicKey, q: Quote, amount: bigint): void {
  const pool: LaunchLabPoolRef = readLaunchLabPool(svm, mint, q);
  send(
    svm,
    [
      createAssociatedTokenAccountIdempotentInstruction(
        seller.publicKey,
        quoteAta(seller.publicKey, q),
        seller.publicKey,
        q.mint,
        q.tokenProgram,
      ),
      launchLabTradeIx({ kind: "sellExactIn", pool, payer: seller.publicKey, amount, limit: 1n }),
    ],
    [seller],
  );
}

/**
 * Raise the curve's virtual quote reserve so the coin prices "rich": a lock's
 * cap (quote value × multiplier) then sits far above anything a test deposits
 * and never binds unless the test keeps the real curve. Patches LaunchLab's
 * `PoolState.virtual_quote` (offset 45).
 */
export function setVirtualQuote(svm: LiteSVM, mint: PublicKey, q: QuoteRef, virtualQuote: bigint): void {
  const address = launchLabPoolPda(mint, q.mint);
  const acc = svm.getAccount(address)!;
  const data = Buffer.from(acc.data);
  data.writeBigUInt64LE(virtualQuote, 45);
  svm.setAccount(address, { ...acc, data });
}

/** Move coins between wallets (receiver's ATA created if missing). */
export function transferCoins(svm: LiteSVM, from: Keypair, to: PublicKey, mint: PublicKey, amount: bigint): void {
  const ix = new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: coinAta(from.publicKey, mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: coinAta(to, mint), isSigner: false, isWritable: true },
      { pubkey: from.publicKey, isSigner: true, isWritable: false },
    ],
    // TransferChecked = 12, amount u64, decimals u8
    data: Buffer.concat([Buffer.from([12]), u64le(amount), Buffer.from([6])]),
  });
  send(
    svm,
    [
      createAssociatedTokenAccountIdempotentInstruction(from.publicKey, coinAta(to, mint), to, mint, TOKEN_2022_PROGRAM_ID),
      ix,
    ],
    [from],
  );
}

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

export interface Launched {
  mint: PublicKey;
  /** Coins the dev buy returned. */
  bought: bigint;
}

/**
 * `launch` + the creator's dev buy, as the API sends them (separate
 * transactions here: a legacy transaction cannot carry all three without an
 * address lookup table). Does not found the pool.
 */
export async function launchCoin(
  ctx: Ctx,
  creator: Keypair,
  q: Quote,
  opts: { devBuy?: bigint; creatorShareBps?: number; name?: string } = {},
): Promise<Launched> {
  const mintKp = Keypair.generate();
  const ix = await client.launch({
    creator: creator.publicKey,
    mint: mintKp.publicKey,
    quote: q,
    treasury: ctx.treasury.publicKey,
    name: opts.name ?? "Imagine Test",
    symbol: "IMGT",
    uri: metadataUri(mintKp.publicKey),
    platform: IMAGINE_PLATFORM,
    supply: SUPPLY,
    totalSell: TOTAL_SELL,
    fundRaising: fundRaising(q),
    creatorShareBps: opts.creatorShareBps ?? 0,
    globalConfig: q.globalConfig,
  });
  send(ctx.svm, [ix], [creator, mintKp]);
  const bought = curveBuy(ctx.svm, creator, mintKp.publicKey, q, opts.devBuy ?? q.unit);
  return { mint: mintKp.publicKey, bought };
}

/**
 * `migrate_to_cpswap`, signed by the GlobalConfig's migrate wallet, into the
 * platform's `cpswap_config` with its NFT wallet and `platform_cp_creator`
 * (layout of mainnet tx 3zRSi8wL…, as the LaunchLab harness this suite ports
 * from documents). The curve must be sold out (status 1).
 */
export function migrateToCpmm(ctx: Ctx, mint: PublicKey, q: Quote): PublicKey {
  const svm = ctx.svm;
  const pool = readLaunchLabPool(svm, mint, q);
  const platform = svm.getAccount(pool.platformConfig)!;
  const pd = Buffer.from(platform.data);
  const nftWallet = new PublicKey(pd.subarray(48, 80));
  const cpConfig = new PublicKey(pd.subarray(688, 720));
  const cpCreator = new PublicKey(pd.subarray(800, 832));
  const cpPool = cpmmPoolPda(cpConfig, mint, q.mint);
  const lpMint = cpmmLpMintPda(cpPool);
  const [m0, m1] = cpmmTokenOrder(mint, q.mint);
  const auth = launchLabAuthorityPda();
  const lockAuthority = PublicKey.findProgramAddressSync([Buffer.from("lock_cp_authority_seed")], LOCK_PROGRAM_ID)[0];
  const nftMint = Keypair.generate();
  const lockedLiquidity = PublicKey.findProgramAddressSync(
    [Buffer.from("locked_liquidity"), nftMint.publicKey.toBuffer()],
    LOCK_PROGRAM_ID,
  )[0];
  const metadata = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), MPL_PROGRAM_ID.toBuffer(), nftMint.publicKey.toBuffer()],
    MPL_PROGRAM_ID,
  )[0];
  const ata = (owner: PublicKey, m: PublicKey, program: PublicKey) =>
    getAssociatedTokenAddressSync(m, owner, true, program);
  const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
  const r = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
  const keys: AccountMeta[] = [
    w(ctx.migrateWallet.publicKey, true),
    w(mint),
    r(q.mint),
    r(pool.platformConfig),
    r(CPMM_PROGRAM_ID),
    w(cpPool),
    r(cpmmAuthorityPda()),
    w(lpMint),
    w(cpmmVaultPda(cpPool, mint)),
    w(cpmmVaultPda(cpPool, q.mint)),
    r(cpConfig),
    w(CPMM_CREATE_POOL_FEE),
    w(cpmmObservationPda(cpPool)),
    r(LOCK_PROGRAM_ID),
    r(lockAuthority),
    w(ata(lockAuthority, lpMint, TOKEN_PROGRAM_ID)),
    w(auth),
    w(pool.address),
    r(pool.globalConfig),
    w(pool.baseVault),
    w(pool.quoteVault),
    w(ata(auth, lpMint, TOKEN_PROGRAM_ID)),
    r(TOKEN_PROGRAM_ID),
    r(TOKEN_2022_PROGRAM_ID),
    r(ATA_PROGRAM_ID),
    r(SystemProgram.programId),
    r(SYSVAR_RENT_PUBKEY),
    r(MPL_PROGRAM_ID),
    w(nftWallet),
    w(nftMint.publicKey, true),
    w(ata(nftWallet, nftMint.publicKey, TOKEN_PROGRAM_ID)),
    w(lockedLiquidity),
    w(metadata),
    w(pool.creator),
    r(cpmmPermissionPda(auth)),
    cpCreator.equals(PublicKey.default) ? r(cpCreator) : w(cpCreator),
    r(cpmmSupportMintPda(m0)),
    r(cpmmSupportMintPda(m1)),
  ];
  const ix = new TransactionInstruction({
    programId: LAUNCHLAB_PROGRAM_ID,
    keys,
    data: Buffer.from([136, 92, 200, 103, 28, 218, 144, 140]),
  });
  sendWithLookupTable(svm, [ix], [ctx.migrateWallet, nftMint]);
  return cpPool;
}

export { rewardVaultPda, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, LiteSVM };
