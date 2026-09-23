use crate::constants::*;
use crate::errors::ViseError;
use crate::events::{RewardsSynced, Unlocked};
use crate::instructions::lock::{pay_from_vault, settle};
use crate::math::early_exit_penalty;
use crate::state::{Pool, Position};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, transfer_checked, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Accounts for both exits.
///
/// `payer` signs and pays fees; `owner` receives the principal, the accrued
/// rewards and the position's rent. They are separate because a *matured*
/// position may be closed by anyone: a position that has served its term keeps
/// full weight until it is closed, which would let expired locks dilute the
/// people still committed. Letting a keeper sweep them is a service to the
/// owner, who receives everything either way.
///
/// `early_unlock` checks that `payer` is the owner, since only they may choose
/// to burn their own principal.
#[derive(Accounts)]
pub struct Unlock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: pinned to the position's recorded owner by `has_one`; receives
    /// principal, rewards and rent.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(mut, address = pool.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, address = pool.token_vault @ ViseError::VaultAccountingMismatch)]
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
        close = owner,
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

impl<'info> Unlock<'info> {
    fn pool_signer(&self) -> [u8; 1] {
        [self.pool.bump]
    }

    fn release_tokens(&self, amount: u64, mint_key: &Pubkey, bump: &[u8; 1]) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        let seeds: [&[u8]; 3] = [POOL_SEED, mint_key.as_ref(), bump];
        let signer: &[&[&[u8]]] = &[&seeds];
        transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.token_vault.to_account_info(),
                    mint: self.mint.to_account_info(),
                    to: self.owner_token_account.to_account_info(),
                    authority: self.pool.to_account_info(),
                },
                signer,
            ),
            amount,
            self.mint.decimals,
        )
    }

    fn burn_penalty(&self, amount: u64, mint_key: &Pubkey, bump: &[u8; 1]) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        let seeds: [&[u8]; 3] = [POOL_SEED, mint_key.as_ref(), bump];
        let signer: &[&[&[u8]]] = &[&seeds];
        burn(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                Burn {
                    mint: self.mint.to_account_info(),
                    from: self.token_vault.to_account_info(),
                    authority: self.pool.to_account_info(),
                },
                signer,
            ),
            amount,
        )
    }
}

fn sync_and_emit(ctx: &mut Context<Unlock>, now: i64) -> Result<()> {
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
    Ok(())
}

/// Close a matured lock: pay out everything accrued and return all principal.
///
/// Permissionless. Everything lands on the position's recorded owner, so a
/// keeper closing expired positions is doing the owner a favour while stopping
/// served-out locks from diluting the people still committed.
pub fn unlock(mut ctx: Context<Unlock>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.position.lock_end,
        ViseError::StillLocked
    );
    sync_and_emit(&mut ctx, now)?;

    let pool_key = ctx.accounts.pool.key();
    let pending = settle(&ctx.accounts.pool, &mut ctx.accounts.position)?;
    pay_from_vault(
        &mut ctx.accounts.pool,
        &ctx.accounts.reward_vault,
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.system_program,
        pool_key,
        pending,
    )?;

    let amount = ctx.accounts.position.amount;
    let weight = ctx.accounts.position.weight;
    let mint_key = ctx.accounts.pool.mint;
    let bump = ctx.accounts.pool_signer();
    ctx.accounts.release_tokens(amount, &mint_key, &bump)?;

    let position_key = ctx.accounts.position.key();
    let claimed = ctx
        .accounts
        .position
        .claimed
        .checked_add(pending)
        .ok_or(ViseError::MathOverflow)?;
    if pending > 0 {
        // The final harvest is usually the largest. Without this event an
        // indexer would miss it entirely, and now that a keeper may close a
        // matured position the payout is not attributable to the signer.
        emit!(crate::events::Claimed {
            pool: pool_key,
            position: position_key,
            owner: ctx.accounts.owner.key(),
            amount: pending,
            lifetime_claimed: claimed,
            timestamp: now,
        });
    }
    let pool = &mut ctx.accounts.pool;
    pool.total_locked = pool
        .total_locked
        .checked_sub(amount)
        .ok_or(ViseError::MathOverflow)?;
    pool.total_weight = pool
        .total_weight
        .checked_sub(weight)
        .ok_or(ViseError::MathOverflow)?;
    pool.open_positions = pool.open_positions.saturating_sub(1);

    emit!(Unlocked {
        pool: pool_key,
        position: position_key,
        owner: ctx.accounts.owner.key(),
        returned: amount,
        burned: 0,
        forfeited_rewards: 0,
        early: false,
        total_locked: pool.total_locked,
        total_weight: pool.total_weight,
        timestamp: now,
    });
    Ok(())
}

/// Break a lock before term.
///
/// Two costs, both flowing to the people who stayed: accrued SOL rewards are
/// forfeited back into the pool, and a slice of principal — linear in the
/// fraction of the term left unserved — is burned.
///
/// Owner-only, unlike the matured path: burning someone else's principal is not
/// a decision a third party gets to make for them.
pub fn early_unlock(mut ctx: Context<Unlock>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_keys_eq!(
        ctx.accounts.payer.key(),
        ctx.accounts.position.owner,
        ViseError::NotPositionOwner
    );
    require!(
        now < ctx.accounts.position.lock_end,
        ViseError::AlreadyUnlocked
    );
    sync_and_emit(&mut ctx, now)?;

    let pool_key = ctx.accounts.pool.key();
    let forfeited = settle(&ctx.accounts.pool, &mut ctx.accounts.position)?;

    let position = &ctx.accounts.position;
    let amount = position.amount;
    let weight = position.weight;
    let penalty = early_exit_penalty(
        amount,
        position.lock_start,
        position.lock_end,
        now,
        ctx.accounts.pool.terms.early_unlock_penalty_bps,
    )?;
    let returned = amount
        .checked_sub(penalty)
        .ok_or(ViseError::MathOverflow)?;

    // Drop this position's weight first so the forfeited rewards land only on
    // the lockers who stayed.
    {
        let pool = &mut ctx.accounts.pool;
        pool.total_weight = pool
            .total_weight
            .checked_sub(weight)
            .ok_or(ViseError::MathOverflow)?;
        // The lamports never left the vault, so `last_vault_balance` is
        // deliberately untouched: only their owner changes.
        pool.redistribute(forfeited)?;
    }

    let mint_key = ctx.accounts.pool.mint;
    let bump = ctx.accounts.pool_signer();
    ctx.accounts.release_tokens(returned, &mint_key, &bump)?;
    ctx.accounts.burn_penalty(penalty, &mint_key, &bump)?;

    let position_key = ctx.accounts.position.key();
    let pool = &mut ctx.accounts.pool;
    pool.total_locked = pool
        .total_locked
        .checked_sub(amount)
        .ok_or(ViseError::MathOverflow)?;
    pool.lifetime_burned = pool
        .lifetime_burned
        .checked_add(penalty)
        .ok_or(ViseError::MathOverflow)?;
    pool.open_positions = pool.open_positions.saturating_sub(1);

    emit!(Unlocked {
        pool: pool_key,
        position: position_key,
        owner: ctx.accounts.owner.key(),
        returned,
        burned: penalty,
        forfeited_rewards: forfeited,
        early: true,
        total_locked: pool.total_locked,
        total_weight: pool.total_weight,
        timestamp: now,
    });
    Ok(())
}
