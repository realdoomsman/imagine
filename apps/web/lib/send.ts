"use client";

import type { WalletContextState } from "@solana/wallet-adapter-react";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Signer,
  type VersionedMessage,
} from "@solana/web3.js";
import { PUMP_PROGRAM_ID, VISE_PROGRAM_ID, pumpCreatorVaultPda, rewardVaultPda } from "@vise/sdk";
import { post } from "./api.ts";

export interface BuiltTransaction {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  label?: string;
}

const PUMP_FEES_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const MAYHEM_PROGRAM_ID = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");

/** Every program a transaction the API builds may call directly. */
const ALLOWED_PROGRAMS = new Set(
  [
    ComputeBudgetProgram.programId,
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    VISE_PROGRAM_ID,
    PUMP_PROGRAM_ID,
    PUMP_FEES_PROGRAM_ID,
    PUMP_AMM_PROGRAM_ID,
    MAYHEM_PROGRAM_ID,
  ].map((key) => key.toBase58()),
);

/**
 * Check what the API asked this wallet to sign before the wallet sees it, so
 * a compromised or impersonated API cannot slip in a payment to itself.
 *
 * - the fee payer is `signer`;
 * - every instruction calls an allowlisted program;
 * - the only System Program instruction allowed is a transfer, and only into
 *   a VISE reward vault or the pump creator vault of a coin's fee-sharing
 *   config (the rent seed a launch sends), for a coin the transaction names.
 *
 * `lookupTables` resolves a v0 message's table-loaded keys; pass what
 * `fetchLookupTables` returns. Throws with the reason on the first violation.
 */
export function assertTransactionAllowed(
  message: VersionedMessage,
  lookupTables: AddressLookupTableAccount[],
  signer: PublicKey,
): void {
  const feePayer = message.staticAccountKeys[0];
  if (!feePayer?.equals(signer)) {
    throw new Error(`refusing to sign: the fee payer is ${feePayer?.toBase58() ?? "missing"}, not your wallet`);
  }
  const keys = message.getAccountKeys({ addressLookupTableAccounts: lookupTables });
  let destinations: Set<string> | null = null;
  for (const compiled of message.compiledInstructions) {
    const programId = keys.get(compiled.programIdIndex);
    if (!programId || !ALLOWED_PROGRAMS.has(programId.toBase58())) {
      throw new Error(`refusing to sign: the transaction calls an unexpected program ${programId?.toBase58() ?? "?"}`);
    }
    if (!programId.equals(SystemProgram.programId)) continue;

    const instruction = new TransactionInstruction({
      programId,
      data: Buffer.from(compiled.data),
      keys: compiled.accountKeyIndexes.map((index) => {
        const pubkey = keys.get(index);
        if (!pubkey) throw new Error("refusing to sign: an instruction names an account the transaction does not carry");
        return { pubkey, isSigner: message.isAccountSigner(index), isWritable: message.isAccountWritable(index) };
      }),
    });
    let kind: string;
    try {
      kind = SystemInstruction.decodeInstructionType(instruction);
    } catch {
      kind = "unknown";
    }
    if (kind !== "Transfer") {
      throw new Error(`refusing to sign: unexpected System Program instruction (${kind})`);
    }
    const { toPubkey, lamports } = SystemInstruction.decodeTransfer(instruction);
    destinations ??= allowedDestinations(keys.keySegments().flat());
    if (!destinations.has(toPubkey.toBase58())) {
      throw new Error(`refusing to sign: the transaction sends ${lamports} lamports to ${toPubkey.toBase58()}, which is not a VISE or pump vault`);
    }
  }
}

/**
 * Where a transfer may go: for every account the transaction names, taken as
 * a coin's mint, its VISE reward vault and the pump creator vault of its
 * fee-sharing config. The API only ever transfers to those for the coin it
 * is acting on, which the transaction always references.
 */
function allowedDestinations(candidates: PublicKey[]): Set<string> {
  const allowed = new Set<string>();
  for (const mint of candidates) {
    allowed.add(rewardVaultPda(mint).toBase58());
    const sharingConfig = PublicKey.findProgramAddressSync(
      [Buffer.from("sharing-config"), mint.toBuffer()],
      PUMP_FEES_PROGRAM_ID,
    )[0];
    allowed.add(pumpCreatorVaultPda(sharingConfig).toBase58());
  }
  return allowed;
}

/** The lookup tables a v0 message loads keys from; none for a legacy one. */
export async function fetchLookupTables(
  connection: Connection,
  message: VersionedMessage,
): Promise<AddressLookupTableAccount[]> {
  return Promise.all(
    message.addressTableLookups.map(async (lookup) => {
      const { value } = await connection.getAddressLookupTable(lookup.accountKey);
      if (!value) throw new Error(`lookup table ${lookup.accountKey.toBase58()} not found`);
      return value;
    }),
  );
}

/**
 * Sign and submit a transaction the API assembled.
 *
 * The API returns unsigned bytes, legacy or v0; they are checked with
 * `assertTransactionAllowed` before the wallet is asked. Confirmation is
 * awaited against the same blockhash the API used so a dropped transaction
 * surfaces as an error rather than a silent no-op.
 *
 * Shaped the way Phantom asks, because it blocks requests it cannot simulate
 * as "this dApp could be malicious": a transaction only the wallet signs goes
 * through `sendTransaction`, which Phantom serves with its own
 * signAndSendTransaction; one the browser co-signs (a fresh mint) is signed
 * by the wallet *first*, and only then by the keypairs, since a transaction
 * that arrives already carrying another signature is exactly what a drainer
 * sends.
 */
export async function signAndSend(
  connection: Connection,
  wallet: WalletContextState,
  built: BuiltTransaction,
  extraSigners: Signer[] = [],
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error("wallet cannot sign transactions");
  const bytes = Buffer.from(built.transaction, "base64");
  const versioned = VersionedTransaction.deserialize(bytes);
  // Every wallet signs a legacy Transaction; not all take a versioned one.
  const tx = versioned.version === "legacy" ? Transaction.from(bytes) : versioned;
  if (tx instanceof Transaction) {
    assertTransactionAllowed(tx.compileMessage(), [], wallet.publicKey);
  } else {
    assertTransactionAllowed(tx.message, await fetchLookupTables(connection, tx.message), wallet.publicKey);
  }

  let signature: string;
  if (extraSigners.length === 0) {
    signature = await wallet.sendTransaction(tx, connection, { maxRetries: 3 });
  } else {
    const signed = await wallet.signTransaction(tx);
    if (signed instanceof Transaction) signed.partialSign(...extraSigners);
    else signed.sign(extraSigners);
    signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
  }
  const result = await connection.confirmTransaction(
    {
      signature,
      blockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    },
    "confirmed",
  );
  if (result.value.err) {
    throw new Error(`transaction failed on chain: ${JSON.stringify(result.value.err)}`);
  }
  return signature;
}

/** Build on the API, then sign and send. One round trip per action. */
export async function buildAndSend(
  connection: Connection,
  wallet: WalletContextState,
  path: string,
  body: unknown,
): Promise<string> {
  const built = await post<BuiltTransaction>(path, body);
  return signAndSend(connection, wallet, built);
}
