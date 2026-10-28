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
  TransactionInstruction,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Signer,
  type VersionedMessage,
} from "@solana/web3.js";
import {
  CPMM_PROGRAM_ID,
  creatorFeeVaultPda,
  IMAGINE_IDL,
  IMAGINE_PROGRAM_ID,
  LAUNCHLAB_PROGRAM_ID,
  poolPda,
  positionPda,
  rewardVaultPda,
} from "@imagine/sdk";
import { post } from "./api.ts";

export interface BuiltTransaction {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  label?: string;
  /** Not yet simulated or sized: it spends what the step before it produces (see `signAndSend`). */
  deferred?: boolean;
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

/** Associated Token Account program: Create (empty data or 0) and CreateIdempotent (1); [payer, ata, wallet, mint, …]. */
const ATA_CREATE_TAGS = new Set([undefined, 0, 1]);

const hex = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 8)).toString("hex");

// Compute Budget instructions: a u8 tag, then the value.
const BUDGET_UNIT_LIMIT = 2; // u32 compute units
const BUDGET_UNIT_PRICE = 3; // u64 micro-lamports per compute unit
const BUDGET_DATA_LIMIT = 4; // u32 bytes of loaded account data
/** The runtime's ceilings. A loaded-data limit at its ceiling is one the API never sized. */
const MAX_COMPUTE_UNITS = 1_400_000;
const MAX_LOADED_ACCOUNTS_DATA_BYTES = 64 * 1024 * 1024;
/** The highest compute-unit price the API takes (its request schema's maximum). */
const MAX_COMPUTE_UNIT_PRICE = 10_000_000n;
/** The most priority fee one transaction may cost the signer: 0.01 SOL. */
const MAX_PRIORITY_FEE_LAMPORTS = 10_000_000n;

/**
 * The IMAGINE instructions a wallet signs through the site, by Anchor
 * discriminator from the SDK's IDL. Admin instructions (config, admin
 * transfer) and the creator/treasury claims never come from here.
 */
const IMAGINE_USER_INSTRUCTIONS = new Map(
  (IMAGINE_IDL.instructions ?? [])
    .filter((ix) =>
      [
        "launch",
        "found",
        "lock",
        "increase",
        "extend",
        "claim",
        "harvest",
        "renounce",
        "lock_forever",
        "unlock",
        "early_unlock",
        "deposit_reward",
        "collect_creator_fee",
        "sync",
      ].includes(ix.name),
    )
    .map((ix) => [hex(Uint8Array.from(ix.discriminator)), ix.name]),
);

// Raydium LaunchLab curve trades: [amount_in u64, minimum_amount_out u64, share_fee_rate u64].
const LAUNCHLAB_BUY_EXACT_IN = "faea0d7bd59c13ec";
const LAUNCHLAB_SELL_EXACT_IN = "9527de9bd37c981a";
// Raydium CPMM swap_base_input: [amount_in u64, minimum_amount_out u64].
const CPMM_SWAP_BASE_INPUT = "8fbe5adac41e33de";
// Jupiter v6 exact-in routes; both end in [in_amount u64, quoted_out_amount u64, slippage_bps u16, platform_fee_bps u8].
const JUPITER_ROUTE = "e517cb977ae3ad2a";
const JUPITER_SHARED_ACCOUNTS_ROUTE = "c1209b3341d69c81";

/**
 * What the person asked for, as the page showed it, so the transaction can
 * be held to it. Swaps and app-fee deposits are refused in a transaction
 * that comes without one.
 */
export type Expectation =
  | {
      kind: "trade";
      mint: PublicKey;
      side: "buy" | "sell";
      /** Buy: pair-asset base units to spend (lamports when `payWithSol`). Sell: coin base units. */
      amountIn: bigint;
      payWithSol: boolean;
      slippageBps: number;
      /** The app fee rate shown, bps. */
      tradeFeeBps: number;
      /** The app fee shown, pair-asset base units; null when it depends on a SOL swap's output. */
      appFee: bigint | null;
      /** What the page estimated the trade returns, base units of the asset received; null when unknown. */
      expectedOut: bigint | null;
    }
  | {
      kind: "launch";
      mint: PublicKey;
      /** The dev buy: pair-asset base units, or lamports when `payWithSol`. */
      devBuy: bigint;
      payWithSol: boolean;
    }
  | {
      /** Lock one of the signer's own positions forever: `index` is the position's. */
      kind: "lockForever";
      mint: PublicKey;
      index: number;
    }
  | {
      /** Burn exactly `amount` base units of `mint` from the signer's own Token-2022 account. */
      kind: "burn";
      mint: PublicKey;
      amount: bigint;
    };

/**
 * How far below the page's spot estimate a trade's on-chain minimum may sit,
 * on top of the chosen slippage: room for the trade's own price impact
 * (the estimate is at spot) and a price that moved since the page loaded.
 */
export const MAX_PRICE_IMPACT_BPS = 3_000;

const refuse = (reason: string): never => {
  throw new Error(`refusing to sign: ${reason}`);
};

function u64(data: Uint8Array, offset: number): bigint {
  if (data.length < offset + 8) refuse("an instruction is shorter than its layout");
  return Buffer.from(data).readBigUInt64LE(offset);
}

/** The signer's associated token account for `mint` under either token program. */
function isOwnAta(account: PublicKey | undefined, mint: PublicKey | undefined, signer: PublicKey): boolean {
  if (!account || !mint) return false;
  return [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some((program) =>
    getAssociatedTokenAddressSync(mint, signer, true, program).equals(account),
  );
}

/**
 * Check what the API asked this wallet to sign before the wallet sees it, so
 * a compromised or impersonated API cannot route the signer's money anywhere
 * but back to the signer or into the coin they are trading.
 *
 * - the fee payer is `signer`;
 * - every instruction calls an allowlisted program;
 * - System Program: only a transfer into the signer's own wrapped-SOL account;
 * - SPL Token: transfers only into the signer's own accounts; approvals,
 *   authority changes and direct burns are refused; a closed account's rent
 *   returns to the signer; Associated Token Account creation only for the signer;
 * - IMAGINE: only the user-facing instructions, by discriminator; an app-fee
 *   `deposit_reward` only into the traded coin's pool, for the side traded,
 *   and no more than the fee shown;
 * - LaunchLab `buy_exact_in`/`sell_exact_in` and CPMM `swap_base_input`: paid
 *   from and into the signer's own token accounts, on an IMAGINE coin's pool,
 *   with no share-fee receiver, and with input and minimum output held to
 *   `expect`;
 * - Jupiter `route`/`shared_accounts_route` (pay with SOL): the signer's own
 *   source and destination accounts, no platform fee, no more SOL in than
 *   asked, and no looser slippage than chosen;
 * - IMAGINE `lock_forever`: only for the signer's own position named by a
 *   `lockForever` expectation, exactly once;
 * - Token-2022 `BurnChecked`: only with a `burn` expectation, from the
 *   signer's own account for that mint, signed by the signer, for exactly
 *   the amount typed, exactly once;
 * - Compute Budget: exactly one compute-unit limit (at most 1.4M) and one
 *   loaded-account-data limit (sized, so below the 64 MiB ceiling), at most
 *   one compute-unit price no higher than the API takes, and a priority fee
 *   of at most 0.01 SOL; nothing else (no heap frame).
 *
 * Swaps, fee deposits, lock-forevers and burns need `expect`; without one (a
 * lock, a claim, …) they are refused outright. `lookupTables` resolves a v0
 * message's table-loaded keys; pass what `fetchLookupTables` returns. Throws
 * with the reason on the first violation.
 */
export function assertTransactionAllowed(
  message: VersionedMessage,
  lookupTables: AddressLookupTableAccount[],
  signer: PublicKey,
  expect?: Expectation,
): void {
  const feePayer = message.staticAccountKeys[0];
  if (!feePayer?.equals(signer)) {
    refuse(`the fee payer is ${feePayer?.toBase58() ?? "missing"}, not your wallet`);
  }
  const keys = message.getAccountKeys({ addressLookupTableAccounts: lookupTables });
  const ownWrappedSol = getAssociatedTokenAddressSync(NATIVE_MINT, signer, true, TOKEN_PROGRAM_ID);

  // Per-transaction tallies, held to `expect` once every instruction is read.
  let venueIn = 0n;
  let venueTrades = 0;
  let appFee = 0n;
  let jupiterIn = 0n;
  let jupiterMinOut = 0n;
  let lockForevers = 0;
  let burns = 0;
  let unitLimit: number | null = null;
  let unitPrice: bigint | null = null;
  let dataLimit: number | null = null;

  for (const compiled of message.compiledInstructions) {
    const programId = keys.get(compiled.programIdIndex);
    if (!programId || !ALLOWED_PROGRAMS.has(programId.toBase58())) {
      refuse(`the transaction calls an unexpected program ${programId?.toBase58() ?? "?"}`);
    }
    const accounts = compiled.accountKeyIndexes.map((index) => {
      const pubkey = keys.get(index);
      if (!pubkey) refuse("an instruction names an account the transaction does not carry");
      return pubkey!;
    });
    const data = compiled.data;
    const program = programId!;

    if (program.equals(ComputeBudgetProgram.programId)) {
      const value = (bytes: number) => {
        if (data.length !== 1 + bytes) refuse("a compute budget instruction is malformed");
        return bytes === 4 ? BigInt(Buffer.from(data).readUInt32LE(1)) : u64(data, 1);
      };
      if (data[0] === BUDGET_UNIT_LIMIT) {
        if (unitLimit !== null) refuse("the transaction sets its compute-unit limit twice");
        unitLimit = Number(value(4));
        if (unitLimit < 1 || unitLimit > MAX_COMPUTE_UNITS) refuse(`the compute-unit limit ${unitLimit} is out of range`);
      } else if (data[0] === BUDGET_UNIT_PRICE) {
        if (unitPrice !== null) refuse("the transaction sets its compute-unit price twice");
        unitPrice = value(8);
        if (unitPrice > MAX_COMPUTE_UNIT_PRICE) refuse(`the priority fee rate (${unitPrice} micro-lamports per compute unit) is higher than the site ever sets`);
      } else if (data[0] === BUDGET_DATA_LIMIT) {
        if (dataLimit !== null) refuse("the transaction sets its loaded-account-data limit twice");
        dataLimit = Number(value(4));
        if (dataLimit < 1 || dataLimit >= MAX_LOADED_ACCOUNTS_DATA_BYTES) {
          refuse("the transaction's loaded-account-data limit was never sized");
        }
      } else {
        refuse("unexpected Compute Budget instruction");
      }
      continue;
    }

    if (program.equals(SystemProgram.programId)) {
      const instruction = new TransactionInstruction({
        programId: program,
        data: Buffer.from(data),
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
      if (kind !== "Transfer") refuse(`unexpected System Program instruction (${kind})`);
      const { toPubkey, lamports } = SystemInstruction.decodeTransfer(instruction);
      if (!toPubkey.equals(ownWrappedSol)) {
        refuse(`the transaction sends ${lamports} lamports to ${toPubkey.toBase58()}, which is not your wrapped-SOL account`);
      }
      continue;
    }

    if (program.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (!ATA_CREATE_TAGS.has(data[0])) refuse("unexpected Associated Token Account instruction");
      if (!accounts[2]?.equals(signer)) {
        refuse(`the transaction pays rent for a token account owned by ${accounts[2]?.toBase58() ?? "?"}`);
      }
      continue;
    }

    if (TOKEN_PROGRAMS.has(program.toBase58())) {
      if (data[0] === TOKEN_BURN_CHECKED && expect?.kind === "burn") {
        // BurnChecked: [account, mint, authority]; args amount u64, decimals u8.
        if (!program.equals(TOKEN_2022_PROGRAM_ID)) refuse("the burn is not on Token-2022");
        if (!accounts[1]?.equals(expect.mint)) refuse("the burn is for another coin");
        if (!accounts[2]?.equals(signer)) refuse("the burn is authorised by another account");
        if (!getAssociatedTokenAddressSync(expect.mint, signer, true, TOKEN_2022_PROGRAM_ID).equals(accounts[0])) {
          refuse("the burn takes from a token account that is not yours");
        }
        if (data.length < 10 || u64(data, 1) !== expect.amount) refuse("the burn is not for the amount you entered");
        burns += 1;
        continue;
      }
      assertTokenInstruction(data, accounts, signer, program);
      continue;
    }

    if (program.equals(IMAGINE_PROGRAM_ID)) {
      const name = IMAGINE_USER_INSTRUCTIONS.get(hex(data));
      if (!name) refuse("the transaction calls an IMAGINE instruction the site never sends");
      if (name === "deposit_reward") {
        // [payer, pool, …]; args amount u64, kind u8 (0 buy, 1 sell).
        if (expect?.kind !== "trade") refuse("the transaction pays an app fee outside a trade");
        const trade = expect as Extract<Expectation, { kind: "trade" }>;
        if (!accounts[0]?.equals(signer)) refuse("the app fee is paid by another account");
        if (!accounts[1]?.equals(poolPda(trade.mint))) refuse("the app fee goes to another coin's pool");
        if (data[16] !== (trade.side === "buy" ? 0 : 1)) refuse("the app fee is booked as the wrong side of the trade");
        appFee += u64(data, 8);
      }
      if (name === "lock_forever") {
        // [owner, pool, reward_vault, reward_token_account, position].
        if (expect?.kind !== "lockForever") refuse("the transaction locks a position forever without that being asked for");
        const target = expect as Extract<Expectation, { kind: "lockForever" }>;
        if (!accounts[0]?.equals(signer)) refuse("the lock-forever is signed by another account");
        if (!accounts[1]?.equals(poolPda(target.mint))) refuse("the lock-forever is on another coin's pool");
        if (!accounts[4]?.equals(positionPda(target.mint, signer, target.index))) {
          refuse("the lock-forever names a position other than the one you chose");
        }
        lockForevers += 1;
      }
      continue;
    }

    if (program.equals(LAUNCHLAB_PROGRAM_ID)) {
      // [payer, authority, global_config, platform_config, pool, user_base, user_quote,
      //  base_vault, quote_vault, base_mint, quote_mint, base_program, quote_program,
      //  event_authority, program, system_program, platform_fee_vault, creator_fee_vault]
      const disc = hex(data);
      if (disc !== LAUNCHLAB_BUY_EXACT_IN && disc !== LAUNCHLAB_SELL_EXACT_IN) {
        refuse("the transaction calls a Raydium LaunchLab instruction other than a curve buy or sell");
      }
      if (expect?.kind !== "trade" && expect?.kind !== "launch") refuse("the transaction trades without a trade being asked for");
      const venue = expect as Extract<Expectation, { kind: "trade" | "launch" }>;
      const baseMint = accounts[9];
      const quoteMint = accounts[10];
      if (!accounts[0]?.equals(signer)) refuse("the curve trade is made by another account");
      if (!isOwnAta(accounts[5], baseMint, signer) || !isOwnAta(accounts[6], quoteMint, signer)) {
        refuse("the curve trade pays from or into a token account that is not yours");
      }
      if (!baseMint?.equals(venue.mint)) refuse("the curve trade is for another coin");
      if (u64(data, 24) !== 0n || accounts.length !== 18) refuse("the curve trade pays a share fee to a third party");
      // An IMAGINE coin's LaunchLab creator is its reward vault, so its creator fee vault pins the pool to IMAGINE.
      if (!accounts[17].equals(creatorFeeVaultPda(rewardVaultPda(baseMint!), quoteMint!, LAUNCHLAB_PROGRAM_ID))) {
        refuse("the curve trade is on a pool that does not pay an IMAGINE vault");
      }
      const buying = disc === LAUNCHLAB_BUY_EXACT_IN;
      if (venue.kind === "launch" ? !buying : buying !== (venue.side === "buy")) {
        refuse("the curve trade is on the wrong side");
      }
      venueIn += u64(data, 8);
      assertMinOut(u64(data, 16), venue);
      venueTrades += 1;
      continue;
    }

    if (program.equals(CPMM_PROGRAM_ID)) {
      // [payer, authority, amm_config, pool, input_account, output_account, input_vault,
      //  output_vault, input_program, output_program, input_mint, output_mint, observation]
      if (hex(data) !== CPMM_SWAP_BASE_INPUT) refuse("the transaction calls a Raydium CPMM instruction other than an exact-in swap");
      if (expect?.kind !== "trade") refuse("the transaction swaps on Raydium without a trade being asked for");
      const trade = expect as Extract<Expectation, { kind: "trade" }>;
      if (!accounts[0]?.equals(signer)) refuse("the swap is made by another account");
      if (!isOwnAta(accounts[4], accounts[10], signer) || !isOwnAta(accounts[5], accounts[11], signer)) {
        refuse("the swap pays from or into a token account that is not yours");
      }
      const coinIn = trade.side === "sell";
      if (!(coinIn ? accounts[10] : accounts[11])?.equals(trade.mint)) refuse("the swap is for another coin, or the wrong side");
      venueIn += u64(data, 8);
      assertMinOut(u64(data, 16), trade);
      venueTrades += 1;
      continue;
    }

    if (program.equals(JUPITER_PROGRAM_ID)) {
      if (
        (expect?.kind !== "trade" && expect?.kind !== "launch") ||
        !expect.payWithSol ||
        (expect.kind === "trade" && expect.side !== "buy")
      ) {
        refuse("the transaction routes through Jupiter without paying in SOL being asked for");
      }
      const disc = hex(data);
      let authority: PublicKey | undefined;
      let source: PublicKey | undefined;
      let destination: PublicKey | undefined;
      let destinationMint: PublicKey | undefined;
      let platformFeeAccount: PublicKey | undefined;
      if (disc === JUPITER_ROUTE) {
        // [token_program, authority, user_source, user_destination, destination (optional), destination_mint, platform_fee (optional), …]
        [authority, source, destination, destinationMint, platformFeeAccount] = [accounts[1], accounts[2], accounts[3], accounts[5], accounts[6]];
        if (!accounts[4]?.equals(JUPITER_PROGRAM_ID) && !accounts[4]?.equals(destination!)) {
          refuse("the Jupiter route delivers to an account that is not yours");
        }
      } else if (disc === JUPITER_SHARED_ACCOUNTS_ROUTE) {
        // [token_program, program_authority, authority, source, program_source, program_destination,
        //  destination, source_mint, destination_mint, platform_fee (optional), …]
        [authority, source, destination, destinationMint, platformFeeAccount] = [accounts[2], accounts[3], accounts[6], accounts[8], accounts[9]];
        if (!accounts[7]?.equals(NATIVE_MINT)) refuse("the Jupiter route spends something other than SOL");
      } else {
        refuse("the transaction calls a Jupiter instruction other than an exact-in route");
      }
      if (!authority?.equals(signer)) refuse("the Jupiter route is authorised by another account");
      if (!source?.equals(ownWrappedSol)) refuse("the Jupiter route spends from an account that is not your wrapped SOL");
      if (!isOwnAta(destination, destinationMint, signer)) refuse("the Jupiter route delivers to an account that is not yours");
      if (!platformFeeAccount?.equals(JUPITER_PROGRAM_ID) || data[data.length - 1] !== 0) {
        refuse("the Jupiter route takes a platform fee");
      }
      const tail = data.length - 19;
      const inAmount = u64(data, tail);
      const quotedOut = u64(data, tail + 8);
      const slippage = Buffer.from(data).readUInt16LE(tail + 16);
      const asked = expect?.kind === "trade" ? expect.slippageBps : null;
      if (asked !== null && slippage > asked) refuse(`the Jupiter route allows ${slippage / 100}% slippage, more than you chose`);
      jupiterIn += inAmount;
      jupiterMinOut += (quotedOut * BigInt(10_000 - slippage)) / 10_000n;
      continue;
    }
  }

  // Phantom will only vouch for a transaction whose resource limits are explicit.
  if (unitLimit === null || dataLimit === null) refuse("the transaction leaves its compute or loaded-account-data limit unset");
  if (((unitPrice ?? 0n) * BigInt(unitLimit!)) / 1_000_000n > MAX_PRIORITY_FEE_LAMPORTS) {
    refuse("the transaction's priority fee is more than 0.01 SOL");
  }

  if (expect?.kind === "lockForever") {
    if (lockForevers !== 1) refuse("the transaction does not lock exactly the one position asked for");
    return;
  }
  if (expect?.kind === "burn") {
    if (burns !== 1) refuse("the transaction does not make exactly the one burn asked for");
    return;
  }
  if (!expect) return;
  if (expect.kind === "trade" && venueTrades !== 1) refuse("the transaction does not make exactly the one trade asked for");
  if (expect.payWithSol && jupiterIn > (expect.kind === "trade" ? expect.amountIn : expect.devBuy)) {
    refuse("the transaction spends more SOL than you entered");
  }
  if (expect.kind === "launch") {
    // Paid in the pair asset, the dev buy may spend at most what was entered;
    // paid in SOL, at most what the swap guarantees in the same transaction.
    if (!expect.payWithSol && venueIn > expect.devBuy) refuse("the dev buy spends more than you entered");
    if (expect.payWithSol && jupiterIn > 0n && venueIn > jupiterMinOut) refuse("the dev buy spends more than the SOL swap returns");
    return;
  }
  if (expect.side === "buy") {
    // The budget covers the venue leg and the fee; paid in SOL, the budget is
    // what the Jupiter leg guarantees.
    const budget = expect.payWithSol ? jupiterMinOut : expect.amountIn;
    if (expect.payWithSol && jupiterIn === 0n) refuse("the SOL swap the trade relies on is missing");
    if (venueIn + appFee > budget) refuse("the trade spends more than you entered");
    const feeCap = expect.payWithSol || expect.appFee === null ? (budget * BigInt(expect.tradeFeeBps)) / 10_000n : expect.appFee;
    if (appFee > feeCap) refuse("the app fee is more than the one shown");
  } else {
    if (venueIn > expect.amountIn) refuse("the trade sells more than you entered");
    // Shown at spot; the chain charges the fee on what the sell really returns,
    // which may sit above spot by at most the slippage chosen.
    const shown = expect.appFee ?? 0n;
    if (appFee > shown + (shown * BigInt(expect.slippageBps)) / 10_000n + 1n) refuse("the app fee is more than the one shown");
  }
}

/** A trade's on-chain minimum output against the page's estimate, slippage and price impact allowed for. */
function assertMinOut(minOut: bigint, expect: Expectation): void {
  if (minOut === 0n) refuse("the trade accepts any price (no minimum output)");
  if (expect.kind !== "trade" || expect.expectedOut === null || expect.payWithSol) return;
  const floor = (expect.expectedOut * BigInt(10_000 - expect.slippageBps - MAX_PRICE_IMPACT_BPS)) / 10_000n;
  if (minOut < floor) {
    refuse(
      `the trade's minimum output is more than ${(expect.slippageBps + MAX_PRICE_IMPACT_BPS) / 100}% below the price shown; refresh the page or trade a smaller amount`,
    );
  }
}

/** SPL Token / Token-2022: nothing leaves the signer's accounts except into the signer's accounts. */
function assertTokenInstruction(data: Uint8Array, accounts: PublicKey[], signer: PublicKey, program: PublicKey): void {
  const tag = data[0];
  if (tag === TOKEN_APPROVE || tag === TOKEN_APPROVE_CHECKED || tag === TOKEN_SET_AUTHORITY) {
    refuse("the transaction hands control of a token account to someone else");
  }
  if (tag === TOKEN_BURN || tag === TOKEN_BURN_CHECKED) refuse("the transaction burns tokens directly");
  if (tag === TOKEN_CLOSE_ACCOUNT) {
    if (!accounts[1]?.equals(signer)) {
      refuse(`the transaction closes a token account into ${accounts[1]?.toBase58() ?? "?"}, not your wallet`);
    }
    return;
  }
  // [source, destination, owner] for a plain transfer; [source, mint,
  // destination, owner] for the checked forms.
  if (tag === TOKEN_TRANSFER) refuse("the transaction makes an unchecked token transfer");
  if (tag !== TOKEN_TRANSFER_CHECKED && !(tag === TOKEN_TRANSFER_FEE_EXTENSION && data[1] === 1)) return;
  const mint = accounts[1];
  const destination = accounts[2];
  if (!mint || !destination || !getAssociatedTokenAddressSync(mint, signer, true, program).equals(destination)) {
    refuse(`the transaction sends tokens to ${destination?.toBase58() ?? "?"}, which is not yours`);
  }
}

/** The lookup tables a v0 message loads keys from. */
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
 * Sign and submit a transaction the API assembled, the way Phantom asks so it
 * can vouch for it rather than warn "this dApp could be malicious":
 *
 * - the API sends v0 bytes with explicit compute-unit and loaded-account-data
 *   limits, sized from its own simulation (`sigVerify: false`), and refuses
 *   to build anything that fails it. A `deferred` step — one that spends what
 *   the step before it produced — goes back through /tx/prepare for that
 *   simulation once the earlier step has landed;
 * - the bytes are checked with `assertTransactionAllowed` before the wallet
 *   is asked;
 * - the wallet signs first (`signTransaction`), and only then any keypair
 *   the message also needs (a launch's fresh mint): a transaction that
 *   arrives already carrying another signature is exactly what a drainer
 *   sends. The wallet's message is kept as it returns it;
 * - the signed bytes go out through our RPC with preflight on, and
 *   confirmation is awaited against the blockhash signed, so a dropped
 *   transaction surfaces as an error rather than a silent no-op.
 *
 * `extraSigners` are offered, not forced: each signs only if the message
 * requires its signature (a launch's mint keypair signs the launch, not the
 * SOL→pair swap ahead of it). `expect` is what the page showed for a trade or
 * a launch; see `assertTransactionAllowed`.
 */
export async function signAndSend(
  connection: Connection,
  wallet: WalletContextState,
  built: BuiltTransaction,
  extraSigners: Signer[] = [],
  expect?: Expectation,
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error("wallet cannot sign transactions");
  const ready = built.deferred ? await post<BuiltTransaction>("/api/tx/prepare", { transaction: built.transaction }) : built;
  const tx = VersionedTransaction.deserialize(Buffer.from(ready.transaction, "base64"));
  assertTransactionAllowed(tx.message, await fetchLookupTables(connection, tx.message), wallet.publicKey, expect);
  const required = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
  const cosigners = extraSigners.filter((signer) => required.some((key) => key.equals(signer.publicKey)));

  // The API's blockhash is already some seconds old and the wallet's approval
  // screen can take a minute more; re-stamp it from this connection right
  // before signing (nothing has signed yet, and the checks above don't depend
  // on it) so the transaction lands well inside its validity window.
  const fresh = await connection.getLatestBlockhash("confirmed");
  tx.message.recentBlockhash = fresh.blockhash;

  const signed = await wallet.signTransaction(tx);
  if (cosigners.length > 0) signed.sign(cosigners);
  const raw = signed.serialize();
  // An RPC node a slot or two behind answers "Blockhash not found" for a
  // hash the network already has; the signed bytes stay valid, so resend.
  let signature: string;
  for (let attempt = 0; ; attempt++) {
    try {
      signature = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" });
      break;
    } catch (error) {
      if (attempt >= 5 || !/blockhash not found/i.test(String((error as Error)?.message ?? error))) throw error;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 1_500);
      await promise;
    }
  }
  const result = await connection.confirmTransaction(
    {
      signature,
      blockhash: fresh.blockhash,
      lastValidBlockHeight: fresh.lastValidBlockHeight,
    },
    "confirmed",
  );
  if (result.value.err) {
    throw new Error(`transaction failed on chain: ${JSON.stringify(result.value.err)}`);
  }
  return signature;
}
