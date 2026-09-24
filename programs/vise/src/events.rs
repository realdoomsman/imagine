use anchor_lang::prelude::*;

#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub treasury_share_bps: u16,
    pub creator_share_bps: u16,
    pub min_lock_secs: u32,
    pub max_lock_secs: u32,
    pub max_multiplier_bps: u32,
    pub early_unlock_penalty_bps: u16,
    pub timestamp: i64,
}

/// Emitted on every sync that absorbed new lamports, whatever their source:
/// routed app fees, pump.fun creator-fee distributions, or plain donations.
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

/// `kind`: 0 = buy fee, 1 = sell fee, 2 = pump creator-fee sweep, 3 = donation.
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
    pub paused: bool,
    pub timestamp: i64,
}
