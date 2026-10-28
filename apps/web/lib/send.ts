"use client";

import type { WalletContextState } from "@solana/wallet-adapter-react";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
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
import { CPMM_PROGRAM_ID, IMAGINE_PROGRAM_ID, LAUNCHLAB_PROGRAM_ID, rewardVaultPda } from "@imagine/sdk";
import { post } from "./api.ts";

export interface BuiltTransaction {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  label?: string;
}

/** Jupiter's v6 aggregator: the optional "pay with SOL" leg that swaps SOL into the pair asset. */
const JUPITER_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

/** Every program a transaction the API builds may call directly. */
const ALLOWED_PROGRAMS = new Set(
  [
    ComputeBudgetProgram.programId,
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    IMAGINE_PROGRAM_ID,
    LAUNCHLAB_PROGRAM_ID,
    CPMM_PROGRAM_ID,
    JUPITER_PROGRAM_ID,
  ].map((key) => key.toBase58()),
);

const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);

// SPL Token / Token-2022 instruction tags that move or give away a holder's
// tokens. Everything else the API sends (account creation, SyncNative…) is
// harmless to the signer.
const TOKEN_TRANSFER = 3;
const TOKEN_APPROVE = 4;
const TOKEN_SET_AUTHORITY = 6;
const TOKEN_BURN = 8;
const TOKEN_CLOSE_ACCOUNT = 9;
const TOKEN_TRANSFER_CHECKED = 12;
const TOKEN_APPROVE_CHECKED = 13;
const TOKEN_BURN_CHECKED = 15;
/** Token-2022 TransferFee extension; sub-instruction 1 is TransferCheckedWithFee. */
const TOKEN_TRANSFER_FEE_EXTENSION = 26;

/**
 * Check what the API asked this wallet to sign before the wallet sees it, so
 * a compromised or impersonated API cannot slip in a payment to itself.
 *
 * - the fee payer is `signer`;
 * - every instruction calls an allowlisted program;
 * - the only System Program instruction allowed is a transfer, and only into
 *   the signer's own wrapped-SOL account (wrapping for a SOL-paired trade) or
 *   an IMAGINE reward vault for a coin the transaction names;
 * - a token transfer may only land in an account the signer owns or in an
 *   IMAGINE reward token account for a coin the transaction names; approvals,
 *   authority changes and direct burns are refused, and closing an account
 *   must return its rent to the signer.
 *
 * Swaps, locks and claims move funds inside the programs; none of that is a
 * top-level instruction, so none of it is affected.
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
  // Reward vaults of every account named, read as a coin mint; built once, on demand.
  let vaults: PublicKey[] | null = null;
  const rewardVaults = () => (vaults ??= keys.keySegments().flat().map((mint) => rewardVaultPda(mint)));

  for (const compiled of message.compiledInstructions) {
    const programId = keys.get(compiled.programIdIndex);
    if (!programId || !ALLOWED_PROGRAMS.has(programId.toBase58())) {
      throw new Error(`refusing to sign: the transaction calls an unexpected program ${programId?.toBase58() ?? "?"}`);
    }
    const accounts = compiled.accountKeyIndexes.map((index) => {
      const pubkey = keys.get(index);
      if (!pubkey) throw new Error("refusing to sign: an instruction names an account the transaction does not carry");
      return pubkey;
    });

    if (programId.equals(SystemProgram.programId)) {
      const instruction = new TransactionInstruction({
        programId,
        data: Buffer.from(compiled.data),
        keys: compiled.accountKeyIndexes.map((index, position) => ({
          pubkey: accounts[position],
          isSigner: message.isAccountSigner(index),
          isWritable: message.isAccountWritable(index),
        })),
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
      const ownWrappedSol = getAssociatedTokenAddressSync(NATIVE_MINT, signer, true, TOKEN_PROGRAM_ID);
      if (!toPubkey.equals(ownWrappedSol) && !rewardVaults().some((vault) => vault.equals(toPubkey))) {
        throw new Error(
          `refusing to sign: the transaction sends ${lamports} lamports to ${toPubkey.toBase58()}, which is neither your wrapped-SOL account nor an IMAGINE reward vault`,
        );
      }
      continue;
    }

    if (!TOKEN_PROGRAMS.has(programId.toBase58())) continue;
    const data = compiled.data;
    const tag = data[0];
    if (tag === TOKEN_APPROVE || tag === TOKEN_APPROVE_CHECKED || tag === TOKEN_SET_AUTHORITY) {
      throw new Error("refusing to sign: the transaction hands control of a token account to someone else");
    }
    if (tag === TOKEN_BURN || tag === TOKEN_BURN_CHECKED) {
      throw new Error("refusing to sign: the transaction burns tokens directly");
    }
    if (tag === TOKEN_CLOSE_ACCOUNT) {
      if (!accounts[1]?.equals(signer)) {
        throw new Error(`refusing to sign: the transaction closes a token account into ${accounts[1]?.toBase58() ?? "?"}, not your wallet`);
      }
      continue;
    }
    // [source, destination, owner] for a plain transfer; [source, mint,
    // destination, owner] for the checked forms.
    let destination: PublicKey | undefined;
    let mint: PublicKey | undefined;
    if (tag === TOKEN_TRANSFER) {
      destination = accounts[1];
    } else if (tag === TOKEN_TRANSFER_CHECKED || (tag === TOKEN_TRANSFER_FEE_EXTENSION && data[1] === 1)) {
      mint = accounts[1];
      destination = accounts[2];
    } else {
      continue;
    }
    if (!destination || !mint) {
      // A plain transfer does not name its mint, so where it lands cannot be checked.
      throw new Error("refusing to sign: the transaction makes an unchecked token transfer");
    }
    const ownAccount = getAssociatedTokenAddressSync(mint, signer, true, programId);
    const toRewardAccount = rewardVaults().some((vault) =>
      getAssociatedTokenAddressSync(mint, vault, true, programId).equals(destination),
    );
    if (!destination.equals(ownAccount) && !toRewardAccount) {
      throw new Error(
        `refusing to sign: the transaction sends tokens to ${destination.toBase58()}, which is neither yours nor an IMAGINE reward account`,
      );
    }
  }
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
 * `extraSigners` are offered, not forced: each signs only if the message
 * requires its signature (a launch's mint keypair signs the launch, not the
 * SOL→pair swap ahead of it).
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
  const message = tx instanceof Transaction ? tx.compileMessage() : tx.message;
  assertTransactionAllowed(
    message,
    tx instanceof Transaction ? [] : await fetchLookupTables(connection, tx.message),
    wallet.publicKey,
  );
  const required = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
  const cosigners = extraSigners.filter((signer) => required.some((key) => key.equals(signer.publicKey)));

  let signature: string;
  if (cosigners.length === 0) {
    signature = await wallet.sendTransaction(tx, connection, { maxRetries: 3 });
  } else {
    const signed = await wallet.signTransaction(tx);
    if (signed instanceof Transaction) signed.partialSign(...cosigners);
    else signed.sign(cosigners);
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
