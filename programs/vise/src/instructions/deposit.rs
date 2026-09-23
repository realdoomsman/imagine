use crate::constants::*;
use crate::errors::ViseError;
use crate::events::{FeeDeposited, RewardsSynced};
use crate::state::Pool;
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

#[derive(Accounts)]
pub struct DepositReward<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

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

/// Push SOL into a pool and fold it into the accumulator in the same
/// instruction.
///
/// This is the app-fee leg appended to every swap routed through the VISE
/// front-end, but it is fully permissionless: anyone can top up any pool, and
/// pump.fun's own `distribute_creator_fees_v2` credits the vault directly
/// without calling this at all — the balance-diff sync picks that up too.
///
/// `kind` is metadata for indexers: 0 buy fee, 1 sell fee, 2 creator-fee sweep,
/// 3 donation.
pub fn deposit_reward(ctx: Context<DepositReward>, amount: u64, kind: u8) -> Result<()> {
    require!(amount > 0, ViseError::AmountTooSmall);
    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool.key();

    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
            },
        ),
        amount,
    )?;

    let vault_lamports = ctx.accounts.reward_vault.lamports();
    let pool = &mut ctx.accounts.pool;
    let result = pool.sync(vault_lamports, now)?;

    emit!(FeeDeposited {
        pool: pool_key,
        payer: ctx.accounts.payer.key(),
        amount,
        kind,
        timestamp: now,
    });
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
    Ok(())
}
