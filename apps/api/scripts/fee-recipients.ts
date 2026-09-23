/**
 * Print pump.fun's protocol fee recipients for a cluster.
 *
 * `scripts/localnet.sh` must clone these: pump pays the protocol fee to one of
 * them, chosen by slot, and if the account does not exist a fee smaller than
 * the rent-exempt minimum makes the whole transaction fail. That shows up as an
 * intermittent "insufficient funds for rent" on trades.
 */
import { GLOBAL_PDA, PUMP_SDK } from "@pump-fun/pump-sdk";
import { Connection } from "@solana/web3.js";

const url = process.argv[2] ?? "https://api.devnet.solana.com";
const connection = new Connection(url, "confirmed");

const info = await connection.getAccountInfo(GLOBAL_PDA);
if (!info) throw new Error(`no pump Global on ${url}`);
const global = PUMP_SDK.decodeGlobal(info);

const recipients = [
  global.feeRecipient,
  ...global.feeRecipients,
].filter((key) => !key.equals(global.feeRecipient) || true);

const unique = [...new Set(recipients.map((k) => k.toBase58()))].filter(
  (k) => k !== "11111111111111111111111111111111",
);
for (const key of unique) console.log(key);
