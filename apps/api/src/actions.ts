import { PublicKey, type AddressLookupTableAccount, type TransactionInstruction } from "@solana/web3.js";
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, unpackAccount, unpackMint } from "@solana/spl-token";
import {
  DAY,
  HOUR,
  decodePosition,
  formatDuration,
  positionPda,
  type PoolAccount,
  type PoolTerms,
  type QuoteRef,
} from "@imagine/sdk";
import { z } from "zod";
import { ActionError } from "./errors.ts";
import { imagine, connection } from "./solana.ts";
import { buildTrade, collectFeesInstructions, readMarket, uncollectedFees, unsyncedRewards, valuationAccounts } from "./raydium.ts";
import { budgetInstructions } from "./transactions.ts";

export { ActionError };

/**
 * Every user action, as instructions.
 *
 * Two callers: the `/tx/*` routes serialise these for an external wallet to
 * sign, and the account routes sign them with an IMAGINE wallet on the
 * server. One builder per action means the two paths can never drift — a
 * Phantom user and a Google user get byte-identical transactions.
 */

export const pubkey = z.string().refine((value) => {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}, "invalid base58 public key");

/** A u64 amount in base units, as a decimal string. */
export const baseUnits = z
  .string()
  .regex(/^\d+$/, "expected an integer string")
  .refine((v) => BigInt(v) <= 18_446_744_073_709_551_615n, "amount too large");

const priority = z.number().int().min(0).max(10_000_000);
const index = z.number().int().min(0).max(4_294_967_295);
const slippageBps = z.number().int().min(10).max(5_000).default(300);
/**
 * A lock term in seconds. The bounds are the program's own hard limits; each
 * pool's frozen window is narrower and is checked against the pool itself.
 */
export const lockDuration = z.number().int().min(HOUR).max(4 * 365 * DAY);

export const ActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lock"),
    mint: pubkey,
    index,
    amount: baseUnits,
    durationSecs: lockDuration,
    priorityFeeMicroLamports: priority.default(100_000),
  }),
  z.object({
    kind: z.literal("increase"),
    mint: pubkey,
    index,
    amount: baseUnits,
    priorityFeeMicroLamports: priority.default(100_000),
  }),
  z.object({
    kind: z.literal("extend"),
    mint: pubkey,
    index,
    durationSecs: lockDuration,
    priorityFeeMicroLamports: priority.default(100_000),
  }),
  z.object({ kind: z.literal("claim"), mint: pubkey, index }),
  z.object({ kind: z.literal("renounce"), mint: pubkey, index }),
  /** Irreversible: the lock can never be unlocked, and its earnings go to the other lockers. */
  z.object({ kind: z.literal("lockForever"), mint: pubkey, index }),
  /** Destroy coins from the signer's own token account. Base units, exact. */
  z.object({ kind: z.literal("burn"), mint: pubkey, amount: baseUnits }),
  z.object({
    kind: z.literal("unlock"),
    mint: pubkey,
    index,
    early: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("swap"),
    mint: pubkey,
    side: z.enum(["buy", "sell"]),
    /** Buy: quote base units (lamports with payWithSol). Sell: coin base units. */
    amount: baseUnits,
    slippageBps,
    /** Buy only: pay in SOL on a coin paired with something else. */
    payWithSol: z.boolean().default(false),
    priorityFeeMicroLamports: priority.default(150_000),
  }),
  z.object({ kind: z.literal("sync"), mint: pubkey }),
]);

export type Action = z.infer<typeof ActionSchema>;

/** Refuse a term outside the pool's frozen window before anything is signed. */
export function assertInWindow(durationSecs: number, terms: Pick<PoolTerms, "minLockSecs" | "maxLockSecs">): void {
  if (durationSecs < terms.minLockSecs || durationSecs > terms.maxLockSecs) {
    throw new ActionError(
      400,
      `this pool takes locks from ${formatDuration(terms.minLockSecs)} to ${formatDuration(terms.maxLockSecs)}`,
    );
  }
}

export interface BuiltAction {
  instructions: TransactionInstruction[];
  /** The lookup tables the v0 transaction compiles through; often none. */
  lookupTables: AddressLookupTableAccount[];
  /** Figures the caller may want to show: fees, legs, expected output. */
  meta: Record<string, string | number>;
}

/** A founded pool and the accounts its locks are priced against. */
async function lockablePool(mint: PublicKey) {
  const pool = await imagine.fetchPool(mint);
  if (!pool || !pool.founded) throw new ActionError(404, "this coin has no IMAGINE pool");
  const valuation = valuationAccounts(await readMarket(mint, pool.quoteMint));
  return { pool, valuation, quote: quoteOf(pool) };
}

/** A pool's quote as the SDK builders take it. */
function quoteOf(pool: PoolAccount): QuoteRef {
  return { mint: pool.quoteMint, tokenProgram: pool.quoteTokenProgram };
}

/** Any pool, founded or not, for the payout instructions (never pausable). */
async function anyPool(mint: PublicKey): Promise<PoolAccount> {
  const pool = await imagine.fetchPool(mint);
  if (!pool) throw new ActionError(404, "this coin has no IMAGINE pool");
  return pool;
}

/** What every refused change to a lock-forever position says. */
const LOCKED_FOREVER = "this lock is locked forever: it can never be unlocked, added to or extended";

export async function buildAction(owner: PublicKey, action: Action): Promise<BuiltAction> {
  const mint = new PublicKey(action.mint);
  const plain = (instructions: TransactionInstruction[]): BuiltAction => ({ instructions, lookupTables: [], meta: {} });

  switch (action.kind) {
    case "lock": {
      const { pool, valuation, quote } = await lockablePool(mint);
      assertInWindow(action.durationSecs, pool.terms);
      const ix = await imagine.lock({
        owner,
        mint,
        quote,
        index: action.index,
        amount: BigInt(action.amount),
        durationSecs: action.durationSecs,
        valuation,
      });
      return plain([...budgetInstructions(action.priorityFeeMicroLamports), ix]);
    }

    case "increase": {
      // The program reprices the whole position against the term still to
      // run, and refuses when that is below the pool's minimum lock. Say so
      // before signing rather than after a failed transaction.
      const [positionInfo, { pool, valuation, quote }] = await Promise.all([
        connection.getAccountInfo(positionPda(mint, owner, action.index)),
        lockablePool(mint),
      ]);
      if (!positionInfo) throw new ActionError(404, "that lock does not exist");
      const existing = decodePosition(positionInfo.data);
      if (existing.forever) throw new ActionError(409, LOCKED_FOREVER);
      const remaining = existing.lockEnd - Math.floor(Date.now() / 1000);
      if (remaining < pool.terms.minLockSecs) {
        throw new ActionError(
          409,
          `less than ${formatDuration(pool.terms.minLockSecs)} is left on this lock, so it cannot be added to; extend it first, or open a new lock`,
        );
      }
      const ixs = await imagine.increase({
        owner,
        mint,
        quote,
        index: action.index,
        amount: BigInt(action.amount),
        valuation,
      });
      return plain([...budgetInstructions(action.priorityFeeMicroLamports), ...ixs]);
    }

    case "extend": {
      const [{ pool, valuation, quote }, position] = await Promise.all([
        lockablePool(mint),
        imagine.fetchPosition(mint, owner, action.index),
      ]);
      if (position?.forever) throw new ActionError(409, LOCKED_FOREVER);
      assertInWindow(action.durationSecs, pool.terms);
      const ixs = await imagine.extend({
        owner,
        mint,
        quote,
        index: action.index,
        durationSecs: action.durationSecs,
        valuation,
      });
      return plain([...budgetInstructions(action.priorityFeeMicroLamports), ...ixs]);
    }

    case "claim": {
      // Token-paired pools pay into the owner's quote ATA, created idempotently.
      const pool = await anyPool(mint);
      const ixs = await imagine.claim({ owner, mint, quote: quoteOf(pool), index: action.index });
      return plain([...budgetInstructions(100_000), ...ixs]);
    }

    case "renounce": {
      const [position, pool] = await Promise.all([imagine.fetchPosition(mint, owner, action.index), anyPool(mint)]);
      if (!position) throw new ActionError(404, "no such lock");
      if (position.renounced) throw new ActionError(409, "this lock already gave up its earnings");
      const ix = await imagine.renounce({ owner, mint, quote: quoteOf(pool), index: action.index });
      return plain([...budgetInstructions(100_000), ix]);
    }

    case "lockForever": {
      const [position, pool] = await Promise.all([imagine.fetchPosition(mint, owner, action.index), anyPool(mint)]);
      if (!position) throw new ActionError(404, "no such lock");
      if (position.forever) throw new ActionError(409, "this lock is already locked forever");
      const ix = await imagine.lockForever({ owner, mint, quote: quoteOf(pool), index: action.index });
      return plain([...budgetInstructions(100_000), ix]);
    }

    case "burn": {
      // Only an IMAGINE coin, only from the signer's own account, only what it holds.
      const pool = await anyPool(mint);
      const amount = BigInt(action.amount);
      if (amount === 0n) throw new ActionError(400, "nothing to burn");
      const ata = getAssociatedTokenAddressSync(mint, owner, true, pool.tokenProgram);
      const [ataInfo, mintInfo] = await connection.getMultipleAccountsInfo([ata, mint]);
      if (!mintInfo) throw new ActionError(404, "this coin's mint is missing");
      const balance = ataInfo ? unpackAccount(ata, ataInfo, pool.tokenProgram).amount : 0n;
      if (amount > balance) throw new ActionError(409, "you cannot burn more than this wallet holds");
      const { decimals } = unpackMint(mint, mintInfo, pool.tokenProgram);
      const ix = createBurnCheckedInstruction(ata, mint, owner, amount, decimals, [], pool.tokenProgram);
      return plain([...budgetInstructions(100_000), ix]);
    }

    case "unlock": {
      // Principal goes to the owner's coin ATA and earnings to their quote
      // ATA; either may have been closed since locking, so both are
      // recreated idempotently.
      const [pool, position] = await Promise.all([anyPool(mint), imagine.fetchPosition(mint, owner, action.index)]);
      if (position?.forever) throw new ActionError(409, LOCKED_FOREVER);
      const ixs = await imagine.unlock({ owner, mint, quote: quoteOf(pool), index: action.index, early: action.early });
      return plain([...budgetInstructions(100_000), ...ixs]);
    }

    case "swap":
      return buildTrade({
        user: owner,
        mint,
        side: action.side,
        amount: BigInt(action.amount),
        slippageBps: action.slippageBps,
        payWithSol: action.payWithSol,
        priorityFeeMicroLamports: action.priorityFeeMicroLamports,
      });

    case "sync": {
      // Pull the pool's trading fee out of Raydium (collect_creator_fee syncs
      // inline); with nothing to collect, fold in what already sits in the vault.
      const pool = await imagine.fetchPool(mint);
      if (!pool || !pool.founded) throw new ActionError(404, "this coin has no IMAGINE pool");
      const market = await readMarket(mint, pool.quoteMint);
      const [uncollected, unsynced] = await Promise.all([uncollectedFees(pool, market), unsyncedRewards(pool)]);
      if (uncollected === 0n && unsynced === 0n) throw new ActionError(409, "no new fees for this pool yet");
      const ixs =
        uncollected > 0n
          ? await collectFeesInstructions(owner, pool, market)
          : [await imagine.sync({ mint, quote: quoteOf(pool) })];
      return {
        instructions: [...budgetInstructions(50_000), ...ixs],
        lookupTables: [],
        meta: { uncollected: uncollected.toString(), unsynced: unsynced.toString() },
      };
    }
  }
}
