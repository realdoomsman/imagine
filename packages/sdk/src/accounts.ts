import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idlJson from "./idl/imagine.json" with { type: "json" };

export const IMAGINE_IDL = idlJson as Idl;

/**
 * Anchor's Borsh coder emits the IDL's own field names, which are snake_case.
 * Decoding lives here, once, so the API, the indexer, the web app, and the
 * tests can never drift apart on field naming.
 */
export const coder = new BorshCoder(IMAGINE_IDL);


/**
 * Anchor account discriminators, taken from the IDL rather than recomputed, so
 * they cannot drift from the deployed program.
 */
function discriminatorOf(name: string): Buffer {
  const account = (IMAGINE_IDL.accounts ?? []).find((a) => a.name === name);
  if (!account?.discriminator) throw new Error(`no discriminator for ${name}`);
  return Buffer.from(account.discriminator);
}

export const DISCRIMINATOR = {
  config: discriminatorOf("Config"),
  pool: discriminatorOf("Pool"),
  position: discriminatorOf("Position"),
} as const;

type Numeric = { toString(): string };

/**
 * Convert an Anchor-decoded numeric field to a bigint.
 *
 * Deliberately avoids BN's base-10 stringifier: it has been observed emitting
 * a corrupt string ("21000000NaN") for an ordinary u64, which would turn a
 * balance into a thrown error or, worse, a wrong number. The little-endian byte
 * view is exact by construction.
 */
function big(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  const bn = value as {
    toArrayLike?: (ctor: typeof Buffer, endian: string) => Buffer;
    toString(): string;
  };
  if (typeof bn?.toArrayLike === "function") {
    const bytes = bn.toArrayLike(Buffer, "le");
    let out = 0n;
    for (let i = bytes.length - 1; i >= 0; i -= 1) {
      out = (out << 8n) | BigInt(bytes[i]);
    }
    return out;
  }
  return BigInt(String(value));
}

/** Same conversion, for fields that genuinely fit in a JS number. */
function num(value: unknown): number {
  return Number(big(value));
}

/** A fixed `[u16; 3]` array, as Anchor decodes it. */
function triple(value: unknown): [number, number, number] {
  const list = value as unknown[];
  return [num(list[0]), num(list[1]), num(list[2])];
}

export interface PoolTermsAccount {
  treasuryShareBps: number;
  creatorShareBps: number;
  minLockSecs: number;
  maxLockSecs: number;
  maxMultiplierBps: number;
  earlyUnlockPenaltyBps: number;
  minLockAmount: bigint;
  /** Window over which arriving fees stream out to lockers. */
  rewardStreamSecs: number;
  /** `CURVE_LINEAR` or `CURVE_SQRT`. */
  durationCurve: number;
  /** Ascending thresholds in bps of total supply; zero disables a tier. */
  sizeTierBps: [number, number, number];
  /** Bonus on the duration multiplier at each tier, in bps. */
  sizeBonusBps: [number, number, number];
}

export interface PoolAccount {
  mint: PublicKey;
  creator: PublicKey;
  treasury: PublicKey;
  tokenVault: PublicKey;
  rewardVault: PublicKey;
  tokenProgram: PublicKey;
  /** The coin's LaunchLab quote: what lockers are paid in. */
  quoteMint: PublicKey;
  quoteTokenProgram: PublicKey;
  /** Reward vault's quote ATA; the default pubkey for a WSOL quote. */
  rewardTokenAccount: PublicKey;
  /** The coin's LaunchLab `PoolState`. */
  launchlabPool: PublicKey;
  terms: PoolTermsAccount;
  totalLocked: bigint;
  totalWeight: bigint;
  accRewardPerWeight: bigint;
  rewardRemainder: bigint;
  lastVaultBalance: bigint;
  vaultReserve: bigint;
  undistributed: bigint;
  streamRate: bigint;
  streamEnd: number;
  lastStreamAt: number;
  creatorClaimable: bigint;
  treasuryClaimable: bigint;
  lifetimeInflow: bigint;
  lifetimeRewards: bigint;
  lifetimeCreator: bigint;
  lifetimeTreasury: bigint;
  lifetimeBurned: bigint;
  openPositions: bigint;
  positionsCreated: bigint;
  createdAt: number;
  bump: number;
  vaultBump: number;
  /** The creator's founding lock is in; locks and deposits are open. */
  founded: boolean;
  /** Quote base units the open locks can still earn in total. */
  rewardCapacity: bigint;
}

export interface PositionAccount {
  owner: PublicKey;
  pool: PublicKey;
  index: number;
  amount: bigint;
  weight: bigint;
  multiplierBps: number;
  lockStart: number;
  lockEnd: number;
  rewardDebt: bigint;
  claimed: bigint;
  bump: number;
  /** The most this lock may ever be paid, in quote base units. */
  rewardCap: bigint;
  /** The owner gave up this lock's earnings for good; it holds no weight. */
  renounced: boolean;
}

export interface ConfigAccount {
  admin: PublicKey;
  pendingAdmin: PublicKey;
  treasury: PublicKey;
  /** IMAGINE's LaunchLab PlatformConfig every launch is created under. */
  launchlabPlatform: PublicKey;
  tradeFeeBps: number;
  defaultTreasuryShareBps: number;
  maxCreatorShareBps: number;
  defaultMinLockSecs: number;
  defaultMaxLockSecs: number;
  defaultMaxMultiplierBps: number;
  defaultEarlyUnlockPenaltyBps: number;
  defaultMinLockAmount: bigint;
  defaultRewardStreamSecs: number;
  defaultDurationCurve: number;
  defaultSizeTierBps: [number, number, number];
  defaultSizeBonusBps: [number, number, number];
  poolCreationFee: bigint;
  paused: boolean;
  poolCount: bigint;
}

export function decodePool(data: Buffer | Uint8Array): PoolAccount {
  const r = coder.accounts.decode("Pool", Buffer.from(data)) as Record<string, never>;
  const raw = r as unknown as Record<string, Numeric & PublicKey & Record<string, Numeric>>;
  const terms = raw.terms as unknown as Record<string, Numeric>;
  return {
    mint: raw.mint as PublicKey,
    creator: raw.creator as PublicKey,
    treasury: raw.treasury as PublicKey,
    tokenVault: raw.token_vault as PublicKey,
    rewardVault: raw.reward_vault as PublicKey,
    tokenProgram: raw.token_program as PublicKey,
    quoteMint: raw.quote_mint as PublicKey,
    quoteTokenProgram: raw.quote_token_program as PublicKey,
    rewardTokenAccount: raw.reward_token_account as PublicKey,
    launchlabPool: raw.launchlab_pool as PublicKey,
    terms: {
      treasuryShareBps: num(terms.treasury_share_bps),
      creatorShareBps: num(terms.creator_share_bps),
      minLockSecs: num(terms.min_lock_secs),
      maxLockSecs: num(terms.max_lock_secs),
      maxMultiplierBps: num(terms.max_multiplier_bps),
      earlyUnlockPenaltyBps: num(terms.early_unlock_penalty_bps),
      minLockAmount: big(terms.min_lock_amount),
      rewardStreamSecs: num(terms.reward_stream_secs),
      durationCurve: num(terms.duration_curve),
      sizeTierBps: triple(terms.size_tier_bps),
      sizeBonusBps: triple(terms.size_bonus_bps),
    },
    totalLocked: big(raw.total_locked),
    totalWeight: big(raw.total_weight),
    accRewardPerWeight: big(raw.acc_reward_per_weight),
    rewardRemainder: big(raw.reward_remainder),
    lastVaultBalance: big(raw.last_vault_balance),
    vaultReserve: big(raw.vault_reserve),
    undistributed: big(raw.undistributed),
    streamRate: big(raw.stream_rate),
    streamEnd: num(raw.stream_end),
    lastStreamAt: num(raw.last_stream_at),
    creatorClaimable: big(raw.creator_claimable),
    treasuryClaimable: big(raw.treasury_claimable),
    lifetimeInflow: big(raw.lifetime_inflow),
    lifetimeRewards: big(raw.lifetime_rewards),
    lifetimeCreator: big(raw.lifetime_creator),
    lifetimeTreasury: big(raw.lifetime_treasury),
    lifetimeBurned: big(raw.lifetime_burned),
    openPositions: big(raw.open_positions),
    positionsCreated: big(raw.positions_created),
    createdAt: num(raw.created_at),
    bump: num(raw.bump),
    vaultBump: num(raw.vault_bump),
    founded: Boolean(raw.founded),
    rewardCapacity: big(raw.reward_capacity),
  };
}

export function decodePosition(data: Buffer | Uint8Array): PositionAccount {
  const raw = coder.accounts.decode("Position", Buffer.from(data)) as unknown as Record<
    string,
    Numeric & PublicKey
  >;
  return {
    owner: raw.owner as PublicKey,
    pool: raw.pool as PublicKey,
    index: num(raw.index),
    amount: big(raw.amount),
    weight: big(raw.weight),
    multiplierBps: num(raw.multiplier_bps),
    lockStart: num(raw.lock_start),
    lockEnd: num(raw.lock_end),
    rewardDebt: big(raw.reward_debt),
    claimed: big(raw.claimed),
    bump: num(raw.bump),
    rewardCap: big(raw.reward_cap),
    renounced: Boolean(raw.renounced),
  };
}

export function decodeConfig(data: Buffer | Uint8Array): ConfigAccount {
  const raw = coder.accounts.decode("Config", Buffer.from(data)) as unknown as Record<
    string,
    Numeric & PublicKey
  >;
  return {
    admin: raw.admin as PublicKey,
    pendingAdmin: raw.pending_admin as PublicKey,
    treasury: raw.treasury as PublicKey,
    launchlabPlatform: raw.launchlab_platform as PublicKey,
    tradeFeeBps: num(raw.trade_fee_bps),
    defaultTreasuryShareBps: num(raw.default_treasury_share_bps),
    maxCreatorShareBps: num(raw.max_creator_share_bps),
    defaultMinLockSecs: num(raw.default_min_lock_secs),
    defaultMaxLockSecs: num(raw.default_max_lock_secs),
    defaultMaxMultiplierBps: num(raw.default_max_multiplier_bps),
    defaultEarlyUnlockPenaltyBps: num(raw.default_early_unlock_penalty_bps),
    defaultMinLockAmount: big(raw.default_min_lock_amount),
    defaultRewardStreamSecs: num(raw.default_reward_stream_secs),
    defaultDurationCurve: num(raw.default_duration_curve),
    defaultSizeTierBps: triple(raw.default_size_tier_bps),
    defaultSizeBonusBps: triple(raw.default_size_bonus_bps),
    poolCreationFee: big(raw.pool_creation_fee),
    paused: Boolean(raw.paused),
    poolCount: big(raw.pool_count),
  };
}

/** Anchor event discriminators, for log decoding in the indexer. */
export function decodeEvent(base64Data: string) {
  return coder.events.decode(base64Data);
}
