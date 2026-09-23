/**
 * Pre-create pump.fun's fee-collecting accounts on the local validator.
 *
 * pump splits every trade's fees across a rotating set of recipients and a few
 * fee-program accounts. On mainnet and devnet those already exist and are
 * funded. A fresh local ledger has none of them, so a fee smaller than the
 * rent-exempt minimum leaves the destination rent-paying and the runtime
 * rejects the whole transaction — an intermittent "insufficient funds for rent"
 * on trades, depending on which recipient the slot happened to select.
 *
 * Funding each one above the rent floor removes that fixture artefact without
 * changing anything about the program under test.
 *
 * Run: node scripts/seed-localnet.ts [rpc-url]
 */
import { GLOBAL_PDA, PUMP_SDK } from "@pump-fun/pump-sdk";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const localUrl = process.argv[2] ?? "http://127.0.0.1:8899";
const sourceUrl = process.env.CLUSTER_URL ?? "https://api.devnet.solana.com";

const local = new Connection(localUrl, "confirmed");
const source = new Connection(sourceUrl, "confirmed");

const info = await source.getAccountInfo(GLOBAL_PDA);
if (!info) throw new Error(`no pump Global on ${sourceUrl}`);
const global = PUMP_SDK.decodeGlobal(info);

/**
 * Accounts owned by the pump fees program that a trade credits. These are not
 * derivable from any SDK helper, so they are listed explicitly; a new one shows
 * up as a MISSING writable account in an e2e failure dump.
 */
const FEE_PROGRAM_ACCOUNTS = [
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
];

const addresses = [
  ...new Set(
    [
      global.feeRecipient,
      ...global.feeRecipients,
      ...FEE_PROGRAM_ACCOUNTS.map((key) => new PublicKey(key)),
    ]
      .map((key) => key.toBase58())
      .filter((key) => key !== PublicKey.default.toBase58()),
  ),
];

let funded = 0;
for (const address of addresses) {
  const key = new PublicKey(address);
  const balance = await local.getBalance(key);
  if (balance >= LAMPORTS_PER_SOL) continue;
  const signature = await local.requestAirdrop(key, LAMPORTS_PER_SOL);
  const latest = await local.getLatestBlockhash();
  await local.confirmTransaction({ signature, ...latest }, "confirmed");
  funded += 1;
}

console.log(`seeded ${funded}/${addresses.length} pump fee accounts on ${localUrl}`);
