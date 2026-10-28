/**
 * Create (or top up) the address lookup table that lets a launch —
 * imagine.launch (LaunchLab initialize CPI), the dev buy and imagine.found —
 * fit in one transaction. Without it the three overrun the 1232-byte packet
 * and the launch is split, exposing the dev buy to anyone buying in between.
 * Trades use it too when they would not fit as a legacy transaction.
 *
 * Usage: RPC_URL=… node scripts/create-alt.ts <payer-keypair.json> [existing-table]
 *
 * The table holds every account of a launch or trade that does not depend on
 * the coin or the creator:
 *  - programs and sysvars: IMAGINE, LaunchLab, CPMM, Token, Token-2022,
 *    associated token, system, compute budget;
 *  - IMAGINE's config and treasury, StonkFun's platform config, LaunchLab's
 *    authority and event authority, CPMM's authority and StonkFun's AmmConfig;
 *  - per launchable quote: its mint, LaunchLab GlobalConfig, StonkFun's
 *    allow-config and curve-rule PDAs for it, and StonkFun's fee vault for it.
 * A table holds at most 256 addresses, so quotes are added SOL first, then
 * stablecoins, funds and stocks, then the rest, until it is full.
 *
 * Idempotent: pass the table (argument or LAUNCH_ALT) and it only appends
 * what is missing; a table is append-only, so existing entries never move.
 * Prints the address to set as LAUNCH_ALT on the API.
 */
import { readFileSync } from "node:fs";
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  configPda,
  CPMM_PROGRAM_ID,
  cpmmAuthorityPda,
  IMAGINE_PROGRAM_ID,
  ImagineClient,
  LAUNCHLAB_PROGRAM_ID,
  launchLabAuthorityPda,
  launchLabEventAuthorityPda,
  platformAllowConfigPda,
  platformCurveRulePda,
  platformFeeVaultPda,
  quoteByMint,
  STONKFUN_CPMM_CONFIG,
  STONKFUN_PLATFORM,
} from "@imagine/sdk";
import { launchableQuotes } from "../src/quotes.ts";

/** Addresses per extend transaction; 20 keeps it well inside a legacy packet. */
const EXTEND_CHUNK = 20;
const TABLE_CAPACITY = 256;

const keypairPath = process.argv[2];
if (!keypairPath) {
  console.error("usage: node scripts/create-alt.ts <payer-keypair.json> [existing-table]");
  process.exit(1);
}
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]));
const existingArg = process.argv[3] ?? process.env.LAUNCH_ALT;
const connection = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8999", "confirmed");

const config = await new ImagineClient(connection).fetchConfig();
if (!config) throw new Error("IMAGINE config is not initialised on this cluster; run scripts/init-config.ts first");

const common = [
  IMAGINE_PROGRAM_ID,
  configPda(),
  config.treasury,
  LAUNCHLAB_PROGRAM_ID,
  launchLabAuthorityPda(),
  launchLabEventAuthorityPda(),
  STONKFUN_PLATFORM,
  CPMM_PROGRAM_ID,
  cpmmAuthorityPda(),
  STONKFUN_CPMM_CONFIG,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SystemProgram.programId,
  ComputeBudgetProgram.programId,
];

const CATEGORY_ORDER = ["currencies", "etfs", "stocks", "commodities", "crypto"];
const rank = (mint: string, category: string) =>
  mint === NATIVE_MINT.toBase58() ? -1 : (CATEGORY_ORDER.indexOf(category) + 1 || 99);
const quotes = (await launchableQuotes()).sort((a, b) => rank(a.mint, a.category) - rank(b.mint, b.category));

const wanted: PublicKey[] = [...common];
for (const quote of quotes) {
  if (wanted.length + 5 > TABLE_CAPACITY) break;
  const registry = quoteByMint(quote.mint);
  if (!registry) continue;
  const globalConfig = new PublicKey(registry.globalConfig);
  const mint = new PublicKey(quote.mint);
  wanted.push(
    mint,
    globalConfig,
    platformAllowConfigPda(STONKFUN_PLATFORM, globalConfig),
    platformCurveRulePda(STONKFUN_PLATFORM, globalConfig),
    platformFeeVaultPda(STONKFUN_PLATFORM, mint),
  );
}

async function send(instructions: TransactionInstruction[]): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer], { commitment: "confirmed" });
}

let table: PublicKey;
let present = new Set<string>();
if (existingArg) {
  table = new PublicKey(existingArg);
  const { value } = await connection.getAddressLookupTable(table);
  if (!value) throw new Error(`lookup table ${table.toBase58()} does not exist on this cluster`);
  if (!value.isActive()) throw new Error(`lookup table ${table.toBase58()} is deactivated; create a new one`);
  if (!value.state.authority?.equals(payer.publicKey)) {
    throw new Error(`lookup table ${table.toBase58()} is not owned by ${payer.publicKey.toBase58()}`);
  }
  present = new Set(value.state.addresses.map((key) => key.toBase58()));
} else {
  const recentSlot = await connection.getSlot("finalized");
  const [create, address] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot,
  });
  const signature = await send([create]);
  table = address;
  console.log(`created ${address.toBase58()} (${signature})`);
}

const seen = new Set(present);
const missing = wanted.filter((key) => {
  const id = key.toBase58();
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
});
const room = TABLE_CAPACITY - present.size;
const toAdd = missing.slice(0, room);
for (let i = 0; i < toAdd.length; i += EXTEND_CHUNK) {
  const chunk = toAdd.slice(i, i + EXTEND_CHUNK);
  const signature = await send([
    AddressLookupTableProgram.extendLookupTable({
      lookupTable: table,
      authority: payer.publicKey,
      payer: payer.publicKey,
      addresses: chunk,
    }),
  ]);
  console.log(`extended with ${chunk.length} (${signature})`);
}

const added = Math.min(missing.length, room);
console.log(
  added === 0
    ? `${table.toBase58()} already holds every launch address it has room for (${present.size})`
    : `${table.toBase58()} now holds ${present.size + added} addresses (${added} added); usable from the next slot`,
);
if (missing.length > room) console.warn(`${missing.length - room} addresses did not fit; those quotes launch without them`);
console.log(`LAUNCH_ALT=${table.toBase58()}`);
