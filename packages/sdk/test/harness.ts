import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createInitializeMetadataPointerInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMintToInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { Clock, FailedTransactionMetadata, LiteSVM } from "litesvm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import idlJson from "../src/idl/vise.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));
// LiteSVM executes SBPF v0; the deployable is built for v3. scripts/anchor-build.sh
// keeps the v0 build of the same source alongside it for this suite.
export const PROGRAM_SO = resolve(here, "../../../target/deploy/vise-v0.so");

export const VISE_IDL = idlJson as Idl;
export const coder = new BorshCoder(VISE_IDL);
export const PROGRAM_ID = new PublicKey(VISE_IDL.address);

export const DAY = 86_400;

/** The upgradeable BPF loader, owner of every ProgramData account. */
export const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export interface Ctx {
  svm: LiteSVM;
  admin: Keypair;
  treasury: Keypair;
}

export function setup(): Ctx {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM_ID, PROGRAM_SO);
  const admin = Keypair.generate();
  const treasury = Keypair.generate();
  svm.airdrop(admin.publicKey, BigInt(1_000 * LAMPORTS_PER_SOL));
  svm.airdrop(treasury.publicKey, BigInt(LAMPORTS_PER_SOL));
  return { svm, admin, treasury };
}

export function fundedKeypair(svm: LiteSVM, sol = 100): Keypair {
  const kp = Keypair.generate();
  svm.airdrop(kp.publicKey, BigInt(sol * LAMPORTS_PER_SOL));
  return kp;
}

/** Send and assert success, surfacing program logs when it fails. */
export function send(
  svm: LiteSVM,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): void {
  const tx = new Transaction();
  tx.recentBlockhash = svm.latestBlockhash();
  tx.feePayer = signers[0].publicKey;
  for (const ix of ixs) tx.add(ix);
  tx.sign(...signers);
  const result = svm.sendTransaction(tx);
  if (result instanceof FailedTransactionMetadata) {
    throw new Error(
      `tx failed: ${result.err().toString()}\n${result.meta().logs().join("\n")}`,
    );
  }
}

/** Send expecting failure; returns the joined logs for assertion. */
export function sendExpectingError(
  svm: LiteSVM,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): string {
  const tx = new Transaction();
  tx.recentBlockhash = svm.latestBlockhash();
  tx.feePayer = signers[0].publicKey;
  for (const ix of ixs) tx.add(ix);
  tx.sign(...signers);
  const result = svm.sendTransaction(tx);
  if (!(result instanceof FailedTransactionMetadata)) {
    throw new Error("expected transaction to fail, but it succeeded");
  }
  return result.meta().logs().join("\n");
}

export function warp(svm: LiteSVM, seconds: number): void {
  const clock = svm.getClock();
  clock.unixTimestamp = clock.unixTimestamp + BigInt(seconds);
  svm.setClock(clock);
  svm.expireBlockhash();
}

export function now(svm: LiteSVM): number {
  return Number(svm.getClock().unixTimestamp);
}

/** Address of the BPF loader's ProgramData account for the VISE program. */
export function programDataAddress(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    BPF_LOADER_UPGRADEABLE,
  )[0];
}

/**
 * Install a ProgramData account naming `authority` as the upgrade authority.
 *
 * LiteSVM loads a program without the loader's bookkeeping account, so the
 * on-chain check that only the upgrade authority may create the config has
 * nothing to read until this writes one.
 *
 * Layout: 4-byte enum (3 = ProgramData), 8-byte slot, 1-byte Option tag, 32-byte
 * authority.
 */
export function setUpgradeAuthority(svm: LiteSVM, authority: PublicKey): void {
  const data = Buffer.alloc(45);
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(0n, 4);
  data.writeUInt8(1, 12);
  authority.toBuffer().copy(data, 13);
  svm.setAccount(programDataAddress(), {
    lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    data,
    owner: BPF_LOADER_UPGRADEABLE,
    executable: false,
  });
}

/** pump.fun's bonding curve program, same address on every cluster. */
export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

export function bondingCurveAddress(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM_ID,
  )[0];
}

/**
 * Write a pump.fun `BondingCurve` account naming `creator`.
 *
 * `create_pool` reads this to prove the signer actually launched the coin, so
 * without it every pool test would be rejected as squatting. Layout: 8-byte
 * discriminator, five u64 reserves/supply, a `complete` bool, then the creator.
 */
export function setPumpCurve(
  svm: LiteSVM,
  mint: PublicKey,
  creator: PublicKey,
  opts: { complete?: boolean } = {},
): PublicKey {
  const data = Buffer.alloc(8 + 5 * 8 + 1 + 32);
  data.writeBigUInt64LE(1_073_000_000_000_000n, 8);
  data.writeBigUInt64LE(30_000_000_000n, 16);
  data.writeBigUInt64LE(793_100_000_000_000n, 24);
  data.writeBigUInt64LE(0n, 32);
  data.writeBigUInt64LE(1_000_000_000_000_000n, 40);
  data.writeUInt8(opts.complete ? 1 : 0, 48);
  creator.toBuffer().copy(data, 49);

  const address = bondingCurveAddress(mint);
  svm.setAccount(address, {
    lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    data,
    owner: PUMP_PROGRAM_ID,
    executable: false,
  });
  return address;
}

export interface MintOptions {
  decimals?: number;
  freezeAuthority?: PublicKey | null;
  /** Adds a MetadataPointer extension, mirroring a real pump.fun coin. */
  metadataPointer?: boolean;
  /** Adds a TransferFeeConfig extension, which the pool guard must reject. */
  transferFee?: boolean;
  legacy?: boolean;
}

/**
 * Create a mint and fund holders, mirroring how a pump.fun coin looks on chain
 * (Token-2022, 6 decimals, metadata pointer, no freeze authority).
 */
export function createMint(
  svm: LiteSVM,
  payer: Keypair,
  holders: Array<{ owner: PublicKey; amount: bigint }>,
  opts: MintOptions = {},
): { mint: PublicKey; tokenProgram: PublicKey; decimals: number } {
  const decimals = opts.decimals ?? 6;
  const tokenProgram = opts.legacy ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  const mintKp = Keypair.generate();
  const extensions: ExtensionType[] = [];
  if (opts.metadataPointer) extensions.push(ExtensionType.MetadataPointer);
  if (opts.transferFee) extensions.push(ExtensionType.TransferFeeConfig);
  const space = opts.legacy ? MINT_SIZE : getMintLen(extensions);

  const ixs: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKp.publicKey,
      space,
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(space))),
      programId: tokenProgram,
    }),
  ];
  if (opts.metadataPointer) {
    ixs.push(
      createInitializeMetadataPointerInstruction(
        mintKp.publicKey,
        payer.publicKey,
        mintKp.publicKey,
        tokenProgram,
      ),
    );
  }
  if (opts.transferFee) {
    ixs.push(
      createInitializeTransferFeeConfigInstruction(
        mintKp.publicKey,
        payer.publicKey,
        payer.publicKey,
        100,
        BigInt(1_000_000),
        tokenProgram,
      ),
    );
  }
  ixs.push(
    createInitializeMint2Instruction(
      mintKp.publicKey,
      decimals,
      payer.publicKey,
      opts.freezeAuthority ?? null,
      tokenProgram,
    ),
  );
  send(svm, ixs, [payer, mintKp]);

  for (const holder of holders) {
    const ata = getAssociatedTokenAddressSync(
      mintKp.publicKey,
      holder.owner,
      true,
      tokenProgram,
    );
    send(
      svm,
      [
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ata,
          holder.owner,
          mintKp.publicKey,
          tokenProgram,
        ),
        createMintToInstruction(
          mintKp.publicKey,
          ata,
          payer.publicKey,
          holder.amount,
          [],
          tokenProgram,
        ),
      ],
      [payer],
    );
  }

  /*
   * Mint the rest of a pump.fun supply to the payer. Size tiers are a share of
   * total supply, and a mint holding only what the test's holders need would
   * put a ten-thousand-token lock in the top tier — the opposite of reality,
   * where it is a rounding error against a billion.
   */
  const PUMP_SUPPLY = 1_000_000_000n * 10n ** BigInt(decimals);
  const distributed = holders.reduce((sum, holder) => sum + holder.amount, 0n);
  if (distributed < PUMP_SUPPLY) {
    const ata = getAssociatedTokenAddressSync(mintKp.publicKey, payer.publicKey, true, tokenProgram);
    const ixs: TransactionInstruction[] = [];
    if (!holders.some((holder) => holder.owner.equals(payer.publicKey))) {
      ixs.push(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ata,
          payer.publicKey,
          mintKp.publicKey,
          tokenProgram,
        ),
      );
    }
    ixs.push(
      createMintToInstruction(
        mintKp.publicKey,
        ata,
        payer.publicKey,
        PUMP_SUPPLY - distributed,
        [],
        tokenProgram,
      ),
    );
    send(svm, ixs, [payer]);
  }

  return { mint: mintKp.publicKey, tokenProgram, decimals };
}

export function tokenBalance(
  svm: LiteSVM,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey,
): bigint {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
  const account = svm.getAccount(ata);
  if (!account) return 0n;
  // SPL token account layout: amount is a u64 at offset 64.
  return Buffer.from(account.data).readBigUInt64LE(64);
}

export function mintSupply(svm: LiteSVM, mint: PublicKey): bigint {
  const account = svm.getAccount(mint);
  if (!account) throw new Error("mint not found");
  // Mint layout: supply is a u64 at offset 36.
  return Buffer.from(account.data).readBigUInt64LE(36);
}

export function lamports(svm: LiteSVM, address: PublicKey): bigint {
  return svm.getBalance(address) ?? 0n;
}

export { Clock, LiteSVM, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID };
