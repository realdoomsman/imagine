use crate::constants::*;
use crate::errors::ViseError;
use crate::events::{Locked, PositionExtended, PositionIncreased, RewardsSynced};
use crate::math::{accrued, reward_debt_for, weight_of};
use crate::state::{Pool, Position};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Shared position opener. The caller must have synced the pool and moved the
/// tokens into the vault already. `supply` is the mint's total supply, read
/// from the mint account by the caller, and sets the size tier.
#[allow(clippy::too_many_arguments)]
pub fn open_position(
    pool: &mut Pool,
    position: &mut Position,
    owner: Pubkey,
    pool_key: Pubkey,
    index: u32,
    bump: u8,
    amount: u64,
    duration_secs: u32,
    supply: u64,
    now: i64,
) -> Result<()> {
    require!(
        amount >= pool.terms.min_lock_amount,
        ViseError::AmountTooSmall
    );
    let multiplier = pool.terms.multiplier_for(duration_secs, amount, supply)?;
    let weight = weight_of(amount, multiplier)?;

    position.owner = owner;
    position.pool = pool_key;
    position.index = index;
    position.amount = amount;
    position.weight = weight;
    position.multiplier_bps = multiplier;
    position.lock_start = now;
    position.lock_end = now
        .checked_add(duration_secs as i64)
        .ok_or(ViseError::MathOverflow)?;
    position.reward_debt = reward_debt_for(weight, pool.acc_reward_per_weight)?;
    position.claimed = 0;
    position.bump = bump;

    pool.total_locked = pool
        .total_locked
        .checked_add(amount)
        .ok_or(ViseError::MathOverflow)?;
    pool.total_weight = pool
        .total_weight
        .checked_add(weight)
        .ok_or(ViseError::MathOverflow)?;
    pool.open_positions = pool
        .open_positions
        .checked_add(1)
        .ok_or(ViseError::MathOverflow)?;
    pool.positions_created = pool
        .positions_created
        .checked_add(1)
        .ok_or(ViseError::MathOverflow)?;
    Ok(())
}

/// Pay out nothing, but bring `reward_debt` up to date after a weight change.
/// Returns the lamports that had accrued at the old weight, which the caller
/// must either pay or redistribute.
pub fn settle(pool: &Pool, position: &mut Position) -> Result<u64> {
    let pending = accrued(
        position.weight,
        pool.acc_reward_per_weight,
        position.reward_debt,
    )?;
    Ok(pending)
}

fn emit_sync(pool: &Pool, pool_key: Pubkey, result: crate::state::SyncResult, now: i64) {
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
}

#[derive(Accounts)]
#[instruction(index: u32)]
pub struct Lock<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(address = pool.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [TOKEN_VAULT_SEED, pool.key().as_ref()],
        bump,
        address = pool.token_vault @ ViseError::VaultAccountingMismatch,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ViseError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref(), &index.to_le_bytes()],
        bump
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        constraint = owner_token_account.mint == pool.mint,
        constraint = owner_token_account.owner == owner.key(),
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(address = pool.token_program @ ViseError::VaultAccountingMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn lock(ctx: Context<Lock>, index: u32, amount: u64, duration_secs: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool.key();
    let vault_lamports = ctx.accounts.reward_vault.lamports();

    let sync_result = ctx.accounts.pool.sync(vault_lamports, now)?;
    emit_sync(&ctx.accounts.pool, pool_key, sync_result, now);

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.owner_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.token_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    open_position(
        &mut ctx.accounts.pool,
        &mut ctx.accounts.position,
        ctx.accounts.owner.key(),
        pool_key,
        index,
        ctx.bumps.position,
        amount,
        duration_secs,
        ctx.accounts.mint.supply,
        now,
    )?;

    emit!(Locked {
        pool: pool_key,
        position: ctx.accounts.position.key(),
        owner: ctx.accounts.owner.key(),
        index,
        amount,
        weight: ctx.accounts.position.weight,
        multiplier_bps: ctx.accounts.position.multiplier_bps,
        lock_end: ctx.accounts.position.lock_end,
        total_locked: ctx.accounts.pool.total_locked,
        total_weight: ctx.accounts.pool.total_weight,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ModifyPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(address = pool.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        address = pool.token_vault @ ViseError::VaultAccountingMismatch,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

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

    #[account(
        mut,
        constraint = owner_token_account.mint == pool.mint,
        constraint = owner_token_account.owner == owner.key(),
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(address = pool.token_program @ ViseError::VaultAccountingMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Add principal to a live lock, keeping its existing unlock time.
///
/// Accrued rewards are paid out first so the new weight cannot retroactively
/// dilute or inflate what was already earned.
///
/// The position must still be running. A matured position keeps its old
/// multiplier but owes no more time, so topping one up would mint
/// full-multiplier weight against principal that can be withdrawn the same
/// slot — a risk-free claim on everyone else's fee stream. Extend or open a
/// new position instead.
pub fn increase(ctx: Context<ModifyPosition>, amount: u64) -> Result<()> {
    require!(amount > 0, ViseError::AmountTooSmall);
    let now = Clock::get()?.unix_timestamp;
    require!(
        now < ctx.accounts.position.lock_end,
        ViseError::PositionMatured
    );
    let pool_key = ctx.accounts.pool.key();
    let vault_lamports = ctx.accounts.reward_vault.lamports();

    let sync_result = ctx.accounts.pool.sync(vault_lamports, now)?;
    emit_sync(&ctx.accounts.pool, pool_key, sync_result, now);

    let pending = settle(&ctx.accounts.pool, &mut ctx.accounts.position)?;
    pay_from_vault(
        &mut ctx.accounts.pool,
        &ctx.accounts.reward_vault,
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.system_program,
        pool_key,
        pending,
    )?;
    if pending > 0 {
        let position = &mut ctx.accounts.position;
        position.claimed = position
            .claimed
            .checked_add(pending)
            .ok_or(ViseError::MathOverflow)?;
        emit!(crate::events::Claimed {
            pool: pool_key,
            position: position.key(),
            owner: position.owner,
            amount: pending,
            lifetime_claimed: position.claimed,
            timestamp: now,
        });
    }

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.owner_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.token_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    let old_weight = position.weight;
    position.amount = position
        .amount
        .checked_add(amount)
        .ok_or(ViseError::MathOverflow)?;
    // Reprice the whole position against the term still to run and the new
    // size. Keeping the original multiplier would sell a year's weight for
    // whatever days are left, the same mispricing the maturity guard above
    // rejects; and a larger bag may have crossed into a higher tier.
    let remaining = u32::try_from(
        position
            .lock_end
            .checked_sub(now)
            .ok_or(ViseError::MathOverflow)?,
    )
    .map_err(|_| ViseError::MathOverflow)?;
    require!(
        remaining >= pool.terms.min_lock_secs,
        ViseError::InvalidDuration
    );
    position.multiplier_bps =
        pool.terms
            .multiplier_for(remaining, position.amount, ctx.accounts.mint.supply)?;
    position.weight = weight_of(position.amount, position.multiplier_bps)?;
    position.reward_debt = reward_debt_for(position.weight, pool.acc_reward_per_weight)?;

    pool.total_locked = pool
        .total_locked
        .checked_add(amount)
        .ok_or(ViseError::MathOverflow)?;
    pool.total_weight = pool
        .total_weight
        .checked_sub(old_weight)
        .and_then(|w| w.checked_add(position.weight))
        .ok_or(ViseError::MathOverflow)?;

    emit!(PositionIncreased {
        pool: pool_key,
        position: position.key(),
        owner: position.owner,
        added: amount,
        amount: position.amount,
        weight: position.weight,
        total_weight: pool.total_weight,
        timestamp: now,
    });
    Ok(())
}

/// Push the unlock time further out, raising the multiplier.
///
/// The new duration is measured from *now*, so extending never shortens the
/// remaining term and the multiplier always reflects time still committed.
pub fn extend(ctx: Context<ModifyPosition>, duration_secs: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool.key();
    let vault_lamports = ctx.accounts.reward_vault.lamports();

    let sync_result = ctx.accounts.pool.sync(vault_lamports, now)?;
    emit_sync(&ctx.accounts.pool, pool_key, sync_result, now);

    let new_end = now
        .checked_add(duration_secs as i64)
        .ok_or(ViseError::MathOverflow)?;
    require!(
        new_end > ctx.accounts.position.lock_end,
        ViseError::NotAnExtension
    );

    let pending = settle(&ctx.accounts.pool, &mut ctx.accounts.position)?;
    pay_from_vault(
        &mut ctx.accounts.pool,
        &ctx.accounts.reward_vault,
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.system_program,
        pool_key,
        pending,
    )?;
    if pending > 0 {
        let position = &mut ctx.accounts.position;
        position.claimed = position
            .claimed
            .checked_add(pending)
            .ok_or(ViseError::MathOverflow)?;
        emit!(crate::events::Claimed {
            pool: pool_key,
            position: position.key(),
            owner: position.owner,
            amount: pending,
            lifetime_claimed: position.claimed,
            timestamp: now,
        });
    }

    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    let multiplier =
        pool.terms
            .multiplier_for(duration_secs, position.amount, ctx.accounts.mint.supply)?;
    let old_weight = position.weight;
    position.multiplier_bps = multiplier;
    position.lock_start = now;
    position.lock_end = new_end;
    position.weight = weight_of(position.amount, multiplier)?;
    position.reward_debt = reward_debt_for(position.weight, pool.acc_reward_per_weight)?;
    pool.total_weight = pool
        .total_weight
        .checked_sub(old_weight)
        .and_then(|w| w.checked_add(position.weight))
        .ok_or(ViseError::MathOverflow)?;

    emit!(PositionExtended {
        pool: pool_key,
        position: position.key(),
        owner: position.owner,
        lock_end: position.lock_end,
        multiplier_bps: position.multiplier_bps,
        weight: position.weight,
        total_weight: pool.total_weight,
        timestamp: now,
    });
    Ok(())
}

/// Move lamports out of the reward vault and keep `last_vault_balance` exact.
pub fn pay_from_vault<'info>(
    pool: &mut Account<'info, Pool>,
    reward_vault: &SystemAccount<'info>,
    destination: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    pool_key: Pubkey,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    let bump = [pool.vault_bump];
    let seeds: [&[u8]; 3] = [VAULT_SEED, pool_key.as_ref(), &bump];
    let signer: &[&[&[u8]]] = &[&seeds];

    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: reward_vault.to_account_info(),
                to: destination.clone(),
            },
            signer,
        ),
        lamports,
    )?;
    pool.debit(lamports)
}
