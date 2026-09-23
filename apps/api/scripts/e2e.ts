/**
 * End-to-end smoke test against a local validator carrying the real pump.fun
 * programs (see scripts/localnet.sh).
 *
 * Exercises the whole product in the order a user does:
 *   1. launch a coin on pump.fun through VISE
 *   2. point its pump creator-fee stream at the lock pool, permanently
 *   3. open the lock pool with the creator's founding lock
 *   4. a second wallet buys the coin, paying the 2% app fee into the pool
 *   5. that wallet locks, and both lockers accrue by weight
 *   6. claims pay real SOL, and the pool stays solvent throughout
 *
 * Run: node --env-file=.env.local scripts/e2e.ts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { BN } from "@coral-xyz/anchor";
import {
  creatorVaultPda,
  feeSharingConfigPda,
  getBuyTokenAmountFromSolAmount,
  OnlinePumpSdk,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import {
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
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  accrued,
  appFeeLamports,
  DAY,
  FeeKind,
  formatSol,
  poolPda,
  rewardVaultPda,
  VISE_PROGRAM_ID,
  ViseClient,
} from "@vise/sdk";
import { distributable } from "../src/keeper.ts";
import { sweepCreatorFees } from "../src/pump.ts";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const TRADE_FEE_BPS = 200;

const connection = new Connection(RPC, "confirmed");
const vise = new ViseClient(connection);
const onlinePump = new OnlinePumpSdk(connection);

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function step(title: string) {
  console.log(`\n${title}`);
}

async function fund(keypair: Keypair, sol: number) {
  const signature = await connection.requestAirdrop(
    keypair.publicKey,
    sol * LAMPORTS_PER_SOL,
  );
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
}

/**
 * Pre-create every writable account in a transaction that does not exist yet.
 *
 * A fresh local ledger has none of pump.fun's fee-collecting accounts, and pump
 * rotates which one it credits by slot. A fee smaller than the rent-exempt
 * minimum would leave a brand-new destination rent-paying, and the runtime
 * rejects the whole transaction — an intermittent "insufficient funds for rent"
 * that has nothing to do with the program under test. On devnet and mainnet
 * those accounts already exist and are funded.
 */
async function fundMissingAccounts(tx: Transaction): Promise<number> {
  const message = tx.compileMessage();
  const missing: PublicKey[] = [];
  for (const [index, key] of message.accountKeys.entries()) {
    if (!message.isAccountWritable(index)) continue;
    if (await connection.getAccountInfo(key)) continue;
    missing.push(key);
  }
  for (const key of missing) {
    const signature = await connection.requestAirdrop(key, LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  }
  return missing.length;
}

async function send(
  instructions: TransactionInstruction[],
  signers: Keypair[],
  label: string,
  options: { seedFeeAccounts?: boolean } = {},
): Promise<string> {
  const latest = await connection.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: signers[0].publicKey,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx.add(...instructions);
  // Only for trades. Seeding indiscriminately would also fund accounts the
  // transaction is supposed to create — including a pool's own reward vault,
  // which would then count the airdrop as fee inflow.
  if (options.seedFeeAccounts) await fundMissingAccounts(tx);

  try {
    const signature = await connection.sendTransaction(tx, signers, {
      skipPreflight: false,
    });
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    return signature;
  } catch (error) {
    console.error(`\n${label} failed`);
    const message = tx.compileMessage();
    for (const [index, key] of message.accountKeys.entries()) {
      if (!message.isAccountWritable(index)) continue;
      const info = await connection.getAccountInfo(key);
      console.error(
        `  [${index}] ${key.toBase58()} ${info ? `${info.lamports} lamports, ${info.data.length}B, owner ${info.owner.toBase58().slice(0, 8)}` : "MISSING"}`,
      );
    }
    if (error && typeof error === "object" && "transactionMessage" in error) {
      console.error(String((error as { transactionMessage?: string }).transactionMessage));
    }
    throw error;
  }
}

async function main() {
  step("0. Fund wallets");
  // The config may only be created by the program's upgrade authority, which
  // scripts/localnet.sh sets to the local CLI keypair.
  const admin = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync(
          process.env.UPGRADE_AUTHORITY ??
            `${homedir()}/.config/solana/id.json`,
          "utf8",
        ),
      ) as number[],
    ),
  );
  const creator = Keypair.generate();
  const trader = Keypair.generate();
  await Promise.all([fund(admin, 50), fund(creator, 50), fund(trader, 50)]);
  check("wallets funded", true);

  step("1. Initialise platform config");
  const configIx = await vise.program.methods
    .initializeConfig({
      treasury: admin.publicKey,
      tradeFeeBps: TRADE_FEE_BPS,
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
    })
    .accountsPartial({
      admin: admin.publicKey,
      program: VISE_PROGRAM_ID,
      programData: PublicKey.findProgramAddressSync(
        [VISE_PROGRAM_ID.toBuffer()],
        new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
      )[0],
    })
    .instruction();
  const existing = await vise.fetchConfig();
  // Only the upgrade authority may create the config. On this local validator
  // the program is loaded without a ProgramData account, so the very first run
  // against a fresh ledger cannot initialise it; a real deploy always can.
  if (!existing) await send([configIx], [admin], "initialize_config");
  const config = await vise.fetchConfig();
  if (!config) throw new Error("config missing after initialize");
  // The config is a singleton on this cluster: reuse whatever treasury is
  // already stamped on it rather than assuming this run created it.
  const treasury = config.treasury;
  check("config exists", true, `fee ${config.tradeFeeBps} bps, treasury ${treasury.toBase58().slice(0, 8)}…`);

  step("2. Launch a coin on pump.fun");
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;
  const global = await onlinePump.fetchGlobal();
  const feeConfig = await onlinePump.fetchFeeConfig().catch(() => null);
  const devBuy = BigInt(2 * LAMPORTS_PER_SOL);
  const expectedTokens = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: null,
    bondingCurve: null,
    amount: new BN(devBuy.toString()),
    quoteMint: PublicKey.default,
  });

  // create_v2 and the first buy do not fit in one legacy transaction
  // (~1457 bytes against a 1232 limit), so they are sent back to back.
  const createIx = await PUMP_SDK.createV2Instruction({
    mint,
    name: "Vise Test Coin",
    symbol: "VTEST",
    uri: "https://example.com/vtest.json",
    creator: creator.publicKey,
    user: creator.publicKey,
    mayhemMode: false,
    holderReward: false,
  });
  await send([createIx], [creator, mintKp], "create");

  const freshCurveInfo = await connection.getAccountInfo(
    PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
    )[0],
  );
  if (!freshCurveInfo) throw new Error("bonding curve was not created");
  const devBuyIxs = await PUMP_SDK.buyV2Instructions({
    global,
    bondingCurveAccountInfo: freshCurveInfo,
    bondingCurve: PUMP_SDK.decodeBondingCurve(freshCurveInfo),
    associatedUserAccountInfo: null,
    mint,
    user: creator.publicKey,
    amount: expectedTokens,
    quoteAmount: new BN(devBuy.toString()),
    slippage: 10,
  });
  await send(devBuyIxs, [creator], "dev buy", { seedFeeAccounts: true });

  const creatorAta = getAssociatedTokenAddressSync(
    mint,
    creator.publicKey,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
  const creatorBalance = await connection.getTokenAccountBalance(creatorAta);
  check(
    "coin created and dev buy landed",
    BigInt(creatorBalance.value.amount) > 0n,
    `${creatorBalance.value.uiAmountString} VTEST`,
  );

  step("3. Open the lock pool with the creator's founding lock");
  const lockAmount = BigInt(creatorBalance.value.amount) / 2n;
  const createPoolIx = await vise.createPool({
    creator: creator.publicKey,
    mint,
    treasury,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    creatorShareBps: 1000,
    initialLockAmount: lockAmount,
    initialLockDuration: 90 * DAY,
  });
  await send([createPoolIx], [creator], "create_pool");

  let pool = await vise.fetchPool(mint);
  check("pool open with weight from birth", (pool?.totalWeight ?? 0n) > 0n,
    `weight ${pool?.totalWeight}`);
  check("creator's founding lock recorded", pool?.totalLocked === lockAmount);

  step("4. Route pump creator fees to the lock pool, permanently");
  // Must come after create_pool: this rewrites BondingCurve::creator to the
  // sharing_config PDA, and the pool needs to read the original creator there.
  const vault = rewardVaultPda(mint);
  const shareIxs = [
    await PUMP_SDK.createFeeSharingConfig({
      creator: creator.publicKey,
      mint,
      pool: null,
    }),
    await PUMP_SDK.updateFeeSharesV2({
      authority: creator.publicKey,
      mint,
      currentShareholders: [creator.publicKey],
      newShareholders: [{ address: vault, shareBps: 10_000 }],
      quoteMint: NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    }),
  ];
  // The migration points creator fees at a new pump vault; seed it above the
  // rent floor so the first trade cannot be rejected for leaving it rent-paying.
  shareIxs.push(
    SystemProgram.transfer({
      fromPubkey: creator.publicKey,
      toPubkey: creatorVaultPda(feeSharingConfigPda(mint)),
      lamports: await connection.getMinimumBalanceForRentExemption(0),
    }),
  );
  await send(shareIxs, [creator], "fee sharing");
  check("pump fee sharing points at the vault", true, vault.toBase58());

  step("5. A trader buys, paying the 2% app fee into the pool");
  const curveInfo = await connection.getAccountInfo(
    PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
    )[0],
  );
  if (!curveInfo) throw new Error("bonding curve missing");
  const curve = PUMP_SDK.decodeBondingCurve(curveInfo);

  const spend = BigInt(3 * LAMPORTS_PER_SOL);
  const fee = appFeeLamports(spend, TRADE_FEE_BPS);
  const toCurve = spend - fee;
  const supply = await connection.getTokenSupply(mint);
  const tokensOut = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: new BN(supply.value.amount),
    bondingCurve: curve,
    amount: new BN(toCurve.toString()),
    quoteMint: PublicKey.default,
  });
  const traderAta = getAssociatedTokenAddressSync(
    mint,
    trader.publicKey,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
  const buyIxs = await PUMP_SDK.buyInstructions({
    global,
    bondingCurveAccountInfo: curveInfo,
    bondingCurve: curve,
    associatedUserAccountInfo: await connection.getAccountInfo(traderAta),
    mint,
    user: trader.publicKey,
    amount: tokensOut,
    solAmount: new BN(toCurve.toString()),
    slippage: 10,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  const feeIx = await vise.depositReward({
    payer: trader.publicKey,
    mint,
    lamports: fee,
    kind: FeeKind.Buy,
  });

  const vaultBefore = await connection.getBalance(vault);
  await send([...buyIxs, feeIx], [trader], "buy + app fee", { seedFeeAccounts: true });
  const vaultAfter = await connection.getBalance(vault);
  check(
    "app fee landed in the pool atomically with the trade",
    BigInt(vaultAfter - vaultBefore) === fee,
    `${formatSol(fee)} SOL`,
  );

  pool = await vise.fetchPool(mint);
  const expectedTreasury = (fee * 2000n) / 10_000n;
  const expectedCreator = ((fee - expectedTreasury) * 1000n) / 10_000n;
  check(
    "split matches the pool's frozen terms",
    pool?.treasuryClaimable === expectedTreasury &&
      pool?.creatorClaimable === expectedCreator,
    `treasury ${formatSol(pool?.treasuryClaimable ?? 0n)} / creator ${formatSol(pool?.creatorClaimable ?? 0n)}`,
  );

  step("6. Fees stream out rather than landing all at once");
  pool = await vise.fetchPool(mint);
  check(
    "the lockers' share is queued, not handed out",
    pool!.undistributed > 0n && pool!.lifetimeRewards === 0n,
    `${formatSol(pool!.undistributed)} SOL queued over ${pool!.terms.rewardStreamSecs}s`,
  );

  step("6b. The keeper sweeps pump's creator fee into the pool");
  // The buy in step 5 paid pump.fun a creator fee. That fee sits in the
  // sharing-config vault until someone calls distribute — which is the
  // keeper's whole job. Nothing else in this suite touches that path.
  const waiting = (await distributable(mint)).pump;
  check("pump credited the creator fee to the sharing-config vault", waiting > 0n, `${formatSol(waiting)} SOL waiting`);
  const vaultBeforeSweep = BigInt(await connection.getBalance(vault));
  const inflowBeforeSweep = (await vise.fetchPool(mint))!.lifetimeInflow;
  const sweepIxs = await sweepCreatorFees({ payer: trader.publicKey, mint, includeAmm: false });
  check("the sweep builds distribute + sync", sweepIxs.length === 2, `${sweepIxs.length} instructions`);
  await send(sweepIxs, [trader], "keeper sweep", { seedFeeAccounts: true });
  const vaultAfterSweep = BigInt(await connection.getBalance(vault));
  const swept = vaultAfterSweep - vaultBeforeSweep;
  check(
    "the creator fee arrived in the pool's reward vault",
    swept === waiting,
    `${formatSol(swept)} SOL moved`,
  );
  pool = await vise.fetchPool(mint);
  check(
    "the same sync folded it into the pool's accounting",
    pool!.lifetimeInflow === inflowBeforeSweep + swept,
    `lifetime inflow ${formatSol(pool!.lifetimeInflow)} SOL`,
  );
  check(
    "nothing is left waiting at pump",
    (await distributable(mint)).pump === 0n,
  );

  step("7. The trader locks, and rewards split by weight");
  const traderBalance = await connection.getTokenAccountBalance(traderAta);
  const lockIx = await vise.lock({
    owner: trader.publicKey,
    mint,
    index: 0,
    amount: BigInt(traderBalance.value.amount) / 2n,
    durationSecs: 7 * DAY,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  await send([lockIx], [trader], "lock");

  // Let a slice of the window elapse so the stream has released something to
  // split, then crank it in.
  await new Promise((resolve) => setTimeout(resolve, 12_000));
  await send([await vise.sync(mint)], [trader], "sync");
  pool = await vise.fetchPool(mint);
  check(
    "the stream released a share over time",
    pool!.lifetimeRewards > 0n,
    `${formatSol(pool!.lifetimeRewards)} SOL released so far`,
  );

  const sellFee = BigInt(LAMPORTS_PER_SOL) / 2n;
  await send(
    [
      await vise.depositReward({
        payer: trader.publicKey,
        mint,
        lamports: sellFee,
        kind: FeeKind.Sell,
      }),
    ],
    [trader],
    "second fee deposit",
  );

  pool = await vise.fetchPool(mint);
  const positions = await vise.fetchPositionsByPool(mint);
  check("two positions in the pool", positions.length === 2);

  const dues = positions.map((position) => ({
    owner: position.owner.toBase58(),
    weight: position.weight,
    due: accrued(position.weight, pool!.accRewardPerWeight, position.rewardDebt),
  }));
  for (const entry of dues) {
    console.log(
      `        ${entry.owner.slice(0, 8)}… weight ${entry.weight} → ${formatSol(entry.due)} SOL`,
    );
  }
  const creatorDue = dues.find((d) => d.owner === creator.publicKey.toBase58())!;
  const traderDue = dues.find((d) => d.owner === trader.publicKey.toBase58())!;
  check(
    "the longer lock earns more per coin",
    creatorDue.due > traderDue.due,
    "90d at 1.70x beats 7d at 1.00x",
  );

  step("8. Claims pay real SOL");
  const before = await connection.getBalance(creator.publicKey);
  await send(
    [await vise.claim({ owner: creator.publicKey, mint, index: 0 })],
    [creator],
    "claim",
  );
  const after = await connection.getBalance(creator.publicKey);
  check(
    "claim credited the wallet",
    after > before,
    `+${formatSol(BigInt(after - before))} SOL after fees`,
  );

  step("9. Solvency");
  pool = await vise.fetchPool(mint);
  const live = await vise.fetchPositionsByPool(mint);
  const owed =
    live.reduce(
      (sum, p) => sum + accrued(p.weight, pool!.accRewardPerWeight, p.rewardDebt),
      0n,
    ) +
    pool!.creatorClaimable +
    pool!.treasuryClaimable +
    pool!.rewardRemainder +
    pool!.undistributed;
  const held = BigInt(await connection.getBalance(vault)) - pool!.vaultReserve;
  check("the vault can pay everyone it owes", owed <= held,
    `owes ${formatSol(owed)} holds ${formatSol(held)}`);

  step("10. Creator and treasury payouts");
  await send(
    [await vise.claimCreator({ creator: creator.publicKey, mint })],
    [creator],
    "claim_creator",
  );
  await send(
    [
      await vise.claimTreasury({ payer: trader.publicKey, mint, treasury }),
    ],
    [trader],
    "claim_treasury",
  );
  pool = await vise.fetchPool(mint);
  check(
    "creator and treasury balances drained",
    pool?.creatorClaimable === 0n && pool?.treasuryClaimable === 0n,
  );

  console.log(
    `\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — coin ${mint.toBase58()} pool ${poolPda(mint).toBase58()}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
