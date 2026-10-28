import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  type AccountMeta,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  decodeConfig,
  decodePool,
  decodePosition,
  IMAGINE_IDL,
  type ConfigAccount,
  type PoolAccount,
  type PositionAccount,
} from "./accounts.ts";
import { ECONOMICS, IMAGINE_PROGRAM_ID, type Economics } from "./constants.ts";
import {
  cpmmPoolPda,
  cpmmVaultPda,
  globalConfigPda,
  launchLabAuthorityPda,
  launchLabEventAuthorityPda,
  launchLabPoolPda,
  launchLabPoolVaultPda,
  platformAllowConfigPda,
  platformCurveRulePda,
  LAUNCHLAB_PROGRAM_ID,
  CPMM_PROGRAM_ID,
  cpmmAuthorityPda,
  cpmmCreatorFeeSharePda,
  cpmmTokenOrder,
  creatorFeeVaultAuthorityPda,
  creatorFeeVaultPda,
} from "./launchlab.ts";
import { distributableBalance, projectSync, type PoolTerms } from "./math.ts";
import {
  configPda,
  poolPda,
  positionPda,
  rewardTokenAccount,
  rewardVaultPda,
  tokenVaultPda,
} from "./pda.ts";
import type { Imagine } from "./idl/imagine-types.ts";
import { isNativeQuote } from "./quotes.ts";

/** Byte length of a `Position` account, discriminator included. */
export const POSITION_ACCOUNT_SIZE = 8 + 32 + 32 + 4 + 8 + 16 + 4 + 8 + 8 + 16 + 8 + 1 + 8 + 1 + 31;

/** A pool's quote, as stored on the pool (`quoteMint`, `quoteTokenProgram`). */
export interface QuoteRef {
  mint: PublicKey;
  tokenProgram: PublicKey;
}

/**
 * Remaining accounts that price a lock once the coin has migrated off its
 * LaunchLab curve: the canonical CPMM pool of (coin, quote) under
 * `ammConfig` (the platform's `cpswap_config`) and its coin and quote
 * vaults, in the order `price::valuation_accounts` reads them. Pass nothing
 * while the coin is still on its curve.
 */
export function valuationAccounts(
  mint: PublicKey,
  quoteMint: PublicKey,
  ammConfig: PublicKey,
): [PublicKey, PublicKey, PublicKey] {
  const pool = cpmmPoolPda(ammConfig, mint, quoteMint);
  return [pool, cpmmVaultPda(pool, mint), cpmmVaultPda(pool, quoteMint)];
}

function readonlyMetas(keys: PublicKey[] | undefined): AccountMeta[] {
  return (keys ?? []).map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }));
}

export type { ConfigAccount, PoolAccount, PositionAccount };

/**
 * Thin instruction-builder around the IMAGINE program.
 *
 * Deliberately never signs or sends: the API builds transactions and the user's
 * wallet is the only thing that ever holds a key.
 *
 * Every builder that pays quote out takes the pool's `quote` and returns the
 * instructions to send, including an idempotent create of the recipient's
 * quote associated token account when the quote is not SOL.
 */
export class ImagineClient {
  readonly program: Program<Imagine>;
  readonly connection: Connection;
  readonly programId: PublicKey;

  constructor(connection: Connection, programId: PublicKey = IMAGINE_PROGRAM_ID) {
    this.connection = connection;
    this.programId = programId;
    // Read-only provider: no wallet, so any accidental `.rpc()` call throws
    // rather than silently signing with something unexpected.
    const provider = new AnchorProvider(
      connection,
      {
        publicKey: PublicKey.default,
        signTransaction: () => {
          throw new Error("ImagineClient is read-only; sign in the wallet");
        },
        signAllTransactions: () => {
          throw new Error("ImagineClient is read-only; sign in the wallet");
        },
      } as never,
      { commitment: "confirmed" },
    );
    this.program = new Program<Imagine>(
      { ...(IMAGINE_IDL as Imagine), address: programId.toBase58() },
      provider,
    );
  }

  async fetchConfig(): Promise<ConfigAccount | null> {
    const info = await this.connection.getAccountInfo(configPda(this.programId));
    return info ? decodeConfig(info.data) : null;
  }

  async fetchPool(mint: PublicKey): Promise<PoolAccount | null> {
    const info = await this.connection.getAccountInfo(poolPda(mint, this.programId));
    return info ? decodePool(info.data) : null;
  }

  async fetchPosition(mint: PublicKey, owner: PublicKey, index: number): Promise<PositionAccount | null> {
    const info = await this.connection.getAccountInfo(positionPda(mint, owner, index, this.programId));
    return info ? decodePosition(info.data) : null;
  }

  /**
   * The pool as `sync` would leave it right now.
   *
   * Reads the account and its reward balance (vault lamports, or the reward
   * token account for a token quote) and replays the program's stream
   * arithmetic against it, so callers quoting "pending" get the figure a claim
   * would pay rather than the figure at the last time someone touched the pool.
   */
  async fetchProjectedPool(
    mint: PublicKey,
    now: number = Math.floor(Date.now() / 1000),
  ): Promise<(PoolAccount & { released: bigint; inflow: bigint }) | null> {
    const poolInfo = await this.connection.getAccountInfo(poolPda(mint, this.programId));
    if (!poolInfo) return null;
    const pool = decodePool(poolInfo.data);
    let balance: bigint;
    if (isNativeQuote(pool.quoteMint)) {
      const lamports = await this.connection.getBalance(pool.rewardVault);
      balance = distributableBalance(pool, { vaultLamports: BigInt(lamports) });
    } else {
      const info = await this.connection.getAccountInfo(pool.rewardTokenAccount);
      const amount = info && info.data.length >= 72 ? info.data.readBigUInt64LE(64) : 0n;
      balance = distributableBalance(pool, { rewardTokenAmount: amount });
    }
    return projectSync(pool, balance, now);
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
      filters: [
        { dataSize: POSITION_ACCOUNT_SIZE },
        { memcmp: { offset: 8 + 32, bytes: pool.toBase58() } },
      ],
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
    /** IMAGINE's LaunchLab PlatformConfig (`platformConfigPda(platformAdmin)`). */
    launchlabPlatform: PublicKey;
    paused?: boolean;
    overrides?: Partial<Economics>;
  }) {
    const e = { ...ECONOMICS, ...params.overrides };
    return {
      treasury: params.treasury,
      launchlabPlatform: params.launchlabPlatform,
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

  /**
   * The reward-side accounts every pool instruction takes: the vault, and for
   * a token quote its token account, mint and program. Absent optional
   * accounts are `null`.
   */
  private rewardAccounts(mint: PublicKey, quote: QuoteRef) {
    const native = isNativeQuote(quote.mint);
    return {
      rewardVault: rewardVaultPda(mint, this.programId),
      rewardTokenAccount: rewardTokenAccount(mint, quote.mint, quote.tokenProgram, this.programId),
      quoteMint: native ? null : quote.mint,
      quoteTokenProgram: native ? null : quote.tokenProgram,
    };
  }

  /** `recipient`'s quote ATA, or `null` for a SOL quote. */
  private quoteAccountOf(recipient: PublicKey, quote: QuoteRef): PublicKey | null {
    if (isNativeQuote(quote.mint)) return null;
    return getAssociatedTokenAddressSync(quote.mint, recipient, true, quote.tokenProgram);
  }

  /** Idempotent create of `recipient`'s quote ATA, paid by `payer` (none for SOL). */
  private quoteAtaIxs(payer: PublicKey, recipient: PublicKey, quote: QuoteRef): TransactionInstruction[] {
    const ata = this.quoteAccountOf(recipient, quote);
    if (!ata) return [];
    return [
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        ata,
        recipient,
        quote.mint,
        quote.tokenProgram,
      ),
    ];
  }

  /**
   * Create a coin on Raydium LaunchLab under the IMAGINE platform, and its
   * pool, in one instruction.
   *
   * `mint` is a fresh keypair's public key; it must sign the transaction with
   * `creator`. The curve shape (`supply`, `totalSell`, `fundRaising`) must
   * pass the quote's GlobalConfig, or LaunchLab rejects it. Follow with a
   * LaunchLab `buy_exact_in` for the dev buy and `found`. `restricted`: the
   * platform restricts global configs or curve params (its decoded
   * `restrictGlobalConfig || restrictCurveParam`); only then are its
   * allow-config and curve-rule accounts appended.
   */
  async launch(params: {
    creator: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
    treasury: PublicKey;
    name: string;
    symbol: string;
    uri: string;
    supply: bigint;
    totalSell: bigint;
    fundRaising: bigint;
    creatorShareBps?: number;
    /** The quote's LaunchLab GlobalConfig; defaults to curve type 0, index 0. */
    globalConfig?: PublicKey;
    /** The config's `launchlabPlatform`. */
    platform: PublicKey;
    restricted?: boolean;
  }): Promise<TransactionInstruction> {
    const platform = params.platform;
    const globalConfig = params.globalConfig ?? globalConfigPda(params.quote.mint);
    const llPool = launchLabPoolPda(params.mint, params.quote.mint);
    const native = isNativeQuote(params.quote.mint);
    return this.program.methods
      .launch({
        name: params.name,
        symbol: params.symbol,
        uri: params.uri,
        supply: new BN(params.supply.toString()),
        totalSell: new BN(params.totalSell.toString()),
        fundRaising: new BN(params.fundRaising.toString()),
        creatorShareBps: params.creatorShareBps ?? 0,
      })
      .accountsPartial({
        creator: params.creator,
        config: configPda(this.programId),
        treasury: params.treasury,
        mint: params.mint,
        quoteMint: params.quote.mint,
        quoteTokenProgram: params.quote.tokenProgram,
        pool: poolPda(params.mint, this.programId),
        rewardVault: rewardVaultPda(params.mint, this.programId),
        rewardTokenAccount: native
          ? null
          : rewardTokenAccount(params.mint, params.quote.mint, params.quote.tokenProgram, this.programId),
        globalConfig,
        launchlabPlatform: platform,
        launchlabAuthority: launchLabAuthorityPda(),
        launchlabPool: llPool,
        launchlabBaseVault: launchLabPoolVaultPda(llPool, params.mint),
        launchlabQuoteVault: launchLabPoolVaultPda(llPool, params.quote.mint),
        launchlabEventAuthority: launchLabEventAuthorityPda(),
        launchlabProgram: LAUNCHLAB_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(
        params.restricted
          ? readonlyMetas([
              platformAllowConfigPda(platform, globalConfig),
              platformCurveRulePda(platform, globalConfig),
            ])
          : [],
      )
      .instruction();
  }

  /**
   * Open the pool with the creator's founding lock (once, creator only).
   * `valuation` only for a coin that has already migrated
   * (`valuationAccounts`).
   */
  async found(params: {
    creator: PublicKey;
    mint: PublicKey;
    quoteMint: PublicKey;
    initialLockAmount: bigint;
    initialLockDuration: number;
    valuation?: PublicKey[];
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .found(new BN(params.initialLockAmount.toString()), params.initialLockDuration)
      .accountsPartial({
        creator: params.creator,
        config: configPda(this.programId),
        pool: poolPda(params.mint, this.programId),
        mint: params.mint,
        tokenVault: tokenVaultPda(params.mint, this.programId),
        launchlabPool: launchLabPoolPda(params.mint, params.quoteMint),
        position: positionPda(params.mint, params.creator, 0, this.programId),
        creatorTokenAccount: getAssociatedTokenAddressSync(
          params.mint,
          params.creator,
          true,
          TOKEN_2022_PROGRAM_ID,
        ),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(readonlyMetas(params.valuation))
      .instruction();
  }

  async lock(params: {
    owner: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
    index: number;
    amount: bigint;
    durationSecs: number;
    valuation?: PublicKey[];
  }): Promise<TransactionInstruction> {
    const reward = this.rewardAccounts(params.mint, params.quote);
    return this.program.methods
      .lock(params.index, new BN(params.amount.toString()), params.durationSecs)
      .accountsPartial({
        owner: params.owner,
        pool: poolPda(params.mint, this.programId),
        mint: params.mint,
        tokenVault: tokenVaultPda(params.mint, this.programId),
        rewardVault: reward.rewardVault,
        rewardTokenAccount: reward.rewardTokenAccount,
        launchlabPool: launchLabPoolPda(params.mint, params.quote.mint),
        position: positionPda(params.mint, params.owner, params.index, this.programId),
        ownerTokenAccount: getAssociatedTokenAddressSync(
          params.mint,
          params.owner,
          true,
          TOKEN_2022_PROGRAM_ID,
        ),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(readonlyMetas(params.valuation))
      .instruction();
  }

  /** Accounts shared by `increase` and `extend`. */
  private modifyAccounts(params: { owner: PublicKey; mint: PublicKey; quote: QuoteRef; index: number }) {
    return {
      owner: params.owner,
      pool: poolPda(params.mint, this.programId),
      mint: params.mint,
      tokenVault: tokenVaultPda(params.mint, this.programId),
      ...this.rewardAccounts(params.mint, params.quote),
      ownerQuoteAccount: this.quoteAccountOf(params.owner, params.quote),
      launchlabPool: launchLabPoolPda(params.mint, params.quote.mint),
      position: positionPda(params.mint, params.owner, params.index, this.programId),
      ownerTokenAccount: getAssociatedTokenAddressSync(
        params.mint,
        params.owner,
        true,
        TOKEN_2022_PROGRAM_ID,
      ),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }

  /** Add principal to a live lock without changing its unlock time. */
  async increase(params: {
    owner: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
    index: number;
    amount: bigint;
    valuation?: PublicKey[];
  }): Promise<TransactionInstruction[]> {
    const ix = await this.program.methods
      .increase(new BN(params.amount.toString()))
      .accountsPartial(this.modifyAccounts(params))
      .remainingAccounts(readonlyMetas(params.valuation))
      .instruction();
    return [...this.quoteAtaIxs(params.owner, params.owner, params.quote), ix];
  }

  /**
   * Push the unlock time out to `durationSecs` from now, repricing the
   * multiplier. The program rejects anything that would shorten the term.
   */
  async extend(params: {
    owner: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
    index: number;
    durationSecs: number;
    valuation?: PublicKey[];
  }): Promise<TransactionInstruction[]> {
    const ix = await this.program.methods
      .extend(params.durationSecs)
      .accountsPartial(this.modifyAccounts(params))
      .remainingAccounts(readonlyMetas(params.valuation))
      .instruction();
    return [...this.quoteAtaIxs(params.owner, params.owner, params.quote), ix];
  }

  async claim(params: {
    owner: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
    index: number;
  }): Promise<TransactionInstruction[]> {
    const ix = await this.program.methods
      .claim()
      .accountsPartial({
        owner: params.owner,
        pool: poolPda(params.mint, this.programId),
        ...this.rewardAccounts(params.mint, params.quote),
        ownerQuoteAccount: this.quoteAccountOf(params.owner, params.quote),
        position: positionPda(params.mint, params.owner, params.index, this.programId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return [...this.quoteAtaIxs(params.owner, params.owner, params.quote), ix];
  }

  /**
   * `claim` on someone else's behalf: pays the position's owner. This is how
   * a keeper retires a lock that has reached its cap, sending the excess to
   * the treasury.
   */
  async harvest(params: {
    payer: PublicKey;
    owner: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
    index: number;
  }): Promise<TransactionInstruction[]> {
    const ix = await this.program.methods
      .harvest()
      .accountsPartial({
        payer: params.payer,
        owner: params.owner,
        pool: poolPda(params.mint, this.programId),
        ...this.rewardAccounts(params.mint, params.quote),
        ownerQuoteAccount: this.quoteAccountOf(params.owner, params.quote),
        position: positionPda(params.mint, params.owner, params.index, this.programId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return [...this.quoteAtaIxs(params.payer, params.owner, params.quote), ix];
  }

  /**
   * Give up a lock's earnings for good. Tokens stay locked to the same end
   * date; what it had accrued and would earn goes to the other lockers.
   */
  async renounce(params: {
    owner: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
    index: number;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .renounce()
      .accountsPartial({
        owner: params.owner,
        pool: poolPda(params.mint, this.programId),
        rewardVault: rewardVaultPda(params.mint, this.programId),
        rewardTokenAccount: rewardTokenAccount(
          params.mint,
          params.quote.mint,
          params.quote.tokenProgram,
          this.programId,
        ),
        position: positionPda(params.mint, params.owner, params.index, this.programId),
      })
      .instruction();
  }

  /**
   * Close a position, preceded by idempotent creates of the owner's coin ATA
   * (principal only ever lands there) and, for a token quote, quote ATA,
   * paid by `payer`.
   *
   * A matured position may be closed by anyone — principal, rewards and rent
   * all go to `owner` regardless — so `payer` defaults to the owner but a
   * keeper can pass its own key. An early exit is owner-only; the program
   * rejects anyone else.
   */
  async unlock(params: {
    owner: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
    index: number;
    early: boolean;
    payer?: PublicKey;
  }): Promise<TransactionInstruction[]> {
    const payer = params.payer ?? params.owner;
    const ownerTokenAccount = getAssociatedTokenAddressSync(
      params.mint,
      params.owner,
      true,
      TOKEN_2022_PROGRAM_ID,
    );
    const accounts = {
      payer,
      owner: params.owner,
      pool: poolPda(params.mint, this.programId),
      mint: params.mint,
      tokenVault: tokenVaultPda(params.mint, this.programId),
      ...this.rewardAccounts(params.mint, params.quote),
      ownerQuoteAccount: this.quoteAccountOf(params.owner, params.quote),
      position: positionPda(params.mint, params.owner, params.index, this.programId),
      ownerTokenAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
    const builder = params.early
      ? this.program.methods.earlyUnlock()
      : this.program.methods.unlock();
    return [
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        ownerTokenAccount,
        params.owner,
        params.mint,
        TOKEN_2022_PROGRAM_ID,
      ),
      ...this.quoteAtaIxs(payer, params.owner, params.quote),
      await builder.accountsPartial(accounts).instruction(),
    ];
  }

  /**
   * App-fee leg appended to routed trades; also usable as a plain donation.
   * `amount` is quote base units: lamports for a SOL quote, otherwise taken
   * from `payerQuoteAccount` (default: the payer's quote ATA).
   */
  async depositReward(params: {
    payer: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
    amount: bigint;
    kind: number;
    payerQuoteAccount?: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .depositReward(new BN(params.amount.toString()), params.kind)
      .accountsPartial({
        payer: params.payer,
        pool: poolPda(params.mint, this.programId),
        ...this.rewardAccounts(params.mint, params.quote),
        payerQuoteAccount: isNativeQuote(params.quote.mint)
          ? null
          : (params.payerQuoteAccount ?? this.quoteAccountOf(params.payer, params.quote)),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async sync(params: { mint: PublicKey; quote: QuoteRef }): Promise<TransactionInstruction> {
    return this.program.methods
      .sync()
      .accountsPartial({
        pool: poolPda(params.mint, this.programId),
        rewardVault: rewardVaultPda(params.mint, this.programId),
        rewardTokenAccount: rewardTokenAccount(
          params.mint,
          params.quote.mint,
          params.quote.tokenProgram,
          this.programId,
        ),
      })
      .instruction();
  }

  /**
   * Permissionless: pull the coin's on-chain creator fee (LaunchLab curve,
   * and the CPMM pool's once graduated) into its pool and sync it. The pool's
   * reward vault is the coin's creator, so every trade anywhere accrues it.
   * `payer` funds any missing vault token account (a WSOL quote's transient
   * account is refunded). `graduated.ammConfig`: the CPMM AmmConfig the coin
   * migrated under (the platform's `cpswap_config`); omit while on the curve.
   */
  async collectCreatorFee(params: {
    payer: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
    graduated?: { ammConfig: PublicKey };
  }): Promise<TransactionInstruction[]> {
    const vault = rewardVaultPda(params.mint, this.programId);
    let remaining: AccountMeta[] = [];
    if (params.graduated) {
      const { ammConfig } = params.graduated;
      const pool = cpmmPoolPda(ammConfig, params.mint, params.quote.mint);
      const [token0, token1] = cpmmTokenOrder(params.mint, params.quote.mint);
      const w = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
      remaining = [
        w(pool),
        ...readonlyMetas([cpmmAuthorityPda(), ammConfig]),
        w(cpmmVaultPda(pool, token0)),
        w(cpmmVaultPda(pool, token1)),
        w(getAssociatedTokenAddressSync(params.mint, vault, true, TOKEN_2022_PROGRAM_ID)),
        ...readonlyMetas([cpmmCreatorFeeSharePda(vault, ammConfig), CPMM_PROGRAM_ID]),
      ];
    }
    const ix = await this.program.methods
      .collectCreatorFee()
      .accountsPartial({
        payer: params.payer,
        pool: poolPda(params.mint, this.programId),
        rewardVault: vault,
        vaultQuoteAccount: getAssociatedTokenAddressSync(
          params.quote.mint,
          vault,
          true,
          params.quote.tokenProgram,
        ),
        mint: params.mint,
        quoteMint: params.quote.mint,
        quoteTokenProgram: params.quote.tokenProgram,
        creatorFeeVault: creatorFeeVaultPda(vault, params.quote.mint),
        creatorFeeVaultAuthority: creatorFeeVaultAuthorityPda(),
        launchlabProgram: LAUNCHLAB_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remaining)
      .instruction();
    return [ix];
  }

  /** Permissionless: push the treasury's share to the pool's treasury. */
  async claimTreasury(params: {
    payer: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
    treasury: PublicKey;
  }): Promise<TransactionInstruction[]> {
    const ix = await this.program.methods
      .claimTreasury()
      .accountsPartial({
        payer: params.payer,
        pool: poolPda(params.mint, this.programId),
        treasury: params.treasury,
        ...this.rewardAccounts(params.mint, params.quote),
        treasuryQuoteAccount: this.quoteAccountOf(params.treasury, params.quote),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return [...this.quoteAtaIxs(params.payer, params.treasury, params.quote), ix];
  }

  async claimCreator(params: {
    creator: PublicKey;
    mint: PublicKey;
    quote: QuoteRef;
  }): Promise<TransactionInstruction[]> {
    const ix = await this.program.methods
      .claimCreator()
      .accountsPartial({
        creator: params.creator,
        pool: poolPda(params.mint, this.programId),
        ...this.rewardAccounts(params.mint, params.quote),
        creatorQuoteAccount: this.quoteAccountOf(params.creator, params.quote),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return [...this.quoteAtaIxs(params.creator, params.creator, params.quote), ix];
  }
}

export { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID };
