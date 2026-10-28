//! # IMAGINE
//!
//! Time-weighted lock-to-earn vaults for coins launched on Raydium LaunchLab
//! under the IMAGINE platform, paid in each coin's pair asset.
//!
//! `launch` creates the coin on LaunchLab under IMAGINE's PlatformConfig with
//! the pool's reward vault PDA as its creator, so the platform's on-chain
//! creator fee on every curve trade (and the CPMM creator fee after
//! graduation) belongs to the pool; `collect_creator_fee` pulls it in. Every
//! unit of the coin's quote that reaches the vault — that fee, app fees from
//! trades routed through the IMAGINE front-end, or plain donations — is split
//! by the pool's frozen terms
//! and spread across locked weight. Weight is principal times a duration
//! multiplier, so a longer commitment earns a larger slice of the same fee
//! stream. A SOL-paired coin pays lamports; a coin paired with NVDAx pays
//! NVDAx.
//!
//! Design invariants:
//! * A pool's economic terms are copied in at launch and can never change.
//! * No instruction lets an admin move a pool's quote or tokens. Payouts only
//!   ever reach the locker, creator, or treasury that earned them.
//! * A lock is paid at most its tokens' quote value when locked times its
//!   multiplier; fees beyond what open locks can still earn go to the treasury
//!   as they arrive.
//! * Claiming and unlocking can never be paused.
//! * The creator must lock first (`found`), so every pool has weight from its
//!   first lock and no one can scoop an unassigned remainder.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod launchlab;
pub mod math;
pub mod mint_guard;
pub mod price;
pub mod quote_mint;
pub mod rewards;
pub mod state;

use instructions::*;

declare_id!("imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa");

#[program]
pub mod imagine {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, args: ConfigArgs) -> Result<()> {
        instructions::admin::initialize_config(ctx, args)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, args: ConfigArgs) -> Result<()> {
        instructions::admin::update_config(ctx, args)
    }

    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::transfer_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin(ctx)
    }

    pub fn launch<'info>(
        ctx: Context<'_, '_, 'info, 'info, Launch<'info>>,
        args: LaunchArgs,
    ) -> Result<()> {
        instructions::pool::launch(ctx, args)
    }

    pub fn found<'info>(
        ctx: Context<'_, '_, 'info, 'info, Found<'info>>,
        initial_lock_amount: u64,
        initial_lock_duration: u32,
    ) -> Result<()> {
        instructions::pool::found(ctx, initial_lock_amount, initial_lock_duration)
    }

    pub fn sync(ctx: Context<Sync>) -> Result<()> {
        instructions::pool::sync(ctx)
    }

    pub fn collect_creator_fee<'info>(
        ctx: Context<'_, '_, 'info, 'info, CollectCreatorFee<'info>>,
    ) -> Result<()> {
        instructions::collect::collect_creator_fee(ctx)
    }

    pub fn deposit_reward(ctx: Context<DepositReward>, amount: u64, kind: u8) -> Result<()> {
        instructions::deposit::deposit_reward(ctx, amount, kind)
    }

    pub fn lock<'info>(
        ctx: Context<'_, '_, 'info, 'info, Lock<'info>>,
        index: u32,
        amount: u64,
        duration_secs: u32,
    ) -> Result<()> {
        instructions::lock::lock(ctx, index, amount, duration_secs)
    }

    pub fn increase<'info>(
        ctx: Context<'_, '_, 'info, 'info, ModifyPosition<'info>>,
        amount: u64,
    ) -> Result<()> {
        instructions::lock::increase(ctx, amount)
    }

    pub fn extend<'info>(
        ctx: Context<'_, '_, 'info, 'info, ModifyPosition<'info>>,
        duration_secs: u32,
    ) -> Result<()> {
        instructions::lock::extend(ctx, duration_secs)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::claim(ctx)
    }

    pub fn harvest(ctx: Context<Harvest>) -> Result<()> {
        instructions::claim::harvest(ctx)
    }

    pub fn renounce(ctx: Context<Renounce>) -> Result<()> {
        instructions::claim::renounce(ctx)
    }

    pub fn claim_creator(ctx: Context<ClaimCreator>) -> Result<()> {
        instructions::claim::claim_creator(ctx)
    }

    pub fn claim_treasury(ctx: Context<ClaimTreasury>) -> Result<()> {
        instructions::claim::claim_treasury(ctx)
    }

    pub fn unlock(ctx: Context<Unlock>) -> Result<()> {
        instructions::unlock::unlock(ctx)
    }

    pub fn early_unlock(ctx: Context<Unlock>) -> Result<()> {
        instructions::unlock::early_unlock(ctx)
    }
}
