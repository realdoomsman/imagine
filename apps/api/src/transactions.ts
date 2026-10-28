import {
  ComputeBudgetProgram,
  PACKET_DATA_SIZE,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from "@solana/web3.js";
import { env } from "./env.ts";
import { connection } from "./solana.ts";

export function budgetInstructions(microLamports: number, units = 300_000): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
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

/**
 * Whether the transaction, signatures included, fits in one packet: as v0
 * through `lookupTables` when given, else as a legacy transaction.
 */
export function fits(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  lookupTables: AddressLookupTableAccount[] = [],
): boolean {
  // The blockhash only has to be 32 bytes; any key will do for measuring.
  const blockhash = PublicKey.default.toBase58();
  try {
    if (lookupTables.length > 0) {
      return compileV0(instructions, payer, blockhash, lookupTables).serialize().length <= PACKET_DATA_SIZE;
    }
    const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight: 0 }).add(...instructions);
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= PACKET_DATA_SIZE;
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

/**
 * Serialise an unsigned transaction for the browser to sign.
 *
 * These routes never hold a key. They assemble instructions, set the payer and
 * a fresh blockhash, and hand the bytes back; the user's wallet is the signer.
 * (IMAGINE accounts — Google sign-in — go through /me/* instead, where the
 * server signs with the account's own wallet.)
 *
 * Legacy unless `lookupTables` is non-empty, in which case it is a v0
 * transaction resolved through them; every wallet signs a legacy one, so v0 is
 * used only where the bytes need it.
 */
export async function serialize(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  lookupTables: AddressLookupTableAccount[] = [],
): Promise<{ transaction: string; blockhash: string; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  let bytes: Uint8Array;
  if (lookupTables.length > 0) {
    bytes = compileV0(instructions, payer, blockhash, lookupTables).serialize();
  } else {
    const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
    tx.add(...instructions);
    bytes = tx.serialize({ requireAllSignatures: false });
  }
  return { transaction: Buffer.from(bytes).toString("base64"), blockhash, lastValidBlockHeight };
}

/**
 * The lookup tables a set of instructions needs: none when it fits as a
 * legacy transaction, else `candidates` (the launch table plus any a Jupiter
 * route brought). Throws when it fits neither way.
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
