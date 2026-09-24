//! # VISE
//!
//! Time-weighted lock-to-earn vaults for pump.fun coins.
//!
//! Every lamport that reaches a pool's reward vault — app fees from swaps routed
//! through the VISE front-end, pump.fun creator fees delivered by
//! `distribute_creator_fees_v2`, or plain donations — is split by the pool's
//! frozen terms and spread across locked weight. Weight is principal times a
//! duration multiplier, so a longer commitment earns a larger slice of the same
//! fee stream.
//!
//! Design invariants:
//! * A pool's economic terms are copied in at creation and can never change.
//! * No instruction lets an admin move a pool's SOL or tokens. Payouts only ever
//!   reach the locker, creator, or treasury that earned them.
//! * On pools created with earnings limits, a lock is paid at most its tokens'
//!   SOL value when locked times its multiplier; fees beyond what open locks
//!   can still earn go to the treasury as they arrive.
//! * Claiming and unlocking can never be paused.
//! * The creator must lock at creation, so every pool has weight from its first
//!   slot and no one can scoop an unassigned remainder.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod mint_guard;
pub mod price;
pub mod state;

use instructions::*;

declare_id!("VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb");

#[program]
pub mod vise {
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

    pub fn create_pool<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreatePool<'info>>,
        args: CreatePoolArgs,
    ) -> Result<()> {
        instructions::pool::create_pool(ctx, args)
    }

    pub fn sync(ctx: Context<Sync>) -> Result<()> {
        instructions::pool::sync(ctx)
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

    pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
        instructions::migrate::migrate(ctx)
    }
}
