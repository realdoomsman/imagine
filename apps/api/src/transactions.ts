import {
  ComputeBudgetProgram,
  PACKET_DATA_SIZE,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type VersionedMessage,
} from "@solana/web3.js";
import { env } from "./env.ts";
import { ActionError, friendlyChainError } from "./errors.ts";
import { connection, timedFetch } from "./solana.ts";

/** The runtime's ceilings: what an unsized budget asks for while it is simulated. */
export const MAX_COMPUTE_UNITS = 1_400_000;
export const MAX_LOADED_ACCOUNTS_DATA_BYTES = 64 * 1024 * 1024;

// Compute Budget program instruction tags (one u8, then the u32 value).
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 4;

/** Room above a simulation's compute: 15%, and never less than 5,000 CU. */
const COMPUTE_HEADROOM = 1.15;
const COMPUTE_MIN_HEADROOM = 5_000;
/** Room above a simulation's loaded account data: 20%, rounded up to whole 32 KiB pages. */
const DATA_HEADROOM = 1.2;
const DATA_PAGE_BYTES = 32 * 1024;

/** web3.js 1.x has no builder for SetLoadedAccountsDataSizeLimit. */
function setLoadedAccountsDataSizeLimit(bytes: number): TransactionInstruction {
  const data = Buffer.alloc(5);
  data.writeUInt8(SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT, 0);
  data.writeUInt32LE(bytes, 1);
  return new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data });
}

/**
 * A user transaction's compute budget: its priority fee, and compute-unit and
 * loaded-account-data limits at the runtime's ceilings until `prepare` sizes
 * them from a simulation. Wallets (Phantom above all) refuse to vouch for a
 * transaction whose limits are left implicit.
 */
export function budgetInstructions(microLamports: number): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    setLoadedAccountsDataSizeLimit(MAX_LOADED_ACCOUNTS_DATA_BYTES),
  ];
}

/** A fixed compute budget, for the keeper's own cranks (no wallet sees them). */
export function fixedBudget(microLamports: number, units: number): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
}

/** The compute-unit limit for a simulation that consumed `consumed`. */
export function computeUnitLimit(consumed: number): number {
  const padded = Math.max(Math.ceil(consumed * COMPUTE_HEADROOM), consumed + COMPUTE_MIN_HEADROOM);
  return Math.min(MAX_COMPUTE_UNITS, Math.ceil(padded / 1_000) * 1_000);
}

/** The loaded-account-data limit for a simulation that loaded `loaded` bytes. */
export function loadedAccountsDataLimit(loaded: number): number {
  const padded = Math.ceil(Math.ceil(loaded * DATA_HEADROOM) / DATA_PAGE_BYTES) * DATA_PAGE_BYTES;
  return Math.min(MAX_LOADED_ACCOUNTS_DATA_BYTES, Math.max(DATA_PAGE_BYTES, padded));
}

/**
 * The instruction data where a v0 message sets its compute-unit and
 * loaded-data limits, to rewrite in place. Throws unless it sets each exactly
 * once. (A legacy message rebuilds its instructions on every read, so it
 * cannot be rewritten this way.)
 */
function limitSlots(message: VersionedMessage): { units: Uint8Array; data: Uint8Array } {
  if (message.version !== 0) throw new ActionError(400, "only v0 transactions are sized");
  let units: Uint8Array | null = null;
  let data: Uint8Array | null = null;
  for (const ix of message.compiledInstructions) {
    if (!message.staticAccountKeys[ix.programIdIndex]?.equals(ComputeBudgetProgram.programId)) continue;
    if (ix.data.length !== 5) continue;
    if (ix.data[0] === SET_COMPUTE_UNIT_LIMIT) {
      if (units) throw new ActionError(400, "the transaction sets its compute-unit limit twice");
      units = ix.data;
    } else if (ix.data[0] === SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT) {
      if (data) throw new ActionError(400, "the transaction sets its loaded-account-data limit twice");
      data = ix.data;
    }
  }
  if (!units || !data) throw new ActionError(400, "the transaction is missing its compute-unit or loaded-account-data limit");
  return { units, data };
}

const writeU32 = (bytes: Uint8Array, value: number) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).writeUInt32LE(value, 1);

interface Simulation {
  err: unknown;
  logs: string[] | null;
  unitsConsumed?: number;
  loadedAccountsDataSize?: number;
}

/**
 * simulateTransaction straight over JSON-RPC: web3.js 1.x drops
 * `loadedAccountsDataSize` from the response.
 */
async function simulate(tx: VersionedTransaction): Promise<Simulation> {
  const response = await timedFetch(connection.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateTransaction",
      params: [
        Buffer.from(tx.serialize()).toString("base64"),
        { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" },
      ],
    }),
  });
  const body = (await response.json()) as { result?: { value: Simulation }; error?: { message: string } };
  if (!body.result) throw new Error(`simulateTransaction: ${body.error?.message ?? response.statusText}`);
  return body.result.value;
}

/** What sizing found: the simulation's figures and the limits written from them. */
export interface Sized {
  unitsConsumed: number;
  loadedAccountsDataSize: number;
  computeUnitLimit: number;
  loadedAccountsDataLimit: number;
}

/**
 * Simulate `message` (signatures unchecked, blockhash replaced) at the
 * runtime's ceilings, refuse it with the program's reason when it fails, and
 * otherwise rewrite its compute-unit and loaded-account-data limits, in
 * place, to what it used plus headroom. Rewriting two u32s leaves the
 * message's size and every other byte as they were.
 */
export async function fitBudget(message: VersionedMessage): Promise<Sized> {
  const slots = limitSlots(message);
  writeU32(slots.units, MAX_COMPUTE_UNITS);
  writeU32(slots.data, MAX_LOADED_ACCOUNTS_DATA_BYTES);
  const simulation = await simulate(new VersionedTransaction(message));
  if (simulation.err) {
    const logs = simulation.logs?.join("\n") ?? "";
    throw new ActionError(409, friendlyChainError(`this transaction would fail: ${JSON.stringify(simulation.err)}\nLogs:\n${logs}`));
  }
  if (simulation.unitsConsumed === undefined || simulation.loadedAccountsDataSize === undefined) {
    throw new Error("the RPC node's simulation reports no compute or loaded account data; it is too old to size a transaction");
  }
  const sized = {
    unitsConsumed: simulation.unitsConsumed,
    loadedAccountsDataSize: simulation.loadedAccountsDataSize,
    computeUnitLimit: computeUnitLimit(simulation.unitsConsumed),
    loadedAccountsDataLimit: loadedAccountsDataLimit(simulation.loadedAccountsDataSize),
  };
  writeU32(slots.units, sized.computeUnitLimit);
  writeU32(slots.data, sized.loadedAccountsDataLimit);
  return sized;
}

/** An unsigned v0 transaction; `lookupTables` may be empty. */
export function compileV0(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  blockhash: string,
  lookupTables: AddressLookupTableAccount[],
): VersionedTransaction {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions });
  return new VersionedTransaction(message.compileToV0Message(lookupTables));
}

/** Whether the v0 transaction, signatures included, fits in one packet through `lookupTables`. */
export function fits(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  lookupTables: AddressLookupTableAccount[] = [],
): boolean {
  // The blockhash only has to be 32 bytes; any key will do for measuring.
  const blockhash = PublicKey.default.toBase58();
  try {
    return compileV0(instructions, payer, blockhash, lookupTables).serialize().length <= PACKET_DATA_SIZE;
  } catch {
    return false; // web3.js throws while encoding anything that overruns the packet
  }
}

const LOOKUP_TABLE_TTL_MS = 5 * 60_000;
let lookupTableCache: { at: number; table: AddressLookupTableAccount | null } | null = null;

/**
 * The launch lookup table named by `LAUNCH_ALT`, or null when it is unset,
 * missing, or being deactivated. Refreshed every few minutes so an operator
 * extending it is picked up without a restart; a table is append-only, so a
 * cached copy never resolves an index to the wrong key.
 */
export async function launchLookupTable(): Promise<AddressLookupTableAccount | null> {
  if (!env.launchAlt) return null;
  if (lookupTableCache && Date.now() - lookupTableCache.at < LOOKUP_TABLE_TTL_MS) return lookupTableCache.table;
  const { value } = await connection.getAddressLookupTable(env.launchAlt);
  const table = value && value.isActive() ? value : null;
  if (!table) console.warn(`LAUNCH_ALT ${env.launchAlt.toBase58()} is not an active lookup table`);
  lookupTableCache = { at: Date.now(), table };
  return table;
}

/** An unsigned transaction for a wallet to sign, base64. */
export interface Unsigned {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  /**
   * Not yet simulated or sized: it spends what an earlier step of the same
   * plan produces. Pass it through POST /tx/prepare once that step has landed.
   */
  deferred?: true;
}

/**
 * A fresh blockhash and a budget sized from a simulation, for a message the
 * API built (or a deferred one coming back through /tx/prepare). Throws an
 * ActionError with the program's reason when the simulation fails, so a
 * transaction that cannot land never reaches a wallet.
 */
export async function prepare(message: VersionedMessage): Promise<Unsigned> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  message.recentBlockhash = blockhash;
  await fitBudget(message);
  return { transaction: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"), blockhash, lastValidBlockHeight };
}

/**
 * Serialise an unsigned v0 transaction for the browser to sign.
 *
 * These routes never hold a key. They assemble instructions, set the payer and
 * a fresh blockhash, size the compute budget from a simulation, and hand the
 * bytes back; the user's wallet is the signer. (IMAGINE accounts — Google
 * sign-in — go through /me/* instead, where the server signs with the
 * account's own wallet.)
 *
 * `deferred` skips the simulation for a step that depends on an earlier one
 * landing first; its budget stays at the ceilings until /tx/prepare sizes it.
 */
export async function serialize(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  lookupTables: AddressLookupTableAccount[] = [],
  deferred = false,
): Promise<Unsigned> {
  if (!deferred) return prepare(compileV0(instructions, payer, PublicKey.default.toBase58(), lookupTables).message);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = compileV0(instructions, payer, blockhash, lookupTables);
  return { transaction: Buffer.from(tx.serialize()).toString("base64"), blockhash, lastValidBlockHeight, deferred: true };
}

/**
 * The lookup tables a set of instructions needs: none when it fits without
 * any, else `candidates` (the launch table plus any a Jupiter route brought).
 * Throws when it fits neither way.
 */
export function tablesFor(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  candidates: AddressLookupTableAccount[],
): AddressLookupTableAccount[] {
  if (fits(instructions, payer)) return [];
  if (candidates.length > 0 && fits(instructions, payer, candidates)) return candidates;
  throw new Error("transaction does not fit in one packet");
}
