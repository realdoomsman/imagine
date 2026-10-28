import { setTimeout as sleep } from "node:timers/promises";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
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

/** Jupiter Aggregator v6, the only program a swap instruction may target. */
export const JUPITER_V6_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const SYSTEM_TRANSFER = 2;
const TOKEN_CLOSE_ACCOUNT = 9;
const TOKEN_SYNC_NATIVE = 17;

/**
 * Refuse anything in a Jupiter answer beyond a SOL → quote swap for `user`.
 *
 * These instructions are signed by the server for account wallets, so a
 * compromised or misconfigured Jupiter endpoint must not be able to slip in a
 * transfer, an `Assign`, or a swap paying someone else. Allowed, exactly:
 *  - creating associated token accounts owned and paid for by the user (its
 *    WSOL and quote accounts, and the intermediate mints of a multi-hop
 *    route) — the user keeps them and their rent;
 *  - a System transfer from the user into the user's WSOL account, then
 *    `SyncNative` on it, and closing it back to the user;
 *  - the Jupiter v6 swap itself, whose only signer is the user and which
 *    writes the user's quote account (the swap's output).
 */
export function assertJupiterInstructions(
  instructions: readonly TransactionInstruction[],
  p: { user: PublicKey; quoteMint: PublicKey },
): void {
  const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, p.user, true, TOKEN_PROGRAM_ID);
  const quoteAtas = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((program) =>
    getAssociatedTokenAddressSync(p.quoteMint, p.user, true, program),
  );
  const refuse = (ix: TransactionInstruction, why: string): never => {
    throw new Error(`Jupiter returned an instruction this server will not sign (${ix.programId.toBase58()}: ${why})`);
  };
  const key = (ix: TransactionInstruction, index: number) => ix.keys[index]?.pubkey ?? PublicKey.default;
  let swaps = 0;

  for (const ix of instructions) {
    if (ix.programId.equals(ComputeBudgetProgram.programId)) continue;
    if (ix.programId.equals(SystemProgram.programId)) {
      if (ix.data.length !== 12 || ix.data.readUInt32LE(0) !== SYSTEM_TRANSFER) refuse(ix, "only a transfer");
      if (!key(ix, 0).equals(p.user) || !key(ix, 1).equals(wsol)) refuse(ix, "transfer must be into the user's WSOL account");
    } else if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (ix.data.length > 1 || (ix.data.length === 1 && ix.data[0]! > 1)) refuse(ix, "only create / create-idempotent");
      if (!key(ix, 0).equals(p.user) || !key(ix, 2).equals(p.user)) refuse(ix, "only accounts the user owns and pays for");
    } else if (ix.programId.equals(TOKEN_PROGRAM_ID) || ix.programId.equals(TOKEN_2022_PROGRAM_ID)) {
      const op = ix.data[0];
      if (op === TOKEN_SYNC_NATIVE && ix.data.length === 1) {
        if (!key(ix, 0).equals(wsol)) refuse(ix, "sync only the user's WSOL account");
      } else if (op === TOKEN_CLOSE_ACCOUNT && ix.data.length === 1) {
        if (!key(ix, 0).equals(wsol) || !key(ix, 1).equals(p.user) || !key(ix, 2).equals(p.user)) {
          refuse(ix, "close only the user's WSOL account, back to the user");
        }
      } else refuse(ix, `token instruction ${op} not allowed`);
    } else if (ix.programId.equals(JUPITER_V6_PROGRAM_ID)) {
      swaps += 1;
      if (ix.keys.some((meta) => meta.isSigner && !meta.pubkey.equals(p.user))) refuse(ix, "a signer other than the user");
      if (!ix.keys.some((meta) => meta.isWritable && quoteAtas.some((ata) => ata.equals(meta.pubkey)))) {
        refuse(ix, "the swap does not pay the user's quote account");
      }
    } else refuse(ix, "program not allowed");
  }
  if (swaps !== 1) throw new Error(`Jupiter returned ${swaps} swap instructions; expected exactly one`);
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
  // The quote is passed back verbatim and its threshold is what gets spent
  // next, so it must be the quote that was asked for.
  if (
    quoted.inputMint !== NATIVE_MINT.toBase58() ||
    quoted.outputMint !== p.quoteMint.toBase58() ||
    quoted.inAmount !== p.lamportsIn.toString() ||
    quoted.swapMode !== "ExactIn" ||
    quoted.slippageBps > p.slippageBps ||
    BigInt(quoted.otherAmountThreshold) > BigInt(quoted.outAmount)
  ) {
    throw new Error("Jupiter returned a quote for a different swap than the one requested");
  }
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
  assertJupiterInstructions(instructions, { user: p.user, quoteMint: p.quoteMint });
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
