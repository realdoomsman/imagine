use anchor_lang::prelude::*;

/// Fixed-point scalar for the reward-per-weight accumulator.
///
/// `acc_reward_per_weight` accumulates `quote units * SCALE / total_weight`, so
/// it grows *inversely* with the smallest weight a pool can hold — a pool
/// pinned at its weight floor inflates `acc` fastest. The bound that matters is
/// therefore `weight * acc < u128::MAX`, worst case:
///
/// ```text
/// acc_max    = lifetime_inflow * SCALE / (MIN_LOCK_AMOUNT_FLOOR * 1.0x)
/// weight_max = 1e15 base units * MAX_MULTIPLIER_BPS/1e4   (whole supply, 10x)
/// ```
///
/// With `MIN_LOCK_AMOUNT_FLOOR = 1e6` (one whole token at 6 decimals) and a
/// 10.0x ceiling, `weight_max = 1e16` and `acc` may reach `1e18` before
/// `weight_max * acc` approaches `u128::MAX` (~3.4e38). That is ~1e18 quote
/// base units (1e9 SOL, or 1e10 of an 8-decimal xStock) of lifetime inflow into
/// a single pool. Overflow returns an error rather than wrapping, so the
/// failure mode is a rejected instruction, not a corrupted ledger.
pub const SCALE: u128 = 1_000_000_000_000;

pub const BPS_DENOMINATOR: u64 = 10_000;

pub const SECONDS_PER_HOUR: u32 = 3_600;
pub const SECONDS_PER_DAY: u32 = 86_400;

/// Hard ceilings enforced on every admin write so a compromised admin key can
/// never configure economically absurd pool terms.
pub const MAX_TRADE_FEE_BPS: u16 = 1_000; // 10%
pub const MAX_TREASURY_SHARE_BPS: u16 = 3_000; // 30% of pool inflow
pub const MAX_CREATOR_SHARE_BPS: u16 = 3_000; // 30% of post-treasury inflow
pub const MAX_PENALTY_BPS: u16 = 5_000; // 50% of principal at full remaining term
/// Floor as well as ceiling: the early-exit penalty is what makes churning
/// through the reward stream expensive, so a pool may not set it to zero.
pub const MIN_PENALTY_BPS: u16 = 500; // 5%
pub const MAX_MULTIPLIER_BPS: u32 = 100_000; // 10.0x
/// The shortest lock a pool may offer. An hour, not a day: short locks still
/// earn, at the bottom of the multiplier curve, and the reward stream plus the
/// early-exit burn are what stop a short lock from sniping a fee backlog, not
/// the length of the lock itself.
pub const MIN_LOCK_SECS_FLOOR: u32 = SECONDS_PER_HOUR; // 1 hour
pub const MAX_LOCK_SECS_CEILING: u32 = 4 * 365 * SECONDS_PER_DAY; // 4 years
pub const MAX_POOL_CREATION_FEE: u64 = 5_000_000_000; // 5 SOL, charged in SOL whatever the quote

/// Shape of the duration curve. Frozen per pool like every other term.
pub const CURVE_LINEAR: u8 = 0;
/// `1 + headroom * sqrt(t / T)`: front-loaded, so a month is worth a great
/// deal more than a linear ramp would pay, while a year still takes the top.
pub const CURVE_SQRT: u8 = 1;

/// Size tiers reward committing a real share of supply: three ascending
/// thresholds in bps of total supply, the highest cleared applies.
pub const SIZE_TIERS: usize = 3;
/// Ceiling on any single tier bonus: +100%.
pub const MAX_SIZE_BONUS_BPS: u16 = 10_000;
/// Keeps `acc_reward_per_weight` growth bounded (see `SCALE`) and stops a pool
/// from being held open by dust.
pub const MIN_LOCK_AMOUNT_FLOOR: u64 = 1_000_000;

/// Window over which arriving fees are released to lockers.
///
/// Fees stream in linearly rather than landing all at once, so a share is
/// earned by weight *held over time*. Without it, anyone could watch fees pile
/// up in the vault, lock a large bag, trigger the accounting, claim a slice of
/// a backlog they were never present for, and leave.
pub const MIN_REWARD_STREAM_SECS: u32 = SECONDS_PER_HOUR; // 1 hour
pub const MAX_REWARD_STREAM_SECS: u32 = 7 * SECONDS_PER_DAY;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const POOL_SEED: &[u8] = b"pool";
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const TOKEN_VAULT_SEED: &[u8] = b"token-vault";
#[constant]
pub const POSITION_SEED: &[u8] = b"position";

/// Raydium LaunchLab, the bonding-curve program every coin launches on.
pub const LAUNCHLAB_PROGRAM_ID: Pubkey = pubkey!("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
/// Raydium CPMM, where LaunchLab's `migrate_to_cpswap` moves a graduated curve.
pub const CPMM_PROGRAM_ID: Pubkey = pubkey!("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
/// Wrapped SOL. A pool quoted in it holds its rewards as native lamports on the
/// reward vault; every other quote is held in the vault's token account.
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

/// Decimals of every coin `launch` creates on LaunchLab.
pub const COIN_DECIMALS: u8 = 6;

/// The only metadata URI `launch` accepts for a coin is
/// `METADATA_URI_PREFIX + base58(mint) + METADATA_URI_SUFFIX`: the document
/// the IMAGINE API hosts for that mint, whose website is the coin's IMAGINE
/// page (`https://imagine.fun/coins/<mint>`).
#[constant]
pub const METADATA_URI_PREFIX: &str = "https://api.imagine.fun/files/meta/";
#[constant]
pub const METADATA_URI_SUFFIX: &str = ".json";

/// A lock paid to within this many quote base units of its cap is treated as
/// fully paid and stops earning (`Pool::retire_if_capped`). Covers accumulator
/// rounding, which only ever leaves a lock a few units short.
pub const CAP_DUST: u64 = 1_000;

/// The least `compound` will spend, in quote base units (0.001 SOL for a SOL
/// quote; the same base-unit floor for any other), so a crank never pays more
/// in fees than it buys.
#[constant]
pub const MIN_COMPOUND_QUOTE: u64 = 1_000_000;
/// How far below the venue's spot price, before the buy, a compound may fill:
/// the trade's own fees and price impact must fit inside it.
#[constant]
pub const COMPOUND_SLIPPAGE_BPS: u64 = 300;

/// The IMAGINE keeper: besides a lock's owner, the only signer `compound`
/// accepts, and only for locks whose owner turned auto-compound on.
pub const KEEPER_AUTHORITY: Pubkey = pubkey!("6mgSanvKanCvzMnbyYa5dyWQGZ5wx36rSwybP1WTNh4M");
