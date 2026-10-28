use crate::constants::*;
use crate::errors::ImagineError;
use crate::events::{CreatorClaimed, Renounced, TreasuryClaimed};
use crate::instructions::lock::{pay_accrued, settle};
use crate::math::settle_debt;
use crate::rewards::Rewards;
use crate::state::{Pool, Position};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenInterface;

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ImagineError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    /// CHECK: `pool.reward_token_account`; required unless the quote is WSOL.
    #[account(mut)]
    pub reward_token_account: Option<UncheckedAccount<'info>>,
    /// CHECK: `pool.quote_mint`; required unless the quote is WSOL.
    pub quote_mint: Option<UncheckedAccount<'info>>,
    /// Required unless the quote is WSOL.
    pub quote_token_program: Option<Interface<'info, TokenInterface>>,
    /// CHECK: the owner's canonical quote ATA; required unless the quote is WSOL.
    #[account(mut)]
    pub owner_quote_account: Option<UncheckedAccount<'info>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = pool,
    )]
    pub position: Box<Account<'info, Position>>,

    pub system_program: Program<'info, System>,
}

/// Collect accrued rewards without touching the lock. Always available, even
/// while locked, even when launches are paused.
pub fn claim(ctx: Context<Claim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let rewards = Rewards::new(
        &a.pool,
        a.reward_vault.to_account_info(),
        a.reward_token_account.as_ref().map(|x| x.to_account_info()),
        a.quote_mint.as_ref().map(|x| x.to_account_info()),
        a.quote_token_program.as_ref().map(|x| x.to_account_info()),
        Some(a.system_program.to_account_info()),
    )?;
    let owner = a.owner.to_account_info();
    let destination = a.owner_quote_account.as_ref().map(|x| x.to_account_info());
    harvest_into(&mut a.pool, &mut a.position, &rewards, &owner, destination.as_ref(), now)
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
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ImagineError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    /// CHECK: `pool.reward_token_account`; required unless the quote is WSOL.
    #[account(mut)]
    pub reward_token_account: Option<UncheckedAccount<'info>>,
    /// CHECK: `pool.quote_mint`; required unless the quote is WSOL.
    pub quote_mint: Option<UncheckedAccount<'info>>,
    /// Required unless the quote is WSOL.
    pub quote_token_program: Option<Interface<'info, TokenInterface>>,
    /// CHECK: the owner's canonical quote ATA; required unless the quote is WSOL.
    #[account(mut)]
    pub owner_quote_account: Option<UncheckedAccount<'info>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = pool,
    )]
    pub position: Box<Account<'info, Position>>,

    pub system_program: Program<'info, System>,
}

/// `claim`, callable by anyone, paying the position's owner. This is how a
/// keeper retires locks that have reached their cap: the owner is paid up to
/// it, the excess goes to the treasury, and the lock's weight stops diluting
/// the locks still earning.
pub fn harvest(ctx: Context<Harvest>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let rewards = Rewards::new(
        &a.pool,
        a.reward_vault.to_account_info(),
        a.reward_token_account.as_ref().map(|x| x.to_account_info()),
        a.quote_mint.as_ref().map(|x| x.to_account_info()),
        a.quote_token_program.as_ref().map(|x| x.to_account_info()),
        Some(a.system_program.to_account_info()),
    )?;
    let owner = a.owner.to_account_info();
    let destination = a.owner_quote_account.as_ref().map(|x| x.to_account_info());
    harvest_into(&mut a.pool, &mut a.position, &rewards, &owner, destination.as_ref(), now)
}

fn harvest_into<'info>(
    pool: &mut Pool,
    position: &mut Account<'info, Position>,
    rewards: &Rewards<'info>,
    owner: &AccountInfo<'info>,
    destination: Option<&AccountInfo<'info>>,
    now: i64,
) -> Result<()> {
    let pool_key = position.pool;
    rewards.sync(pool, pool_key, now)?;
    let pending = settle(pool, position)?;
    require!(pending > 0, ImagineError::NothingToClaim);
    pay_accrued(pool, position, rewards, owner, destination, pool_key, pending, now)?;
    position.reward_debt = settle_debt(position.reward_debt, pending)?;
    pool.retire_if_capped(position)
}

#[derive(Accounts)]
pub struct Renounce<'info> {
    pub owner: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ImagineError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    /// CHECK: `pool.reward_token_account`; required unless the quote is WSOL.
    pub reward_token_account: Option<UncheckedAccount<'info>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = pool,
    )]
    pub position: Box<Account<'info, Position>>,
}

/// Give up this lock's earnings for good. The tokens stay locked to the same
/// end date and can still be unlocked then (or broken early, with the usual
/// burn), but the lock holds no weight from here on: what it had accrued and
/// everything it would have earned goes to the other lockers instead.
///
/// Accrued rewards return to the stream rather than landing at once, exactly
/// like an early exit's forfeit, so nobody can lock in the same slot and take
/// a lump of them. Irreversible: a renounced lock cannot be grown or extended.
/// Pays nothing, so it needs no quote payout accounts.
pub fn renounce(ctx: Context<Renounce>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool.key();
    let position_key = ctx.accounts.position.key();
    require!(
        !ctx.accounts.position.renounced,
        ImagineError::PositionRenounced
    );
    let rewards = Rewards::new(
        &ctx.accounts.pool,
        ctx.accounts.reward_vault.to_account_info(),
        ctx.accounts.reward_token_account.as_ref().map(|x| x.to_account_info()),
        None,
        None,
        None,
    )?;
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    rewards.sync(pool, pool_key, now)?;

    // Weight leaves first so the forfeit lands only on the lockers who remain.
    let forfeited = settle(pool, position)?;
    pool.total_weight = pool
        .total_weight
        .checked_sub(position.weight)
        .ok_or(ImagineError::MathOverflow)?;
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
    #[account(mut, address = pool.creator @ ImagineError::NotPoolCreator)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ImagineError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    /// CHECK: `pool.reward_token_account`; required unless the quote is WSOL.
    #[account(mut)]
    pub reward_token_account: Option<UncheckedAccount<'info>>,
    /// CHECK: `pool.quote_mint`; required unless the quote is WSOL.
    pub quote_mint: Option<UncheckedAccount<'info>>,
    /// Required unless the quote is WSOL.
    pub quote_token_program: Option<Interface<'info, TokenInterface>>,
    /// CHECK: the creator's canonical quote ATA; required unless the quote is
    /// WSOL.
    #[account(mut)]
    pub creator_quote_account: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

pub fn claim_creator(ctx: Context<ClaimCreator>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let pool_key = a.pool.key();
    let rewards = Rewards::new(
        &a.pool,
        a.reward_vault.to_account_info(),
        a.reward_token_account.as_ref().map(|x| x.to_account_info()),
        a.quote_mint.as_ref().map(|x| x.to_account_info()),
        a.quote_token_program.as_ref().map(|x| x.to_account_info()),
        Some(a.system_program.to_account_info()),
    )?;
    rewards.sync(&mut a.pool, pool_key, now)?;

    let amount = a.pool.creator_claimable;
    require!(amount > 0, ImagineError::NothingToClaim);
    a.pool.creator_claimable = 0;
    let creator = a.creator.to_account_info();
    let destination = a.creator_quote_account.as_ref().map(|x| x.to_account_info());
    rewards.pay(&mut a.pool, pool_key, &creator, destination.as_ref(), amount)?;

    emit!(CreatorClaimed {
        pool: pool_key,
        creator: creator.key(),
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
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: pinned to the treasury stamped into the pool at launch.
    #[account(mut, address = pool.treasury @ ImagineError::TreasuryMismatch)]
    pub treasury: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ImagineError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    /// CHECK: `pool.reward_token_account`; required unless the quote is WSOL.
    #[account(mut)]
    pub reward_token_account: Option<UncheckedAccount<'info>>,
    /// CHECK: `pool.quote_mint`; required unless the quote is WSOL.
    pub quote_mint: Option<UncheckedAccount<'info>>,
    /// Required unless the quote is WSOL.
    pub quote_token_program: Option<Interface<'info, TokenInterface>>,
    /// CHECK: the treasury's canonical quote ATA; required unless the quote is
    /// WSOL.
    #[account(mut)]
    pub treasury_quote_account: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

pub fn claim_treasury(ctx: Context<ClaimTreasury>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let pool_key = a.pool.key();
    let rewards = Rewards::new(
        &a.pool,
        a.reward_vault.to_account_info(),
        a.reward_token_account.as_ref().map(|x| x.to_account_info()),
        a.quote_mint.as_ref().map(|x| x.to_account_info()),
        a.quote_token_program.as_ref().map(|x| x.to_account_info()),
        Some(a.system_program.to_account_info()),
    )?;
    rewards.sync(&mut a.pool, pool_key, now)?;

    let amount = a.pool.treasury_claimable;
    require!(amount > 0, ImagineError::NothingToClaim);
    a.pool.treasury_claimable = 0;
    let treasury = a.treasury.to_account_info();
    let destination = a.treasury_quote_account.as_ref().map(|x| x.to_account_info());
    rewards.pay(&mut a.pool, pool_key, &treasury, destination.as_ref(), amount)?;

    emit!(TreasuryClaimed {
        pool: pool_key,
        treasury: treasury.key(),
        amount,
        timestamp: now,
    });
    Ok(())
}
