"use client";

import type { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, Transaction, type Signer } from "@solana/web3.js";
import { post } from "./api.ts";

export interface BuiltTransaction {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  label?: string;
}

/**
 * Sign and submit a transaction the API assembled.
 *
 * The API returns unsigned bytes; the wallet is the only thing that signs, and
 * confirmation is awaited against the same blockhash the API used so a dropped
 * transaction surfaces as an error rather than a silent no-op.
 */
export async function signAndSend(
  connection: Connection,
  wallet: WalletContextState,
  built: BuiltTransaction,
  extraSigners: Signer[] = [],
): Promise<string> {
  if (!wallet.signTransaction) throw new Error("wallet cannot sign transactions");
  const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
  // Keypairs the browser owns (a fresh mint, for instance) sign before the
  // wallet, so the wallet's signature covers the final message.
  if (extraSigners.length > 0) tx.partialSign(...extraSigners);
  const signed = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    maxRetries: 3,
  });
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
