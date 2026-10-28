import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { IMAGINE_PROGRAM_ID, SEED } from "./constants.ts";
import { isNativeQuote } from "./quotes.ts";

export function configPda(programId: PublicKey = IMAGINE_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([SEED.config], programId)[0];
}

export function poolPda(
  mint: PublicKey,
  programId: PublicKey = IMAGINE_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEED.pool, mint.toBuffer()],
    programId,
  )[0];
}

/**
 * System-owned PDA that holds a pool's SOL rewards and is the coin's LaunchLab
 * pool creator, so the coin's LaunchLab creator fee is paid to it. It depends only
 * on the mint, so it is known before the coin exists.
 */
export function rewardVaultPda(
  mint: PublicKey,
  programId: PublicKey = IMAGINE_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEED.vault, poolPda(mint, programId).toBuffer()],
    programId,
  )[0];
}

/**
 * Where a pool holds a non-SOL quote: the reward vault's associated token
 * account for the quote. `null` for a WSOL-quoted pool, whose rewards are
 * native lamports on the reward vault itself.
 */
export function rewardTokenAccount(
  mint: PublicKey,
  quoteMint: PublicKey,
  quoteTokenProgram: PublicKey,
  programId: PublicKey = IMAGINE_PROGRAM_ID,
): PublicKey | null {
  if (isNativeQuote(quoteMint)) return null;
  return getAssociatedTokenAddressSync(
    quoteMint,
    rewardVaultPda(mint, programId),
    true,
    quoteTokenProgram,
  );
}

export function tokenVaultPda(
  mint: PublicKey,
  programId: PublicKey = IMAGINE_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEED.tokenVault, poolPda(mint, programId).toBuffer()],
    programId,
  )[0];
}

export function positionPda(
  mint: PublicKey,
  owner: PublicKey,
  index: number,
  programId: PublicKey = IMAGINE_PROGRAM_ID,
): PublicKey {
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32LE(index, 0);
  return PublicKey.findProgramAddressSync(
    [SEED.position, poolPda(mint, programId).toBuffer(), owner.toBuffer(), indexBuf],
    programId,
  )[0];
}
