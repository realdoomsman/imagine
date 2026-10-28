/**
 * Grow every pool and position written before earnings limits to the current
 * account layout. Run once, immediately after upgrading the program: until an
 * account is migrated, instructions that load it fail to deserialize.
 *
 * Idempotent (`migrate` is a no-op on an account already at full length,
 * and positions already at full length are skipped here) and permissionless;
 * the payer covers the extra rent.
 *
 * Usage: RPC_URL=… node scripts/migrate-accounts.ts [path/to/payer.json]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { DISCRIMINATOR, POSITION_ACCOUNT_SIZE, VISE_PROGRAM_ID, ViseClient } from "@imagine/sdk";
import bs58 from "bs58";
import { env } from "../src/env.ts";

const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(process.argv[2] ?? `${homedir()}/.config/solana/id.json`, "utf8")) as number[],
  ),
);
const connection = new Connection(env.rpcUrl, "confirmed");
const vise = new ViseClient(connection);

let migrated = 0;
let seen = 0;
for (const [kind, discriminator] of [
  ["pool", DISCRIMINATOR.pool],
  ["position", DISCRIMINATOR.position],
] as const) {
  const accounts = await connection.getProgramAccounts(VISE_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(discriminator) } }],
  });
  for (const { pubkey, account } of accounts) {
    seen += 1;
    if (kind === "position" && account.data.length >= POSITION_ACCOUNT_SIZE) continue;
    const ix = await vise.migrate({ payer: payer.publicKey, target: pubkey });
    const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], {
      commitment: "confirmed",
    });
    const after = (await connection.getAccountInfo(pubkey))?.data.length;
    console.log(`${kind} ${pubkey.toBase58()}: ${account.data.length} -> ${after} bytes (${signature})`);
    migrated += 1;
  }
}
console.log(`sent ${migrated} migrations over ${seen} accounts`);
