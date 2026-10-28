import { setTimeout as sleep } from "node:timers/promises";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import { env } from "./env.ts";
import { connection } from "./solana.ts";

/**
 * Jupiter Swap API (v1), for paying in SOL on a coin paired with something
 * else: a SOL → quote swap whose instructions run in the same (v0)
 * transaction right before the LaunchLab buy, or as the step before a
 * launch. Jupiter's compute-budget instructions are dropped; the caller sets
 * its own.
 */

/** Jupiter's quote response, passed back verbatim to `swap-instructions`. */
export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  /** ExactIn: minimum output after slippage. */
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  priceImpactPct: string;
  [key: string]: unknown;
}

interface ApiInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

interface SwapInstructionsResponse {
  setupInstructions?: ApiInstruction[];
  swapInstruction: ApiInstruction;
  cleanupInstruction?: ApiInstruction | null;
  otherInstructions?: ApiInstruction[];
  addressLookupTableAddresses?: string[];
  error?: string;
}

export interface JupiterSwap {
  quote: JupiterQuote;
  /** Setup (ATA creation, SOL wrap), the swap, and cleanup (unwrap), in order. */
  instructions: TransactionInstruction[];
  /** Lookup tables the swap needs in a v0 message. */
  lookupTables: AddressLookupTableAccount[];
  /** Expected output (raw). */
  outAmount: bigint;
  /** Output guaranteed after slippage (raw): what to spend after the swap. */
  minOutAmount: bigint;
}

function toInstruction(ix: ApiInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, "base64"),
  });
}

function headers(json: boolean): Record<string, string> {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(env.jupiterApiKey ? { "x-api-key": env.jupiterApiKey } : {}),
  };
}

/** Retries of a rate-limited (429) request, backing off 1 s, 2 s, 4 s: the keyless API limits bursts. */
const RETRIES = 3;

async function jupiterFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (response.status !== 429 || attempt >= RETRIES) return response;
    await response.body?.cancel();
    await sleep(1_000 * 2 ** attempt);
  }
}

/** Exact-in quote of `amount` raw `inputMint` into `outputMint`. */
async function quote(p: {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: bigint;
  slippageBps: number;
  maxAccounts?: number;
}): Promise<JupiterQuote> {
  const query = new URLSearchParams({
    inputMint: p.inputMint.toBase58(),
    outputMint: p.outputMint.toBase58(),
    amount: p.amount.toString(),
    slippageBps: String(p.slippageBps),
    swapMode: "ExactIn",
  });
  // Room for the LaunchLab / IMAGINE instructions that follow in the same transaction.
  if (p.maxAccounts) query.set("maxAccounts", String(p.maxAccounts));
  const response = await jupiterFetch(`${env.jupiterSwapUrl}/quote?${query}`, { headers: headers(false) });
  const body = (await response.json()) as JupiterQuote & { error?: string };
  if (!response.ok || body.error) throw new Error(`Jupiter quote failed: ${body.error ?? response.status}`);
  return body;
}

/**
 * SOL → `quoteMint` for `user`, spending `lamportsIn` native SOL; the output
 * lands in the user's ATA (created if missing). Spend `minOutAmount` after it:
 * the swap guarantees at least that, and any surplus stays in the wallet.
 */
export async function swapSolToQuote(p: {
  user: PublicKey;
  quoteMint: PublicKey;
  lamportsIn: bigint;
  slippageBps: number;
  maxAccounts?: number;
}): Promise<JupiterSwap> {
  if (p.quoteMint.equals(NATIVE_MINT)) throw new Error("a SOL-paired coin is bought with SOL directly");
  const quoted = await quote({
    inputMint: NATIVE_MINT,
    outputMint: p.quoteMint,
    amount: p.lamportsIn,
    slippageBps: p.slippageBps,
    maxAccounts: p.maxAccounts,
  });
  const response = await jupiterFetch(`${env.jupiterSwapUrl}/swap-instructions`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({
      userPublicKey: p.user.toBase58(),
      quoteResponse: quoted,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: false,
    }),
  });
  const body = (await response.json()) as SwapInstructionsResponse;
  if (!response.ok || body.error) throw new Error(`Jupiter swap-instructions failed: ${body.error ?? response.status}`);
  const instructions = [
    ...(body.setupInstructions ?? []),
    body.swapInstruction,
    ...(body.cleanupInstruction ? [body.cleanupInstruction] : []),
    ...(body.otherInstructions ?? []),
  ]
    .map(toInstruction)
    .filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  const tables = await Promise.all(
    (body.addressLookupTableAddresses ?? []).map((address) =>
      connection.getAddressLookupTable(new PublicKey(address), { commitment: "confirmed" }),
    ),
  );
  return {
    quote: quoted,
    instructions,
    lookupTables: tables.flatMap((table) => (table.value ? [table.value] : [])),
    outAmount: BigInt(quoted.outAmount),
    minOutAmount: BigInt(quoted.otherAmountThreshold),
  };
}
