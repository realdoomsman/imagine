import { PublicKey } from "@solana/web3.js";
import { PUMP_PROGRAM_ID, SEED, VISE_PROGRAM_ID } from "./constants.ts";

export function configPda(programId: PublicKey = VISE_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([SEED.config], programId)[0];
}

export function poolPda(
  mint: PublicKey,
  programId: PublicKey = VISE_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEED.pool, mint.toBuffer()],
    programId,
  )[0];
}

/**
 * System-owned PDA that holds a pool's SOL rewards.
 *
 * This is the address handed to pump.fun as a fee-sharing shareholder, so it
 * must be derivable before the coin exists — it depends only on the mint.
 */
export function rewardVaultPda(
  mint: PublicKey,
  programId: PublicKey = VISE_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEED.vault, poolPda(mint, programId).toBuffer()],
    programId,
  )[0];
}

export function tokenVaultPda(
  mint: PublicKey,
  programId: PublicKey = VISE_PROGRAM_ID,
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
  programId: PublicKey = VISE_PROGRAM_ID,
): PublicKey {
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32LE(index, 0);
  return PublicKey.findProgramAddressSync(
    [SEED.position, poolPda(mint, programId).toBuffer(), owner.toBuffer(), indexBuf],
    programId,
  )[0];
}

export function bondingCurvePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM_ID,
  )[0];
}

export function pumpCreatorVaultPda(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM_ID,
  )[0];
}
