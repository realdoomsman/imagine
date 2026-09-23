use crate::constants::*;
use crate::errors::ViseError;
use crate::events::{Claimed, CreatorClaimed, RewardsSynced, TreasuryClaimed};
use crate::instructions::lock::pay_from_vault;
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
    let pool_key = ctx.accounts.pool.key();
    let vault_lamports = ctx.accounts.reward_vault.lamports();

    let result = ctx.accounts.pool.sync(vault_lamports, now)?;
    if result.inflow > 0 || result.released > 0 {
        emit!(RewardsSynced {
            pool: pool_key,
            inflow: result.inflow,
            to_lockers: result.to_lockers,
            to_creator: result.to_creator,
            to_treasury: result.to_treasury,
            total_weight: ctx.accounts.pool.total_weight,
            acc_reward_per_weight: ctx.accounts.pool.acc_reward_per_weight,
            timestamp: now,
        });
    }

    let pending = crate::instructions::lock::settle(&ctx.accounts.pool, &mut ctx.accounts.position)?;
    require!(pending > 0, ViseError::NothingToClaim);

    pay_from_vault(
        &mut ctx.accounts.pool,
        &ctx.accounts.reward_vault,
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.system_program,
        pool_key,
        pending,
    )?;

    let position = &mut ctx.accounts.position;
    position.reward_debt = settle_debt(position.reward_debt, pending)?;
    position.claimed = position
        .claimed
        .checked_add(pending)
        .ok_or(ViseError::MathOverflow)?;

    emit!(Claimed {
        pool: pool_key,
        position: position.key(),
        owner: position.owner,
        amount: pending,
        lifetime_claimed: position.claimed,
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
