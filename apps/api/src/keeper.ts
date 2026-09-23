import {
  ammCreatorVaultPda,
  creatorVaultPda,
  feeSharingConfigPda,
  quoteAta,
} from "@pump-fun/pump-sdk";
import { AccountLayout } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { sql } from "./db.ts";
import { env } from "./env.ts";
import { budgetInstructions, QUOTE_MINT, QUOTE_TOKEN_PROGRAM, sweepCreatorFees } from "./pump.ts";
import { connection } from "./solana.ts";

/**
 * The keeper.
 *
 * pump.fun pays a coin's creator fees into a vault and leaves them there until
 * someone calls `distribute_creator_fees_v2`. That call is permissionless, but
 * nobody has a reason to make it promptly — the lockers it pays are the ones
 * who would least like to spend SOL on it. So VISE does. For every pool whose
 * pump vault holds more than the threshold, the keeper sends the distribution
 * and a pool sync in one transaction, and the lockers' share starts streaming.
 *
 * Idempotent by construction: distributing an empty vault is a no-op, syncing
 * an untouched pool is a no-op, and a duplicate send costs only its own fee.
 * The threshold is the only real policy here — it keeps a busy coin swept
 * every minute and a dead one swept never.
 */

const RENT_EXEMPT_SYSTEM_ACCOUNT = 890_880n;
/** Below this the keeper logs and stops sending rather than draining itself. */
const MIN_KEEPER_BALANCE = 20_000_000n;

export function loadKeeper(): Keypair | null {
  const raw = env.keeperKeypair.trim();
  if (!raw) return null;
  // Accept either the CLI's JSON byte array or a base58 secret.
  const bytes = raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw) as number[])
    : bs58.decode(raw);
  return Keypair.fromSecretKey(bytes);
}
/**
 * Lamports waiting to be distributed for one coin, by source: the pump creator
 * vault above its rent floor, and the AMM's WSOL creator vault once one exists.
 */
export async function distributable(mint: PublicKey): Promise<{ pump: bigint; amm: bigint }> {
  const sharing = feeSharingConfigPda(mint);
  const [vault, ammAta] = await connection.getMultipleAccountsInfo([
    creatorVaultPda(sharing),
    quoteAta(ammCreatorVaultPda(sharing), QUOTE_MINT, QUOTE_TOKEN_PROGRAM),
  ]);

  const pump =
    vault && BigInt(vault.lamports) > RENT_EXEMPT_SYSTEM_ACCOUNT
      ? BigInt(vault.lamports) - RENT_EXEMPT_SYSTEM_ACCOUNT
      : 0n;
  const amm =
    ammAta && ammAta.data.length >= AccountLayout.span
      ? AccountLayout.decode(ammAta.data).amount
      : 0n;
  return { pump, amm };
}

async function sweep(keeper: Keypair, mint: PublicKey, includeAmm: boolean) {
  const ixs = await sweepCreatorFees({ payer: keeper.publicKey, mint, includeAmm });
  if (ixs.length === 0) return null;
  const tx = new Transaction().add(...budgetInstructions(50_000, 400_000), ...ixs);
  return sendAndConfirmTransaction(connection, tx, [keeper], {
    commitment: "confirmed",
    maxRetries: 3,
  });
}

export async function runOnce(keeper: Keypair): Promise<{ swept: number; skipped: number }> {
  const balance = BigInt(await connection.getBalance(keeper.publicKey));
  if (balance < MIN_KEEPER_BALANCE) {
    console.warn(
      `keeper ${keeper.publicKey.toBase58()} holds ${balance} lamports; below floor, not sending`,
    );
    return { swept: 0, skipped: 0 };
  }

  const pools = await sql`SELECT mint FROM pools`;
  let swept = 0;
  let skipped = 0;

  for (const row of pools) {
    const mint = new PublicKey(row.mint as string);
    try {
      const { pump, amm } = await distributable(mint);
      const pending = pump + amm;
      if (pending < env.sweepMinLamports) {
        skipped += 1;
        continue;
      }
      const signature = await sweep(keeper, mint, amm > 0n);
      if (!signature) {
        skipped += 1;
        continue;
      }
      swept += 1;
      await sql`
        INSERT INTO keeper_runs (mint, lamports, signature)
        VALUES (${mint.toBase58()}, ${pending.toString()}::BIGINT, ${signature})
      `;
      console.log(`swept ${pending} lamports for ${mint.toBase58()} in ${signature}`);
    } catch (error) {
      console.error("sweep failed", mint.toBase58(), error);
    }
  }
  return { swept, skipped };
}
/** Start the loop if a keeper key is configured. Returns whether it started. */
export function startKeeper(): boolean {
  const keeper = loadKeeper();
  if (!keeper) {
    console.log("keeper disabled: KEEPER_KEYPAIR not set");
    return false;
  }
  console.log(`keeper ${keeper.publicKey.toBase58()} every ${env.keeperIntervalMs}ms`);

  let running = false;
  const tick = async () => {
    if (running) return; // a slow RPC must not stack runs
    running = true;
    try {
      await runOnce(keeper);
    } catch (error) {
      console.error("keeper run failed", error);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), env.keeperIntervalMs);
  return true;
}
