use crate::constants::*;
use crate::errors::ViseError;
use crate::events::{CreatorClaimed, Renounced, RewardsSynced, TreasuryClaimed};
use crate::instructions::lock::{emit_sync, pay_accrued, pay_from_vault, settle};
use crate::math::settle_debt;
use crate::state::{Pool, Position};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ViseError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = pool,
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

/// Harvest accrued SOL without touching the lock. Always available, even while
/// locked, even when the platform is paused.
pub fn claim(ctx: Context<Claim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    harvest_into(
        &mut ctx.accounts.pool,
        &mut ctx.accounts.position,
        &ctx.accounts.reward_vault,
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.system_program,
        now,
    )
}

#[derive(Accounts)]
pub struct Harvest<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: pinned to the position's recorded owner by `has_one`; receives
    /// the rewards.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ViseError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = pool,
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

/// `claim`, callable by anyone, paying the position's owner. On a capped
/// pool this is how a keeper retires locks that have reached their cap: the
/// owner is paid up to it, the excess goes to the treasury, and the lock's
/// weight stops diluting the locks still earning.
pub fn harvest(ctx: Context<Harvest>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    harvest_into(
        &mut ctx.accounts.pool,
        &mut ctx.accounts.position,
        &ctx.accounts.reward_vault,
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.system_program,
        now,
    )
}

fn harvest_into<'info>(
    pool: &mut Account<'info, Pool>,
    position: &mut Account<'info, Position>,
    reward_vault: &SystemAccount<'info>,
    owner: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    now: i64,
) -> Result<()> {
    let pool_key = pool.key();
    let vault_lamports = reward_vault.lamports();
    let result = pool.sync(vault_lamports, now)?;
    if result.inflow > 0 || result.released > 0 {
        emit!(RewardsSynced {
            pool: pool_key,
            inflow: result.inflow,
            to_lockers: result.to_lockers,
            to_creator: result.to_creator,
            to_treasury: result.to_treasury,
            total_weight: pool.total_weight,
            acc_reward_per_weight: pool.acc_reward_per_weight,
            timestamp: now,
        });
    }

    let pending = settle(pool, position)?;
    require!(pending > 0, ViseError::NothingToClaim);
    pay_accrued(pool, position, reward_vault, owner, system_program, pool_key, pending, now)?;
    position.reward_debt = settle_debt(position.reward_debt, pending)?;
    pool.retire_if_capped(position)
}

/// Give up this lock's earnings for good. The tokens stay locked to the same
/// end date and can still be unlocked then (or broken early, with the usual
/// burn), but the lock holds no weight from here on: what it had accrued and
/// everything it would have earned goes to the other lockers instead.
///
/// Accrued rewards return to the stream rather than landing at once, exactly
/// like an early exit's forfeit, so nobody can lock in the same slot and take
/// a lump of them. Irreversible: a renounced lock cannot be grown or extended.
pub fn renounce(ctx: Context<Claim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool.key();
    let position_key = ctx.accounts.position.key();
    let vault_lamports = ctx.accounts.reward_vault.lamports();
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    require!(!position.renounced, ViseError::PositionRenounced);

    let result = pool.sync(vault_lamports, now)?;
    emit_sync(pool, pool_key, result, now);

    // Weight leaves first so the forfeit lands only on the lockers who remain.
    let forfeited = settle(pool, position)?;
    pool.total_weight = pool
        .total_weight
        .checked_sub(position.weight)
        .ok_or(ViseError::MathOverflow)?;
    pool.close_capacity(position, forfeited);
    position.reward_cap = position.claimed.min(position.reward_cap);
    position.weight = 0;
    position.reward_debt = 0;
    position.renounced = true;
    pool.forfeit(forfeited, now)?;

    emit!(Renounced {
        pool: pool_key,
        position: position_key,
        owner: position.owner,
        amount: position.amount,
        forfeited_rewards: forfeited,
        total_weight: pool.total_weight,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimCreator<'info> {
    #[account(mut, address = pool.creator @ ViseError::TreasuryMismatch)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ViseError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn claim_creator(ctx: Context<ClaimCreator>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool.key();
    let vault_lamports = ctx.accounts.reward_vault.lamports();
    ctx.accounts.pool.sync(vault_lamports, now)?;

    let amount = ctx.accounts.pool.creator_claimable;
    require!(amount > 0, ViseError::NothingToClaim);
    ctx.accounts.pool.creator_claimable = 0;

    pay_from_vault(
        &mut ctx.accounts.pool,
        &ctx.accounts.reward_vault,
        &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.system_program,
        pool_key,
        amount,
    )?;

    emit!(CreatorClaimed {
        pool: pool_key,
        creator: ctx.accounts.creator.key(),
        amount,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimTreasury<'info> {
    /// Permissionless crank: anyone may push the platform's share to the
    /// treasury recorded on the pool.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    /// CHECK: pinned to the treasury stamped into the pool at creation.
    #[account(mut, address = pool.treasury @ ViseError::TreasuryMismatch)]
    pub treasury: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ViseError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn claim_treasury(ctx: Context<ClaimTreasury>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool.key();
    let vault_lamports = ctx.accounts.reward_vault.lamports();
    ctx.accounts.pool.sync(vault_lamports, now)?;

    let amount = ctx.accounts.pool.treasury_claimable;
    require!(amount > 0, ViseError::NothingToClaim);
    ctx.accounts.pool.treasury_claimable = 0;

    pay_from_vault(
        &mut ctx.accounts.pool,
        &ctx.accounts.reward_vault,
        &ctx.accounts.treasury.to_account_info(),
        &ctx.accounts.system_program,
        pool_key,
        amount,
    )?;

    emit!(TreasuryClaimed {
        pool: pool_key,
        treasury: ctx.accounts.treasury.key(),
        amount,
        timestamp: now,
    });
    Ok(())
}
