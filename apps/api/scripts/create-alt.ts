/**
 * Create (or top up) the address lookup table that lets a launch's create_v2
 * and dev buy share one transaction. Without it that pair is ~1457 bytes, over
 * the 1232-byte packet limit, and the dev buy has to follow in its own
 * transaction where bots can buy ahead of it.
 *
 * Usage: RPC_URL=… node scripts/create-alt.ts <payer-keypair.json> [existing-table]
 *
 * The table holds every account of create_v2 + buy_v2 that does not depend on
 * the mint or the creator: pump's programs and globals, the fee program and
 * its config, event authorities, the mayhem accounts, every fee and buyback
 * recipient with its WSOL account, and the token/system programs. They are
 * found by building the launch instructions for two unrelated mint/creator
 * pairs many times over (the fee recipients are picked at random per build)
 * and keeping what the two sets share, so the list follows pump-sdk rather
 * than a hand-kept copy.
 *
 * Idempotent: pass the table (argument or LAUNCH_ALT) and it only appends
 * what is missing; a table is append-only, so existing entries never move.
 * Prints the address to set as LAUNCH_ALT on the API.
 */
import { readFileSync } from "node:fs";
import { BN } from "@coral-xyz/anchor";
import { NATIVE_MINT, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { createAndBuyInstructions, onlinePump } from "../src/pump.ts";
import { connection } from "../src/solana.ts";

/** Addresses per extend transaction; 20 keeps it well inside a legacy packet. */
const EXTEND_CHUNK = 20;
/** Builds per mint/creator pair; enough to draw every randomly chosen recipient. */
const SAMPLES = 200;

const keypairPath = process.argv[2];
if (!keypairPath) {
  console.error("usage: node scripts/create-alt.ts <payer-keypair.json> [existing-table]");
  process.exit(1);
}
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]),
);
const existingArg = process.argv[3] ?? process.env.LAUNCH_ALT;

const global = await onlinePump.fetchGlobal();

async function launchKeys(): Promise<Set<string>> {
  const mint = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const keys = new Set<string>();
  for (let i = 0; i < SAMPLES; i += 1) {
    const instructions = await createAndBuyInstructions({
      global,
      mint,
      creator,
      name: "x",
      symbol: "x",
      uri: "https://x",
      devBuyLamports: 1_000_000_000n,
      tokensOut: new BN(1),
    });
    for (const ix of instructions) {
      keys.add(ix.programId.toBase58());
      for (const meta of ix.keys) if (!meta.isSigner) keys.add(meta.pubkey.toBase58());
    }
  }
  return keys;
}

const [a, b] = await Promise.all([launchKeys(), launchKeys()]);
const wanted = new Set([...a].filter((key) => b.has(key)));
// Every fee recipient pump's global lists, drawn or not, with its WSOL account.
for (const recipient of [global.feeRecipient, ...global.feeRecipients]) {
  wanted.add(recipient.toBase58());
  wanted.add(getAssociatedTokenAddressSync(NATIVE_MINT, recipient, true, TOKEN_PROGRAM_ID).toBase58());
}

async function send(instructions: TransactionInstruction[]): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer], {
    commitment: "confirmed",
  });
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

const missing = [...wanted].filter((key) => !present.has(key)).map((key) => new PublicKey(key));
for (let i = 0; i < missing.length; i += EXTEND_CHUNK) {
  const chunk = missing.slice(i, i + EXTEND_CHUNK);
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

console.log(
  missing.length === 0
    ? `${table.toBase58()} already holds all ${wanted.size} launch addresses`
    : `${table.toBase58()} now holds ${present.size + missing.length} addresses (${missing.length} added); usable from the next slot`,
);
console.log(`LAUNCH_ALT=${table.toBase58()}`);
