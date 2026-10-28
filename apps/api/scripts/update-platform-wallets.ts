/**
 * Points the IMAGINE LaunchLab PlatformConfig's `platform_fee_wallet` and
 * `platform_nft_wallet` at a new wallet (`update_platform_config` FeeWallet +
 * NFTWallet, one transaction signed by the platform admin). Nothing else in
 * the PlatformConfig changes.
 *
 *   RPC_URL=… NEW_WALLET=<pubkey> node scripts/update-platform-wallets.ts <admin.json>          # simulate
 *   RPC_URL=… NEW_WALLET=<pubkey> node scripts/update-platform-wallets.ts <admin.json> --send   # send
 *
 * Without `--send` the transaction is simulated (sigVerify off) and the
 * simulated PlatformConfig is checked: only the two wallets (bytes 16..80)
 * may differ from the live account.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction, VersionedTransaction } from "@solana/web3.js";
import { decodePlatformConfig, LAUNCHLAB_PROGRAM_ID, platformConfigPda, updatePlatformConfigIx, type PlatformConfig } from "@imagine/sdk";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
if (!process.env.RPC_URL) throw new Error("set RPC_URL");
if (!process.env.NEW_WALLET) throw new Error("set NEW_WALLET");
const connection = new Connection(process.env.RPC_URL, "confirmed");
const newWallet = new PublicKey(process.env.NEW_WALLET);
const send = process.argv.includes("--send");
const adminPath = process.argv.find((arg, i) => i >= 2 && !arg.startsWith("--")) ?? resolve(root, ".mainnet/admin.json");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(adminPath, "utf8")) as number[]));
const address = platformConfigPda(admin.publicKey, LAUNCHLAB_PROGRAM_ID);

/** Bytes of the PlatformConfig holding `platform_fee_wallet` and `platform_nft_wallet`. */
const WALLETS = [16, 80] as const;

const summary = (p: PlatformConfig) => ({
  feeWallet: p.platformFeeWallet.toBase58(),
  nftWallet: p.platformNftWallet.toBase58(),
  feeRate: p.feeRate.toString(),
  creatorFeeRate: p.creatorFeeRate.toString(),
  scales: { platform: p.platformScale.toString(), creator: p.creatorScale.toString(), burn: p.burnScale.toString() },
  cpswapConfig: p.cpswapConfig.toBase58(),
  name: p.name,
  web: p.web,
  img: p.img,
});

/** Throws unless `after` equals `before` outside the wallet bytes and both wallets are `newWallet`. */
function checkOnlyWalletsChanged(before: Buffer, after: Buffer) {
  if (after.length !== before.length) throw new Error(`length changed ${before.length} -> ${after.length}`);
  if (!after.subarray(0, WALLETS[0]).equals(before.subarray(0, WALLETS[0])) || !after.subarray(WALLETS[1]).equals(before.subarray(WALLETS[1]))) {
    throw new Error("PlatformConfig bytes outside the two wallets changed");
  }
  const p = decodePlatformConfig(after);
  if (!p.platformFeeWallet.equals(newWallet) || !p.platformNftWallet.equals(newWallet)) throw new Error("wallets not updated");
}

console.log(`admin ${admin.publicKey.toBase58()}, PlatformConfig ${address.toBase58()}, new wallet ${newWallet.toBase58()}`);
const info = await connection.getAccountInfo(address);
if (!info) throw new Error(`no PlatformConfig at ${address.toBase58()} for this admin`);
if (!info.owner.equals(LAUNCHLAB_PROGRAM_ID)) throw new Error(`${address.toBase58()} is not owned by LaunchLab`);
const beforeData = Buffer.from(info.data);
const before = decodePlatformConfig(beforeData);
console.log("before:", summary(before));

const ixs = [
  ...(before.platformFeeWallet.equals(newWallet) ? [] : [updatePlatformConfigIx({ admin: admin.publicKey, platformConfig: address, param: { kind: "feeWallet", value: newWallet } })]),
  ...(before.platformNftWallet.equals(newWallet) ? [] : [updatePlatformConfigIx({ admin: admin.publicKey, platformConfig: address, param: { kind: "nftWallet", value: newWallet } })]),
];
if (ixs.length === 0) {
  console.log("both wallets already point at the new wallet; nothing to do");
  process.exit(0);
}
console.log("expected after:", summary({ ...before, platformFeeWallet: newWallet, platformNftWallet: newWallet }));

const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
const tx = new Transaction({ feePayer: admin.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);

if (!send) {
  const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    accounts: { encoding: "base64", addresses: [address.toBase58()] },
  });
  console.log("simulation logs:\n" + (sim.value.logs ?? []).join("\n"));
  if (sim.value.err) throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}`);
  const simulated = sim.value.accounts?.[0];
  if (!simulated) throw new Error("simulation returned no PlatformConfig state");
  const afterData = Buffer.from(simulated.data[0], "base64");
  checkOnlyWalletsChanged(beforeData, afterData);
  console.log("simulated after:", summary(decodePlatformConfig(afterData)));
  console.log(`simulation OK (${sim.value.unitsConsumed} CU): only the fee and NFT wallets change. Re-run with --send to apply.`);
} else {
  const signature = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log(`update_platform_config: ${signature}`);
  const afterData = Buffer.from((await connection.getAccountInfo(address, "confirmed"))!.data);
  checkOnlyWalletsChanged(beforeData, afterData);
  console.log("after:", summary(decodePlatformConfig(afterData)));
}
