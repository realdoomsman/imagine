/**
 * Initialise (or inspect) the singleton platform config.
 *
 * Idempotent: if the config already exists it prints it and exits rather than
 * failing, so it is safe to run as part of a deploy pipeline.
 *
 * Usage: node --env-file=.env.devnet scripts/init-config.ts [path/to/admin.json]
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

const instruction = await vise.program.methods
  .initializeConfig({
    treasury: new PublicKey(env.treasury),
    tradeFeeBps: env.tradeFeeBps,
    defaultTreasuryShareBps: 2_000, // platform takes 20% off the top
    maxCreatorShareBps: 3_000, // creators may keep at most 30% of the rest
    defaultMinLockSecs: 7 * DAY,
    defaultMaxLockSecs: 365 * DAY,
    defaultMaxMultiplierBps: 40_000, // 4.0x at a full year
    defaultEarlyUnlockPenaltyBps: 2_500, // 25% of principal at full remaining term
    defaultMinLockAmount: new BN(1_000),
    poolCreationFee: new BN(0.05 * LAMPORTS_PER_SOL),
    paused: false,
  })
  .accountsPartial({ admin: admin.publicKey })
  .instruction();

const latest = await connection.getLatestBlockhash();
const tx = new Transaction({ feePayer: admin.publicKey, ...latest }).add(instruction);
const signature = await connection.sendTransaction(tx, [admin]);
await connection.confirmTransaction({ signature, ...latest }, "confirmed");

console.log("initialised", configPda().toBase58(), signature);
