import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  decodeConfig,
  decodePool,
  decodePosition,
  VISE_IDL,
  type ConfigAccount,
  type PoolAccount,
  type PositionAccount,
} from "./accounts.ts";
import { ECONOMICS, VISE_PROGRAM_ID, type Economics } from "./constants.ts";
import { projectSync, type PoolTerms } from "./math.ts";
import {
  bondingCurvePda,
  configPda,
  poolPda,
  positionPda,
  rewardVaultPda,
  tokenVaultPda,
} from "./pda.ts";

/** Byte length of a `Position` account, discriminator included. */
export const POSITION_ACCOUNT_SIZE = 8 + 32 + 32 + 4 + 8 + 16 + 4 + 8 + 8 + 16 + 8 + 1 + 8 + 32;

/**
 * Remaining accounts that price a lock on a capped pool whose coin has
 * graduated: the canonical pump AMM pool's base and quote vaults
 * (`ammVaultsFor`). Omit while the coin is on its bonding curve.
 */
function ammRemaining(vaults: [PublicKey, PublicKey] | undefined) {
  return (vaults ?? []).map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }));
}

export type { ConfigAccount, PoolAccount, PositionAccount };


/**
 * Thin instruction-builder around the VISE program.
 *
 * Deliberately never signs or sends: the API builds transactions and the user's
 * wallet is the only thing that ever holds a key.
 */
export class ViseClient {
  readonly program: Program;
  readonly connection: Connection;
  readonly programId: PublicKey;

  constructor(connection: Connection, programId: PublicKey = VISE_PROGRAM_ID) {
    this.connection = connection;
    this.programId = programId;
    // Read-only provider: no wallet, so any accidental `.rpc()` call throws
    // rather than silently signing with something unexpected.
    const provider = new AnchorProvider(
      connection,
      {
        publicKey: PublicKey.default,
        signTransaction: () => {
          throw new Error("ViseClient is read-only; sign in the wallet");
        },
        signAllTransactions: () => {
          throw new Error("ViseClient is read-only; sign in the wallet");
        },
      } as never,
      { commitment: "confirmed" },
    );
    this.program = new Program({ ...VISE_IDL, address: programId.toBase58() } as Idl, provider);
  }

  async fetchConfig(): Promise<ConfigAccount | null> {
    const info = await this.connection.getAccountInfo(configPda(this.programId));
    return info ? decodeConfig(info.data) : null;
  }

  async fetchPool(mint: PublicKey): Promise<PoolAccount | null> {
    const info = await this.connection.getAccountInfo(poolPda(mint, this.programId));
    return info ? decodePool(info.data) : null;
  }

  /**
   * The pool as `sync` would leave it right now.
   *
   * Reads the account and its vault in one round trip and replays the
   * program's stream arithmetic against the live balance, so callers quoting
   * "pending" get the figure a claim would pay rather than the figure at the
   * last time someone happened to touch the pool.
   */
  async fetchProjectedPool(
    mint: PublicKey,
    now: number = Math.floor(Date.now() / 1000),
  ): Promise<(PoolAccount & { released: bigint; inflow: bigint }) | null> {
    const [poolInfo, vaultInfo] = await this.connection.getMultipleAccountsInfo([
      poolPda(mint, this.programId),
      rewardVaultPda(mint, this.programId),
    ]);
    if (!poolInfo) return null;
    const pool = decodePool(poolInfo.data);
    return projectSync(pool, BigInt(vaultInfo?.lamports ?? 0), now);
  }

  /** Every position a wallet holds, across all pools. */
  async fetchPositionsByOwner(
    owner: PublicKey,
  ): Promise<Array<PositionAccount & { address: PublicKey }>> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { dataSize: POSITION_ACCOUNT_SIZE },
        { memcmp: { offset: 8, bytes: owner.toBase58() } },
      ],
    });
    return accounts.map(({ pubkey, account }) => ({
      address: pubkey,
      ...decodePosition(account.data),
    }));
  }

  /** Every position in one pool, for the pool page's locker table. */
  async fetchPositionsByPool(
    mint: PublicKey,
  ): Promise<Array<PositionAccount & { address: PublicKey }>> {
    const pool = poolPda(mint, this.programId);
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [{ memcmp: { offset: 8 + 32, bytes: pool.toBase58() } }],
    });
    return accounts.map(({ pubkey, account }) => ({
      address: pubkey,
      ...decodePosition(account.data),
    }));
  }

  /**
   * The platform config, as the `initialize_config` / `update_config`
   * instructions take it, built from `ECONOMICS`. Every writer of the config
   * goes through here so the numbers on chain are the numbers in the SDK.
   */
  static configArgs(params: {
    treasury: PublicKey;
    paused?: boolean;
    overrides?: Partial<Economics>;
  }) {
    const e = { ...ECONOMICS, ...params.overrides };
    return {
      treasury: params.treasury,
      tradeFeeBps: e.tradeFeeBps,
      defaultTreasuryShareBps: e.treasuryShareBps,
      maxCreatorShareBps: e.maxCreatorShareBps,
      defaultMinLockSecs: e.minLockSecs,
      defaultMaxLockSecs: e.maxLockSecs,
      defaultMaxMultiplierBps: e.maxMultiplierBps,
      defaultEarlyUnlockPenaltyBps: e.earlyUnlockPenaltyBps,
      defaultMinLockAmount: new BN(e.minLockAmount.toString()),
      defaultRewardStreamSecs: e.rewardStreamSecs,
      defaultDurationCurve: e.durationCurve,
      defaultSizeTierBps: [...e.sizeTierBps],
      defaultSizeBonusBps: [...e.sizeBonusBps],
      poolCreationFee: new BN(e.poolCreationFeeLamports.toString()),
      paused: params.paused ?? false,
    };
  }

  /** Pool terms as the on-chain defaults will stamp them, for previews. */
  static defaultTerms(): PoolTerms {
    return {
      treasuryShareBps: ECONOMICS.treasuryShareBps,
      creatorShareBps: 0,
      minLockSecs: ECONOMICS.minLockSecs,
      maxLockSecs: ECONOMICS.maxLockSecs,
      maxMultiplierBps: ECONOMICS.maxMultiplierBps,
      earlyUnlockPenaltyBps: ECONOMICS.earlyUnlockPenaltyBps,
      minLockAmount: ECONOMICS.minLockAmount,
      rewardStreamSecs: ECONOMICS.rewardStreamSecs,
      durationCurve: ECONOMICS.durationCurve,
      sizeTierBps: [...ECONOMICS.sizeTierBps],
      sizeBonusBps: [...ECONOMICS.sizeBonusBps],
    };
  }

  async createPool(params: {
    creator: PublicKey;
    mint: PublicKey;
    treasury: PublicKey;
    tokenProgram?: PublicKey;
    creatorShareBps: number;
    initialLockAmount: bigint;
    initialLockDuration: number;
    ammVaults?: [PublicKey, PublicKey];
  }): Promise<TransactionInstruction> {
    const tokenProgram = params.tokenProgram ?? TOKEN_2022_PROGRAM_ID;
    return this.program.methods
      .createPool({
        creatorShareBps: params.creatorShareBps,
        initialLockAmount: new BN(params.initialLockAmount.toString()),
        initialLockDuration: params.initialLockDuration,
      })
      .accountsPartial({
        creator: params.creator,
        config: configPda(this.programId),
        treasury: params.treasury,
        mint: params.mint,
        // Proves the signer is the coin's creator on pump.fun (the program
        // reads `BondingCurve::creator`) and prices the founding lock.
        bondingCurve: bondingCurvePda(params.mint),
        tokenVault: tokenVaultPda(params.mint, this.programId),
        rewardVault: rewardVaultPda(params.mint, this.programId),
        position: positionPda(params.mint, params.creator, 0, this.programId),
        creatorTokenAccount: getAssociatedTokenAddressSync(
          params.mint,
          params.creator,
          true,
          tokenProgram,
        ),
        tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(ammRemaining(params.ammVaults))
      .instruction();
  }

  async lock(params: {
    owner: PublicKey;
    mint: PublicKey;
    index: number;
    amount: bigint;
    durationSecs: number;
    tokenProgram?: PublicKey;
    ammVaults?: [PublicKey, PublicKey];
  }): Promise<TransactionInstruction> {
    const tokenProgram = params.tokenProgram ?? TOKEN_2022_PROGRAM_ID;
    return this.program.methods
      .lock(params.index, new BN(params.amount.toString()), params.durationSecs)
      .accountsPartial({
        owner: params.owner,
        pool: poolPda(params.mint, this.programId),
        mint: params.mint,
        tokenVault: tokenVaultPda(params.mint, this.programId),
        rewardVault: rewardVaultPda(params.mint, this.programId),
        bondingCurve: bondingCurvePda(params.mint),
        position: positionPda(params.mint, params.owner, params.index, this.programId),
        ownerTokenAccount: getAssociatedTokenAddressSync(
          params.mint,
          params.owner,
          true,
          tokenProgram,
        ),
        tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(ammRemaining(params.ammVaults))
      .instruction();
  }

  /** Accounts shared by `increase` and `extend`. */
  private modifyAccounts(params: {
    owner: PublicKey;
    mint: PublicKey;
    index: number;
    tokenProgram: PublicKey;
  }) {
    return {
      owner: params.owner,
      pool: poolPda(params.mint, this.programId),
      mint: params.mint,
      tokenVault: tokenVaultPda(params.mint, this.programId),
      rewardVault: rewardVaultPda(params.mint, this.programId),
      bondingCurve: bondingCurvePda(params.mint),
      position: positionPda(params.mint, params.owner, params.index, this.programId),
      ownerTokenAccount: getAssociatedTokenAddressSync(
        params.mint,
        params.owner,
        true,
        params.tokenProgram,
      ),
      tokenProgram: params.tokenProgram,
      systemProgram: SystemProgram.programId,
    };
  }

  /** Add principal to a live lock without changing its unlock time. */
  async increase(params: {
    owner: PublicKey;
    mint: PublicKey;
    index: number;
    amount: bigint;
    tokenProgram?: PublicKey;
    ammVaults?: [PublicKey, PublicKey];
  }): Promise<TransactionInstruction> {
    const tokenProgram = params.tokenProgram ?? TOKEN_2022_PROGRAM_ID;
    return this.program.methods
      .increase(new BN(params.amount.toString()))
      .accountsPartial(this.modifyAccounts({ ...params, tokenProgram }))
      .remainingAccounts(ammRemaining(params.ammVaults))
      .instruction();
  }

  /**
   * Push the unlock time out to `durationSecs` from now, repricing the
   * multiplier. The program rejects anything that would shorten the term.
   */
  async extend(params: {
    owner: PublicKey;
    mint: PublicKey;
    index: number;
    durationSecs: number;
    tokenProgram?: PublicKey;
    ammVaults?: [PublicKey, PublicKey];
  }): Promise<TransactionInstruction> {
    const tokenProgram = params.tokenProgram ?? TOKEN_2022_PROGRAM_ID;
    return this.program.methods
      .extend(params.durationSecs)
      .accountsPartial(this.modifyAccounts({ ...params, tokenProgram }))
      .remainingAccounts(ammRemaining(params.ammVaults))
      .instruction();
  }

  /**
   * `claim` on someone else's behalf: pays the position's owner. On a capped
   * pool this retires a lock that has reached its cap, sending the excess to
   * the treasury.
   */
  async harvest(params: {
    payer: PublicKey;
    owner: PublicKey;
    mint: PublicKey;
    index: number;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .harvest()
      .accountsPartial({
        payer: params.payer,
        owner: params.owner,
        pool: poolPda(params.mint, this.programId),
        rewardVault: rewardVaultPda(params.mint, this.programId),
        position: positionPda(params.mint, params.owner, params.index, this.programId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** Grow a pool or position written before earnings limits to the current layout. */
  async migrate(params: { payer: PublicKey; target: PublicKey }): Promise<TransactionInstruction> {
    return this.program.methods
      .migrate()
      .accountsPartial({
        payer: params.payer,
        target: params.target,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async claim(params: {
    owner: PublicKey;
    mint: PublicKey;
    index: number;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .claim()
      .accountsPartial({
        owner: params.owner,
        pool: poolPda(params.mint, this.programId),
        rewardVault: rewardVaultPda(params.mint, this.programId),
        position: positionPda(params.mint, params.owner, params.index, this.programId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Close a position.
   *
   * A matured position may be closed by anyone — principal, rewards and rent
   * all go to `owner` regardless — so `payer` defaults to the owner but a
   * keeper can pass its own key. An early exit is owner-only; the program
   * rejects anyone else.
   *
   * Principal is only ever paid into the owner's associated token account,
   * which must already exist. Use `unlockInstructions` unless the caller knows
   * it does.
   */
  async unlock(params: {
    owner: PublicKey;
    mint: PublicKey;
    index: number;
    early: boolean;
    payer?: PublicKey;
    tokenProgram?: PublicKey;
  }): Promise<TransactionInstruction> {
    const tokenProgram = params.tokenProgram ?? TOKEN_2022_PROGRAM_ID;
    const accounts = {
      payer: params.payer ?? params.owner,
      owner: params.owner,
      pool: poolPda(params.mint, this.programId),
      mint: params.mint,
      tokenVault: tokenVaultPda(params.mint, this.programId),
      rewardVault: rewardVaultPda(params.mint, this.programId),
      position: positionPda(params.mint, params.owner, params.index, this.programId),
      ownerTokenAccount: getAssociatedTokenAddressSync(
        params.mint,
        params.owner,
        true,
        tokenProgram,
      ),
      tokenProgram,
      systemProgram: SystemProgram.programId,
    };
    const builder = params.early
      ? this.program.methods.earlyUnlock()
      : this.program.methods.unlock();
    return builder.accountsPartial(accounts).instruction();
  }

  /**
   * `unlock`, preceded by an idempotent create of the owner's associated token
   * account paid by `payer`. The owner may have closed that account since
   * locking; without it the principal has nowhere the program will send it.
   */
  async unlockInstructions(params: {
    owner: PublicKey;
    mint: PublicKey;
    index: number;
    early: boolean;
    payer?: PublicKey;
    tokenProgram?: PublicKey;
  }): Promise<TransactionInstruction[]> {
    const tokenProgram = params.tokenProgram ?? TOKEN_2022_PROGRAM_ID;
    const payer = params.payer ?? params.owner;
    return [
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        getAssociatedTokenAddressSync(params.mint, params.owner, true, tokenProgram),
        params.owner,
        params.mint,
        tokenProgram,
      ),
      await this.unlock({ ...params, payer, tokenProgram }),
    ];
  }

  /** App-fee leg appended to routed swaps; also usable as a plain donation. */
  async depositReward(params: {
    payer: PublicKey;
    mint: PublicKey;
    lamports: bigint;
    kind: number;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .depositReward(new BN(params.lamports.toString()), params.kind)
      .accountsPartial({
        payer: params.payer,
        pool: poolPda(params.mint, this.programId),
        rewardVault: rewardVaultPda(params.mint, this.programId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async sync(mint: PublicKey): Promise<TransactionInstruction> {
    return this.program.methods
      .sync()
      .accountsPartial({
        pool: poolPda(mint, this.programId),
        rewardVault: rewardVaultPda(mint, this.programId),
      })
      .instruction();
  }

  async claimTreasury(params: {
    payer: PublicKey;
    mint: PublicKey;
    treasury: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .claimTreasury()
      .accountsPartial({
        payer: params.payer,
        pool: poolPda(params.mint, this.programId),
        treasury: params.treasury,
        rewardVault: rewardVaultPda(params.mint, this.programId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async claimCreator(params: {
    creator: PublicKey;
    mint: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .claimCreator()
      .accountsPartial({
        creator: params.creator,
        pool: poolPda(params.mint, this.programId),
        rewardVault: rewardVaultPda(params.mint, this.programId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }
}

export { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID };
