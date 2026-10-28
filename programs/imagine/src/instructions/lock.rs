use crate::constants::*;
use crate::errors::ImagineError;
use crate::events::{Claimed, Locked, PositionExtended, PositionIncreased, RewardCapped};
use crate::math::{accrued, blended_lock_start, reward_debt_for, weight_of};
use crate::price::coin_value;
use crate::rewards::Rewards;
use crate::state::{Pool, Position};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// What a lock worth `value` quote units may earn at `multiplier_bps`.
pub fn reward_cap_for(value: u64, multiplier_bps: u32) -> Result<u64> {
    let cap = (value as u128)
        .checked_mul(multiplier_bps as u128)
        .ok_or(ImagineError::MathOverflow)?
        / BPS_DENOMINATOR as u128;
    u64::try_from(cap).map_err(|_| error!(ImagineError::MathOverflow))
}

/// Shared position opener. The caller must have synced the pool and moved the
/// tokens into the vault already. `supply` is the mint's total supply, read
/// from the mint account by the caller, and sets the size tier. `value` is the
/// tokens' quote value now; it sets the reward cap.
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
    value: u64,
    now: i64,
) -> Result<()> {
    require!(
        amount >= pool.terms.min_lock_amount,
        ImagineError::AmountTooSmall
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
        .ok_or(ImagineError::MathOverflow)?;
    position.reward_debt = reward_debt_for(weight, pool.acc_reward_per_weight)?;
    position.claimed = 0;
    position.bump = bump;
    position.reward_cap = reward_cap_for(value, multiplier)?;
    pool.add_capacity(position.reward_cap)?;

    pool.total_locked = pool
        .total_locked
        .checked_add(amount)
        .ok_or(ImagineError::MathOverflow)?;
    pool.total_weight = pool
        .total_weight
        .checked_add(weight)
        .ok_or(ImagineError::MathOverflow)?;
    pool.open_positions = pool
        .open_positions
        .checked_add(1)
        .ok_or(ImagineError::MathOverflow)?;
    pool.positions_created = pool
        .positions_created
        .checked_add(1)
        .ok_or(ImagineError::MathOverflow)?;
    Ok(())
}

/// Pay a position what it has accrued, up to its cap; anything over the cap
/// becomes the treasury's. Returns quote paid. Does not touch `reward_debt`:
/// callers either settle it by the full `pending` or reset it against a new
/// weight.
#[allow(clippy::too_many_arguments)]
pub fn pay_accrued<'info>(
    pool: &mut Pool,
    position: &mut Account<'info, Position>,
    rewards: &Rewards<'info>,
    recipient: &AccountInfo<'info>,
    destination: Option<&AccountInfo<'info>>,
    pool_key: Pubkey,
    pending: u64,
    now: i64,
) -> Result<u64> {
    let (paid, excess) = pool.apply_cap(position, pending)?;
    rewards.pay(pool, pool_key, recipient, destination, paid)?;
    position.claimed = position
        .claimed
        .checked_add(paid)
        .ok_or(ImagineError::MathOverflow)?;
    if paid > 0 {
        emit!(Claimed {
            pool: pool_key,
            position: position.key(),
            owner: position.owner,
            amount: paid,
            lifetime_claimed: position.claimed,
            timestamp: now,
        });
    }
    if excess > 0 {
        emit!(RewardCapped {
            pool: pool_key,
            position: position.key(),
            owner: position.owner,
            to_treasury: excess,
            claimed: position.claimed,
            reward_cap: position.reward_cap,
            timestamp: now,
        });
    }
    Ok(paid)
}

/// What has accrued at the position's current weight since its debt was last
/// settled; the caller must either pay or redistribute it.
pub fn settle(pool: &Pool, position: &Position) -> Result<u64> {
    accrued(
        position.weight,
        pool.acc_reward_per_weight,
        position.reward_debt,
    )
}

#[derive(Accounts)]
#[instruction(index: u32)]
pub struct Lock<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(address = pool.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        address = pool.token_vault @ ImagineError::VaultAccountingMismatch,
    )]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ImagineError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    /// CHECK: `pool.reward_token_account`; required unless the quote is WSOL.
    pub reward_token_account: Option<UncheckedAccount<'info>>,

    /// CHECK: the coin's LaunchLab pool, pinned to the pool; read for the
    /// coin's price (owner and discriminator verified there).
    #[account(address = pool.launchlab_pool @ ImagineError::InvalidLaunchLabAccount)]
    pub launchlab_pool: UncheckedAccount<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref(), &index.to_le_bytes()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        constraint = owner_token_account.mint == pool.mint,
        constraint = owner_token_account.owner == owner.key(),
    )]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = pool.token_program @ ImagineError::VaultAccountingMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Before `found` the pool has no token vault, so there is nothing to lock into.
/// Remaining accounts, only once the coin has migrated:
/// `price::valuation_accounts`.
pub fn lock<'info>(
    ctx: Context<'_, '_, 'info, 'info, Lock<'info>>,
    index: u32,
    amount: u64,
    duration_secs: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool.key();

    let rewards = Rewards::new(
        &ctx.accounts.pool,
        ctx.accounts.reward_vault.to_account_info(),
        ctx.accounts.reward_token_account.as_ref().map(|a| a.to_account_info()),
        None,
        None,
        None,
    )?;
    rewards.sync(&mut ctx.accounts.pool, pool_key, now)?;

    let value = coin_value(
        &ctx.accounts.pool,
        amount,
        &ctx.accounts.launchlab_pool.to_account_info(),
        ctx.remaining_accounts,
    )?;

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
        value,
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
    pub pool: Box<Account<'info, Pool>>,

    #[account(address = pool.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        address = pool.token_vault @ ImagineError::VaultAccountingMismatch,
    )]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

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
    /// CHECK: the owner's canonical quote ATA; required unless the quote is
    /// WSOL. Receives the rewards settled before the change.
    #[account(mut)]
    pub owner_quote_account: Option<UncheckedAccount<'info>>,

    /// CHECK: the coin's LaunchLab pool, pinned to the pool; read for the
    /// coin's price (owner and discriminator verified there).
    #[account(address = pool.launchlab_pool @ ImagineError::InvalidLaunchLabAccount)]
    pub launchlab_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = pool,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        constraint = owner_token_account.mint == pool.mint,
        constraint = owner_token_account.owner == owner.key(),
    )]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = pool.token_program @ ImagineError::VaultAccountingMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> ModifyPosition<'info> {
    fn rewards(&self) -> Result<Rewards<'info>> {
        Rewards::new(
            &self.pool,
            self.reward_vault.to_account_info(),
            self.reward_token_account.as_ref().map(|a| a.to_account_info()),
            self.quote_mint.as_ref().map(|a| a.to_account_info()),
            self.quote_token_program.as_ref().map(|a| a.to_account_info()),
            Some(self.system_program.to_account_info()),
        )
    }

    /// Sync, then pay what accrued at the old weight to the owner.
    fn sync_and_pay(&mut self, now: i64) -> Result<()> {
        let pool_key = self.pool.key();
        let rewards = self.rewards()?;
        rewards.sync(&mut self.pool, pool_key, now)?;
        let pending = settle(&self.pool, &self.position)?;
        let owner = self.owner.to_account_info();
        let destination = self.owner_quote_account.as_ref().map(|a| a.to_account_info());
        pay_accrued(
            &mut self.pool,
            &mut self.position,
            &rewards,
            &owner,
            destination.as_ref(),
            pool_key,
            pending,
            now,
        )?;
        Ok(())
    }
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
///
/// `lock_start` moves forward so the added principal carries the early-exit
/// penalty of a fresh lock over the term still to run, while the existing
/// principal keeps exactly the penalty it already had. See
/// `blended_lock_start`.
///
/// The added tokens raise the cap by their quote value now times the repriced
/// multiplier.
pub fn increase<'info>(
    ctx: Context<'_, '_, 'info, 'info, ModifyPosition<'info>>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, ImagineError::AmountTooSmall);
    require!(
        !ctx.accounts.position.forever,
        ImagineError::PositionLockedForever
    );
    require!(
        !ctx.accounts.position.renounced,
        ImagineError::PositionRenounced
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now < ctx.accounts.position.lock_end,
        ImagineError::PositionMatured
    );
    let pool_key = ctx.accounts.pool.key();
    ctx.accounts.sync_and_pay(now)?;

    let added_value = coin_value(
        &ctx.accounts.pool,
        amount,
        &ctx.accounts.launchlab_pool.to_account_info(),
        ctx.remaining_accounts,
    )?;

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

    let supply = ctx.accounts.mint.supply;
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    let old_weight = position.weight;
    position.lock_start = blended_lock_start(
        position.amount,
        position.lock_start,
        position.lock_end,
        amount,
        now,
    )?;
    position.amount = position
        .amount
        .checked_add(amount)
        .ok_or(ImagineError::MathOverflow)?;
    // Reprice the whole position against the term still to run and the new
    // size. Keeping the original multiplier would sell a year's weight for
    // whatever days are left, the same mispricing the maturity guard above
    // rejects; and a larger bag may have crossed into a higher tier.
    let remaining = u32::try_from(
        position
            .lock_end
            .checked_sub(now)
            .ok_or(ImagineError::MathOverflow)?,
    )
    .map_err(|_| ImagineError::MathOverflow)?;
    require!(
        remaining >= pool.terms.min_lock_secs,
        ImagineError::InvalidDuration
    );
    position.multiplier_bps = pool.terms.multiplier_for(remaining, position.amount, supply)?;
    position.weight = weight_of(position.amount, position.multiplier_bps)?;
    position.reward_debt = reward_debt_for(position.weight, pool.acc_reward_per_weight)?;
    let added_cap = reward_cap_for(added_value, position.multiplier_bps)?;
    position.reward_cap = position
        .reward_cap
        .checked_add(added_cap)
        .ok_or(ImagineError::MathOverflow)?;
    pool.add_capacity(added_cap)?;

    pool.total_locked = pool
        .total_locked
        .checked_add(amount)
        .ok_or(ImagineError::MathOverflow)?;
    pool.total_weight = pool
        .total_weight
        .checked_sub(old_weight)
        .and_then(|w| w.checked_add(position.weight))
        .ok_or(ImagineError::MathOverflow)?;
    // A lock already paid its cap earns nothing on the new weight either.
    pool.retire_if_capped(position)?;

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
///
/// A higher multiplier raises the cap by the tokens' quote value now times the
/// increase; a lower one leaves the cap where it was.
pub fn extend<'info>(
    ctx: Context<'_, '_, 'info, 'info, ModifyPosition<'info>>,
    duration_secs: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        !ctx.accounts.position.forever,
        ImagineError::PositionLockedForever
    );
    require!(
        !ctx.accounts.position.renounced,
        ImagineError::PositionRenounced
    );
    let pool_key = ctx.accounts.pool.key();
    let new_end = now
        .checked_add(duration_secs as i64)
        .ok_or(ImagineError::MathOverflow)?;
    require!(
        new_end > ctx.accounts.position.lock_end,
        ImagineError::NotAnExtension
    );

    ctx.accounts.sync_and_pay(now)?;
    let value = coin_value(
        &ctx.accounts.pool,
        ctx.accounts.position.amount,
        &ctx.accounts.launchlab_pool.to_account_info(),
        ctx.remaining_accounts,
    )?;

    let supply = ctx.accounts.mint.supply;
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    let multiplier = pool
        .terms
        .multiplier_for(duration_secs, position.amount, supply)?;
    let old_weight = position.weight;
    if multiplier > position.multiplier_bps {
        let added_cap = reward_cap_for(value, multiplier - position.multiplier_bps)?;
        position.reward_cap = position
            .reward_cap
            .checked_add(added_cap)
            .ok_or(ImagineError::MathOverflow)?;
        pool.add_capacity(added_cap)?;
    }
    position.multiplier_bps = multiplier;
    position.lock_start = now;
    position.lock_end = new_end;
    position.weight = weight_of(position.amount, multiplier)?;
    position.reward_debt = reward_debt_for(position.weight, pool.acc_reward_per_weight)?;
    pool.total_weight = pool
        .total_weight
        .checked_sub(old_weight)
        .and_then(|w| w.checked_add(position.weight))
        .ok_or(ImagineError::MathOverflow)?;
    pool.retire_if_capped(position)?;

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
