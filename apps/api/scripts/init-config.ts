/**
 * Initialise (or inspect) the singleton platform config.
 *
 * Idempotent: if the config already exists it prints it and exits rather than
 * failing, so it is safe to run as part of a deploy pipeline.
 *
 * Usage: node --env-file=.env.devnet scripts/init-config.ts [path/to/admin.json]
 *
 * The treasury is `TREASURY_PUBKEY` (defaults to the admin: rotate it later
 * with `set_treasury`). This is the one place a treasury is chosen; the API
 * itself reads it back from the chain.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { configPda, DAY, ViseClient } from "@vise/sdk";
import { env } from "../src/env.ts";

const keypairPath =
  process.argv[2] ?? `${homedir()}/.config/solana/id.json`;
const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]),
);

const connection = new Connection(env.rpcUrl, "confirmed");
const vise = new ViseClient(connection);

const existing = await vise.fetchConfig();
if (existing) {
  console.log("config already initialised:");
  console.log({
    address: configPda().toBase58(),
    admin: existing.admin.toBase58(),
    treasury: existing.treasury.toBase58(),
    tradeFeeBps: existing.tradeFeeBps,
    treasuryShareBps: existing.defaultTreasuryShareBps,
    maxCreatorShareBps: existing.maxCreatorShareBps,
    lockWindowDays: [
      existing.defaultMinLockSecs / DAY,
      existing.defaultMaxLockSecs / DAY,
    ],
    maxMultiplier: `${existing.defaultMaxMultiplierBps / 10_000}x`,
    penaltyBps: existing.defaultEarlyUnlockPenaltyBps,
    poolCreationFee: `${Number(existing.poolCreationFee) / LAMPORTS_PER_SOL} SOL`,
    paused: existing.paused,
    poolCount: existing.poolCount.toString(),
  });
  process.exit(0);
}

// Every number comes from ECONOMICS in the SDK; the only per-deployment
// input is the treasury.
const treasury = new PublicKey(process.env.TREASURY_PUBKEY ?? admin.publicKey);
console.log(`treasury ${treasury.toBase58()}`);
// Only the upgrade authority may create the config; the program proves it by
// reading its own ProgramData account.
const programData = PublicKey.findProgramAddressSync(
  [vise.programId.toBuffer()],
  new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
)[0];
const instruction = await vise.program.methods
  .initializeConfig(ViseClient.configArgs({ treasury }))
  .accountsPartial({ admin: admin.publicKey, program: vise.programId, programData })
  .instruction();

const latest = await connection.getLatestBlockhash();
const tx = new Transaction({ feePayer: admin.publicKey, ...latest }).add(instruction);
const signature = await connection.sendTransaction(tx, [admin]);
await connection.confirmTransaction({ signature, ...latest }, "confirmed");

console.log("initialised", configPda().toBase58(), signature);
