/**
 * The address lookup table that lets a launch — imagine.launch (LaunchLab
 * initialize CPI), the dev buy and imagine.found — fit in one transaction.
 * Without it the three overrun the 1232-byte packet and the launch is split,
 * exposing the dev buy to anyone buying in between. Trades use it too when
 * they would not fit as a legacy transaction.
 *
 *   RPC_URL=… node scripts/create-alt.ts <payer.json>             # a NEW table
 *   RPC_URL=… node scripts/create-alt.ts <payer.json> <table>     # append to a table you own
 *   RPC_URL=… node scripts/create-alt.ts <authority.json> --close <table>
 *
 * The table holds every account of a launch or trade that does not depend on
 * the coin or the creator:
 *  - programs: IMAGINE, LaunchLab, CPMM, Token, Token-2022, associated token,
 *    system, compute budget;
 *  - IMAGINE's config and treasury; LaunchLab's authority and event
 *    authority; the IMAGINE LaunchLab PlatformConfig (the config's
 *    `launchlab_platform`); CPMM's authority and the platform's
 *    `cpswap_config`;
 *  - per quote: its mint, its LaunchLab GlobalConfig, and the platform's fee
 *    vault for it ([platform, quote] under LaunchLab, which every curve trade
 *    passes).
 * A table holds at most 256 addresses, so quotes go in SOL first, then
 * stablecoins, ETFs, stocks, commodities, crypto, until it is full.
 *
 * `--close <table>` recovers a retired table's rent: the first run
 * deactivates it; run the same command again once the deactivation has
 * cooled down (~512 slots, a few minutes) to close it and refund the rent to
 * the authority.
 *
 * Prints the address to set as LAUNCH_ALT on the API.
 */
import { readFileSync } from "node:fs";
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
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
  decodePlatformConfig,
  IMAGINE_PROGRAM_ID,
  ImagineClient,
  LAUNCHLAB_PROGRAM_ID,
  launchLabAuthorityPda,
  launchLabEventAuthorityPda,
  platformFeeVaultPda,
  QUOTES,
} from "@imagine/sdk";

/** Addresses per extend transaction; 20 keeps it well inside a legacy packet. */
const EXTEND_CHUNK = 20;
const TABLE_CAPACITY = 256;

const args = process.argv.slice(2);
const keypairPath = args[0];
if (!keypairPath) {
  console.error("usage: node scripts/create-alt.ts <payer.json> [table | --close <table>]");
  process.exit(1);
}
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]));
const connection = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8999", "confirmed");

async function send(instructions: TransactionInstruction[]): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer], { commitment: "confirmed" });
}

const closeIndex = args.indexOf("--close");
if (closeIndex >= 0) {
  const target = new PublicKey(args[closeIndex + 1] ?? "");
  const { value } = await connection.getAddressLookupTable(target);
  if (!value) throw new Error(`lookup table ${target.toBase58()} does not exist`);
  if (!value.state.authority?.equals(payer.publicKey)) throw new Error(`${payer.publicKey.toBase58()} is not the table's authority`);
  const rent = await connection.getBalance(target);
  if (value.isActive()) {
    const signature = await send([AddressLookupTableProgram.deactivateLookupTable({ lookupTable: target, authority: payer.publicKey })]);
    console.log(`deactivated ${target.toBase58()} (${signature}); re-run with --close after ~512 slots to close it and recover ${rent / LAMPORTS_PER_SOL} SOL`);
  } else {
    try {
      const signature = await send([
        AddressLookupTableProgram.closeLookupTable({ lookupTable: target, authority: payer.publicKey, recipient: payer.publicKey }),
      ]);
      console.log(`closed ${target.toBase58()} (${signature}); ${rent / LAMPORTS_PER_SOL} SOL returned to ${payer.publicKey.toBase58()}`);
    } catch (error) {
      console.error(`${target.toBase58()} is still cooling down after deactivation; try again in a few minutes`);
      throw error;
    }
  }
  process.exit(0);
}

const config = await new ImagineClient(connection).fetchConfig();
if (!config) throw new Error("IMAGINE config is not initialised on this cluster; run scripts/init-config.ts first");
const platformAddress = config.launchlabPlatform;
const platformInfo = await connection.getAccountInfo(platformAddress);
if (!platformInfo) throw new Error(`the config's LaunchLab platform ${platformAddress.toBase58()} does not exist here`);
const platform = decodePlatformConfig(platformInfo.data);

const common = [
  IMAGINE_PROGRAM_ID,
  configPda(),
  config.treasury,
  LAUNCHLAB_PROGRAM_ID,
  launchLabAuthorityPda(),
  launchLabEventAuthorityPda(),
  platformAddress,
  CPMM_PROGRAM_ID,
  cpmmAuthorityPda(),
  platform.cpswapConfig,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SystemProgram.programId,
  ComputeBudgetProgram.programId,
];

// Table membership comes from the registry alone: a launch needs these accounts
// whatever Jupiter says about prices right now.
const CATEGORY_ORDER = ["currencies", "etfs", "stocks", "commodities", "crypto"];
const rank = (mint: string, category: string) =>
  mint === NATIVE_MINT.toBase58() ? -1 : CATEGORY_ORDER.indexOf(category) + 1 || 99;
const quotes = [...QUOTES].sort((a, b) => rank(a.mint, a.category) - rank(b.mint, b.category));

const wanted: PublicKey[] = [...common];
for (const quote of quotes) {
  if (wanted.length + 3 > TABLE_CAPACITY) break;
  const mint = new PublicKey(quote.mint);
  wanted.push(mint, new PublicKey(quote.globalConfig), platformFeeVaultPda(platformAddress, mint, LAUNCHLAB_PROGRAM_ID));
}

const existingArg = args[1];
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

const rent = await connection.getBalance(table, "confirmed");
console.log(
  toAdd.length === 0
    ? `${table.toBase58()} already holds every launch address it has room for (${present.size})`
    : `${table.toBase58()} now holds ${present.size + toAdd.length} addresses (${toAdd.length} added); usable from the next slot`,
);
console.log(`table rent: ${rent / LAMPORTS_PER_SOL} SOL`);
if (missing.length > room) console.warn(`${missing.length - room} addresses did not fit; those quotes launch without them`);
console.log(`LAUNCH_ALT=${table.toBase58()}`);
