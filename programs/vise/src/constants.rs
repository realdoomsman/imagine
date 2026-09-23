use anchor_lang::prelude::*;

/// Fixed-point scalar for the reward-per-weight accumulator.
///
/// `acc_reward_per_weight` accumulates `lamports * SCALE / total_weight`, so it
/// grows *inversely* with the smallest weight a pool can hold — a pool pinned at
/// its weight floor inflates `acc` fastest. The bound that matters is therefore
/// `weight * acc < u128::MAX`, worst case:
///
/// ```text
/// acc_max    = lifetime_lamports * SCALE / (MIN_LOCK_AMOUNT_FLOOR * 1.0x)
/// weight_max = 1e15 base units * MAX_MULTIPLIER_BPS/1e4   (whole supply, 10x)
/// ```
///
/// With `MIN_LOCK_AMOUNT_FLOOR = 1e6` (one whole token at 6 decimals) and a
/// 10.0x ceiling, `weight_max = 1e16` and `acc` may reach `1e18` before
/// `weight_max * acc` approaches `u128::MAX` (~3.4e38). That is ~1e9 SOL of
/// lifetime inflow into a single pool. Overflow returns an error rather than
/// wrapping, so the failure mode is a rejected instruction, not a corrupted
/// ledger.
pub const SCALE: u128 = 1_000_000_000_000;

pub const BPS_DENOMINATOR: u64 = 10_000;

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
pub const MIN_LOCK_SECS_FLOOR: u32 = SECONDS_PER_DAY; // 1 day
pub const MAX_LOCK_SECS_CEILING: u32 = 4 * 365 * SECONDS_PER_DAY; // 4 years
pub const MAX_POOL_CREATION_FEE: u64 = 5_000_000_000; // 5 SOL
/// Keeps `acc_reward_per_weight` growth bounded (see `SCALE`) and stops a pool
/// from being held open by dust.
pub const MIN_LOCK_AMOUNT_FLOOR: u64 = 1_000_000;

/// Window over which arriving fees are released to lockers.
///
/// Fees stream in linearly rather than landing all at once, so a share is
/// earned by weight *held over time*. Without it, anyone could watch lamports
/// pile up in the vault, lock a large bag, trigger the accounting, claim a
/// slice of a backlog they were never present for, and leave.
pub const MIN_REWARD_STREAM_SECS: u32 = 3_600; // 1 hour
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

/// pump.fun's bonding curve program, identical on devnet and mainnet.
/// <https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md>
pub const PUMP_PROGRAM_ID: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/// Byte offset of `BondingCurve::creator` within the pump account.
///
/// Layout: 8 discriminator + 5 x u64 reserves/supply + 1 bool `complete`.
pub const PUMP_BONDING_CURVE_CREATOR_OFFSET: usize = 8 + 5 * 8 + 1;
