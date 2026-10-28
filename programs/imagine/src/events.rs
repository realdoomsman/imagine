use anchor_lang::prelude::*;

/// A coin was created on LaunchLab under the IMAGINE platform with this pool's
/// reward vault as its creator. The pool opens for locks once `found` runs.
#[event]
pub struct PoolLaunched {
    pub pool: Pubkey,
    pub mint: Pubkey,
    pub quote_mint: Pubkey,
    pub creator: Pubkey,
    pub launchlab_pool: Pubkey,
    pub reward_vault: Pubkey,
    pub timestamp: i64,
}

/// The creator's founding lock opened the pool.
#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub mint: Pubkey,
    pub quote_mint: Pubkey,
    pub creator: Pubkey,
    pub treasury_share_bps: u16,
    pub creator_share_bps: u16,
    pub min_lock_secs: u32,
    pub max_lock_secs: u32,
    pub max_multiplier_bps: u32,
    pub early_unlock_penalty_bps: u16,
    pub timestamp: i64,
}

/// Emitted on every sync that absorbed new quote, whatever its source: routed
/// app fees, the on-chain LaunchLab / CPMM creator fee collected by
/// `collect_creator_fee`, or plain donations. Amounts
/// are quote base units.
#[event]
pub struct RewardsSynced {
    pub pool: Pubkey,
    pub inflow: u64,
    pub to_lockers: u64,
    pub to_creator: u64,
    pub to_treasury: u64,
    pub total_weight: u128,
    pub acc_reward_per_weight: u128,
    pub timestamp: i64,
}

/// `kind`: 0 = buy fee, 1 = sell fee, 2 = creator share, 3 = donation.
/// `amount` is quote base units.
#[event]
pub struct FeeDeposited {
    pub pool: Pubkey,
    pub payer: Pubkey,
    pub amount: u64,
    pub kind: u8,
    pub timestamp: i64,
}

#[event]
pub struct Locked {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub index: u32,
    pub amount: u64,
    pub weight: u128,
    pub multiplier_bps: u32,
    pub lock_end: i64,
    pub total_locked: u64,
    pub total_weight: u128,
    pub timestamp: i64,
}

#[event]
pub struct PositionIncreased {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub added: u64,
    pub amount: u64,
    pub weight: u128,
    pub total_weight: u128,
    pub timestamp: i64,
}

#[event]
pub struct PositionExtended {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub lock_end: i64,
    pub multiplier_bps: u32,
    pub weight: u128,
    pub total_weight: u128,
    pub timestamp: i64,
}

#[event]
pub struct Claimed {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub lifetime_claimed: u64,
    pub timestamp: i64,
}

/// A lock was paid up to its cap and the rest of what it had accrued went to
/// the treasury.
#[event]
pub struct RewardCapped {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub to_treasury: u64,
    pub claimed: u64,
    pub reward_cap: u64,
    pub timestamp: i64,
}

/// A lock gave up its earnings for good: its weight left the pool and what it
/// had accrued went back to the stream for the other lockers.
#[event]
pub struct Renounced {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub forfeited_rewards: u64,
    pub total_weight: u128,
    pub timestamp: i64,
}

/// A lock was locked forever: its tokens can never leave the vault and its
/// earnings go to the other lockers. Irreversible.
#[event]
pub struct LockedForever {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub lock_end: i64,
    pub timestamp: i64,
}

#[event]
pub struct Unlocked {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub returned: u64,
    pub burned: u64,
    pub forfeited_rewards: u64,
    pub early: bool,
    pub total_locked: u64,
    pub total_weight: u128,
    pub timestamp: i64,
}

#[event]
pub struct CreatorClaimed {
    pub pool: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TreasuryClaimed {
    pub pool: Pubkey,
    pub treasury: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub trade_fee_bps: u16,
    pub launchlab_platform: Pubkey,
    pub paused: bool,
    pub timestamp: i64,
}

/// A lock's rewards bought more of its coin, added to the lock (`compound`).
/// `quote_in` counts as paid to the lock (toward its cap), like a claim.
#[event]
pub struct Compounded {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub quote_in: u64,
    pub tokens_out: u64,
    pub new_amount: u64,
    pub new_weight: u128,
    pub timestamp: i64,
}
