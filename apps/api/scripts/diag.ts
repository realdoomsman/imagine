import { Connection } from "@solana/web3.js";
import { rewardVaultPda } from "@vise/sdk";
import { PublicKey } from "@solana/web3.js";

const connection = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
console.log("rent-exempt minimum for a 0-byte account:", await connection.getMinimumBalanceForRentExemption(0));

const mint = process.argv[2];
if (mint) {
  const vault = rewardVaultPda(new PublicKey(mint));
  console.log("vault", vault.toBase58(), await connection.getBalance(vault));
}
