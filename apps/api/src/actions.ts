import { PublicKey, type AddressLookupTableAccount, type TransactionInstruction } from "@solana/web3.js";
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, unpackAccount, unpackMint } from "@solana/spl-token";
import {
  claimableFor,
  DAY,
  HOUR,
  decodePool,
  decodePosition,
  formatDuration,
  MIN_COMPOUND_QUOTE,
  positionPda,
  type PoolAccount,
  type PoolTerms,
  type PositionAccount,
  type QuoteRef,
} from "@imagine/sdk";
import { z } from "zod";
import { ActionError } from "./errors.ts";
import { imagine, connection } from "./solana.ts";
import {
  buildTrade,
  collectFeesInstructions,
  compoundInstructions,
  quoteCompoundNow,
  readMarket,
  uncollectedFees,
  unsyncedRewards,
  valuationAccounts,
} from "./raydium.ts";
import { budgetInstructions, fits, launchLookupTable, tablesFor } from "./transactions.ts";

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
  /** Opt a lock in or out of auto-compound: its rewards buy more of the coin into the lock. */
  z.object({ kind: z.literal("setAutoCompound"), mint: pubkey, index, enabled: z.boolean() }),
  /** Spend this lock's pending rewards on more of the coin, added to the lock, now. */
  z.object({ kind: z.literal("compound"), mint: pubkey, index, priorityFeeMicroLamports: priority.default(100_000) }),
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

/**
 * Why `compound` would refuse this position right now, in the program's own
 * order of checks, or null when it would go through. `pending` is what the
 * compound would spend: `claimableFor` against the pool projected to now,
 * which is exactly what the program settles.
 */
export function compoundBlocker(
  position: Pick<PositionAccount, "renounced" | "forever" | "lockEnd">,
  terms: Pick<PoolTerms, "minLockSecs">,
  pending: bigint,
  now = Math.floor(Date.now() / 1000),
): string | null {
  if (position.renounced) return "this lock gave up its earnings, so it has nothing to compound";
  if (position.forever) return LOCKED_FOREVER;
  if (position.lockEnd <= now) return "this lock has ended; unlock it instead";
  if (position.lockEnd - now < terms.minLockSecs) {
    return `less than ${formatDuration(terms.minLockSecs)} is left on this lock, so it cannot be added to; extend it first`;
  }
  if (pending < MIN_COMPOUND_QUOTE) return "not enough rewards to compound yet";
  return null;
}

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

    case "setAutoCompound": {
      const position = await imagine.fetchPosition(mint, owner, action.index);
      if (!position) throw new ActionError(404, "that lock does not exist");
      if (position.renounced) throw new ActionError(409, "this lock gave up its earnings, so it has nothing to compound");
      if (position.forever) throw new ActionError(409, LOCKED_FOREVER);
      if (position.autoCompound === action.enabled) {
        throw new ActionError(409, action.enabled ? "auto-compound is already on for this lock" : "auto-compound is already off for this lock");
      }
      const ix = await imagine.setAutoCompound({ owner, mint, index: action.index, enabled: action.enabled });
      return plain([...budgetInstructions(50_000), ix]);
    }

    case "compound": {
      // The owner may compound any time; the program also lets anyone crank
      // a lock that opted in, which is what the keeper does.
      const [position, pool] = await Promise.all([
        imagine.fetchPosition(mint, owner, action.index),
        imagine.fetchProjectedPool(mint),
      ]);
      if (!position) throw new ActionError(404, "that lock does not exist");
      if (!pool || !pool.founded) throw new ActionError(404, "this coin has no IMAGINE pool");
      const pending = claimableFor(position, pool);
      const blocker = compoundBlocker(position, pool.terms, pending);
      if (blocker) throw new ActionError(409, blocker);
      const market = await readMarket(mint, pool.quoteMint);
      const quoted = await quoteCompoundNow(market, pending);
      if (!market || !quoted) {
        throw new ActionError(409, "this coin is migrating to Raydium; compounding resumes once it lands");
      }
      if (!quoted.viable) {
        throw new ActionError(
          409,
          "one buy this size would move the price too far (or finish the curve); try again after more trading",
        );
      }
      const ixs = await compoundInstructions({
        payer: owner,
        owner,
        pool,
        market,
        index: action.index,
        minTokensOut: quoted.minTokensOut,
      });
      const instructions = [...budgetInstructions(action.priorityFeeMicroLamports), ...ixs];
      const launchTable = await launchLookupTable();
      let lookupTables;
      try {
        lookupTables = tablesFor(instructions, owner, launchTable ? [launchTable] : []);
      } catch {
        throw new ActionError(409, "this compound does not fit in one transaction");
      }
      return {
        instructions,
        lookupTables,
        meta: {
          venue: quoted.venue,
          quoteIn: pending.toString(),
          estimatedTokens: quoted.tokensOut.toString(),
          minTokensOut: quoted.minTokensOut.toString(),
        },
      };
    }
  }
}

/** Claim every lock the signer holds that has something to pay: no fields, the owner is the signer. */
export const ClaimAllSchema = z.object({ kind: z.literal("claimAll") });

/** One claim inside a claim-all transaction. */
export interface ClaimRef {
  mint: string;
  index: number;
  /** Quote base units the claim pays, projected to now. */
  pending: string;
}

/** One transaction of a claim-all: as many claims as fit, and which. */
export interface ClaimBatch extends BuiltAction {
  claims: ClaimRef[];
}

/**
 * The most claims packed into one transaction: each is a few tens of
 * thousands of compute units, so packet size is the real limit and this only
 * keeps a transaction comfortably inside the compute ceiling.
 */
const MAX_CLAIMS_PER_TRANSACTION = 8;
/** The most transactions one claim-all builds; a wallet holding more locks claims the rest with another press. */
const MAX_CLAIM_ALL_TRANSACTIONS = 10;

/**
 * Every claim `owner` can make right now, packed into as few transactions as
 * fit: each starts with one compute budget, then `claim` (and the idempotent
 * quote-ATA create it needs, once per quote) for one lock after another until
 * the next would overrun the packet. Locks of the same coin sit together so
 * they share accounts. Pending is the pool projected to now, the program's
 * own arithmetic, so a lock listed here pays when it lands.
 */
export async function buildClaimAll(owner: PublicKey): Promise<ClaimBatch[]> {
  const positions = await imagine.fetchPositionsByOwner(owner);
  const poolKeys = [...new Set(positions.map((position) => position.pool.toBase58()))].map((key) => new PublicKey(key));
  const poolInfos = poolKeys.length > 0 ? await connection.getMultipleAccountsInfo(poolKeys) : [];
  const projected = new Map(
    await Promise.all(
      poolInfos.flatMap((info, i) => {
        if (!info) return [];
        const mint = decodePool(info.data).mint;
        return [imagine.fetchProjectedPool(mint).then((pool) => [poolKeys[i].toBase58(), pool] as const)];
      }),
    ),
  );
  const claimable = positions
    .flatMap((position) => {
      const pool = projected.get(position.pool.toBase58());
      const pending = pool ? claimableFor(position, pool) : 0n;
      return pool && pending > 0n ? [{ position, pool, pending }] : [];
    })
    .sort((a, b) => a.pool.mint.toBase58().localeCompare(b.pool.mint.toBase58()) || a.position.index - b.position.index);
  if (claimable.length === 0) throw new ActionError(409, "none of your locks has anything to claim yet");

  const launchTable = await launchLookupTable();
  const candidates = launchTable ? [launchTable] : [];

  const batches: ClaimBatch[] = [];
  let instructions = budgetInstructions(100_000);
  let claims: ClaimRef[] = [];
  const close = () => {
    batches.push({ instructions, lookupTables: tablesFor(instructions, owner, candidates), meta: {}, claims });
    instructions = budgetInstructions(100_000);
    claims = [];
  };
  for (const { position, pool, pending } of claimable) {
    const ixs = await imagine.claim({ owner, mint: pool.mint, quote: quoteOf(pool), index: position.index });
    // Locks paid in the same quote need its idempotent ATA create only once.
    const added = ixs.filter(
      (ix) =>
        !instructions.some(
          (existing) =>
            existing.programId.equals(ix.programId) &&
            Buffer.compare(existing.data, ix.data) === 0 &&
            existing.keys.length === ix.keys.length &&
            existing.keys.every((key, i) => key.pubkey.equals(ix.keys[i].pubkey)),
        ),
    );
    const next = [...instructions, ...added];
    const full =
      claims.length >= MAX_CLAIMS_PER_TRANSACTION ||
      !(fits(next, owner) || (candidates.length > 0 && fits(next, owner, candidates)));
    if (claims.length > 0 && full) {
      close();
      if (batches.length === MAX_CLAIM_ALL_TRANSACTIONS) break;
      instructions.push(...ixs);
    } else {
      instructions = next;
    }
    claims.push({ mint: pool.mint.toBase58(), index: position.index, pending: pending.toString() });
  }
  if (claims.length > 0 && batches.length < MAX_CLAIM_ALL_TRANSACTIONS) close();
  return batches;
}
