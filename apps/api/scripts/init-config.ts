/**
 * Initialise the singleton platform config, or bring an existing one in line
 * with `ECONOMICS` and the StonkFun platform.
 *
 * Idempotent: a config that already matches is printed and left alone; one
 * that differs gets a single `update_config` signed by the admin, keeping its
 * treasury and pause flag. Live pools are untouched either way — their terms
 * are frozen — so this only changes what pools launched afterwards get.
 *
 * `launchlab_platform` is StonkFun's LaunchLab PlatformConfig
 * (4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7): `launch` only creates coins
 * under it, which is what puts every IMAGINE coin on stonkfun.xyz.
 *
 * Usage: RPC_URL=… node scripts/init-config.ts [path/to/admin.json]
 *
 * The treasury of a new config is `TREASURY_PUBKEY` (defaults to the admin).
 * This is the one place a treasury is chosen; the API itself reads it back
 * from the chain.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import { configPda, ECONOMICS, ImagineClient, STONKFUN_PLATFORM } from "@imagine/sdk";

const keypairPath = process.argv[2] ?? `${homedir()}/.config/solana/id.json`;
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]));

const connection = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8999", "confirmed");
const imagine = new ImagineClient(connection);

const existing = await imagine.fetchConfig();
const summary = (config: NonNullable<typeof existing>) => ({
  address: configPda().toBase58(),
  admin: config.admin.toBase58(),
  treasury: config.treasury.toBase58(),
  launchlabPlatform: config.launchlabPlatform.toBase58(),
  tradeFeeBps: config.tradeFeeBps,
  treasuryShareBps: config.defaultTreasuryShareBps,
  maxCreatorShareBps: config.maxCreatorShareBps,
  lockWindowHours: [config.defaultMinLockSecs / 3_600, config.defaultMaxLockSecs / 3_600],
  rewardStreamSecs: config.defaultRewardStreamSecs,
  maxMultiplier: `${config.defaultMaxMultiplierBps / 10_000}x`,
  penaltyBps: config.defaultEarlyUnlockPenaltyBps,
  poolCreationFee: `${Number(config.poolCreationFee) / LAMPORTS_PER_SOL} SOL`,
  paused: config.paused,
  poolCount: config.poolCount.toString(),
});

async function send(transaction: Transaction): Promise<string> {
  const latest = await connection.getLatestBlockhash();
  transaction.feePayer = admin.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  const signature = await connection.sendTransaction(transaction, [admin]);
  const result = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  if (result.value.err) throw new Error(`${signature} failed: ${JSON.stringify(result.value.err)}`);
  return signature;
}

if (existing) {
  const drift =
    !existing.launchlabPlatform.equals(STONKFUN_PLATFORM) ||
    existing.tradeFeeBps !== ECONOMICS.tradeFeeBps ||
    existing.defaultTreasuryShareBps !== ECONOMICS.treasuryShareBps ||
    existing.maxCreatorShareBps !== ECONOMICS.maxCreatorShareBps ||
    existing.defaultMinLockSecs !== ECONOMICS.minLockSecs ||
    existing.defaultMaxLockSecs !== ECONOMICS.maxLockSecs ||
    existing.defaultMaxMultiplierBps !== ECONOMICS.maxMultiplierBps ||
    existing.defaultEarlyUnlockPenaltyBps !== ECONOMICS.earlyUnlockPenaltyBps ||
    existing.defaultMinLockAmount !== ECONOMICS.minLockAmount ||
    existing.defaultRewardStreamSecs !== ECONOMICS.rewardStreamSecs ||
    existing.defaultDurationCurve !== ECONOMICS.durationCurve ||
    existing.defaultSizeTierBps.some((v, i) => v !== ECONOMICS.sizeTierBps[i]) ||
    existing.defaultSizeBonusBps.some((v, i) => v !== ECONOMICS.sizeBonusBps[i]) ||
    existing.poolCreationFee !== ECONOMICS.poolCreationFeeLamports;
  if (!drift) {
    console.log("config already matches ECONOMICS:", summary(existing));
    process.exit(0);
  }
  if (!existing.admin.equals(admin.publicKey)) {
    console.error(`config differs from ECONOMICS but ${admin.publicKey.toBase58()} is not its admin (${existing.admin.toBase58()})`);
    process.exit(1);
  }
  console.log("before:", summary(existing));
  const update = await imagine.program.methods
    .updateConfig(
      ImagineClient.configArgs({ treasury: existing.treasury, launchlabPlatform: STONKFUN_PLATFORM, paused: existing.paused }),
    )
    .accountsPartial({ admin: admin.publicKey, config: configPda() })
    .instruction();
  const signature = await send(new Transaction().add(update));
  const after = await imagine.fetchConfig();
  console.log("updated", signature);
  console.log("after:", after ? summary(after) : null);
  process.exit(0);
}

// Every number comes from ECONOMICS in the SDK; the only per-deployment
// input is the treasury.
const treasury = new PublicKey(process.env.TREASURY_PUBKEY || admin.publicKey);
console.log(`treasury ${treasury.toBase58()}`);
// Only the upgrade authority may create the config; the program proves it by
// reading its own ProgramData account.
const programData = PublicKey.findProgramAddressSync(
  [imagine.programId.toBuffer()],
  new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
)[0];
const instruction = await imagine.program.methods
  .initializeConfig(ImagineClient.configArgs({ treasury, launchlabPlatform: STONKFUN_PLATFORM }))
  .accountsPartial({ admin: admin.publicKey, program: imagine.programId, programData })
  .instruction();
const signature = await send(new Transaction().add(instruction));
const created = await imagine.fetchConfig();
console.log("initialised", configPda().toBase58(), signature);
console.log(created ? summary(created) : null);
