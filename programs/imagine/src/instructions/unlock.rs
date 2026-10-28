use crate::constants::*;
use crate::errors::ImagineError;
use crate::events::Unlocked;
use crate::instructions::lock::{pay_accrued, settle};
use crate::math::early_exit_penalty;
use crate::rewards::Rewards;
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
/// Principal and quote-token rewards only ever land in the owner's canonical
/// associated token accounts. Any account the owner merely *owns* is not
/// enough: a third party closing a matured lock could otherwise park the
/// tokens in a stray account the owner's wallet never displays. The ATAs are
/// not created here; a caller that cannot be sure they exist prepends
/// idempotent creates.
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
    pub pool: Box<Account<'info, Pool>>,

    #[account(mut, address = pool.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = pool.token_vault @ ImagineError::VaultAccountingMismatch)]
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
    /// CHECK: the owner's canonical quote ATA; required unless the quote is WSOL.
    #[account(mut)]
    pub owner_quote_account: Option<UncheckedAccount<'info>>,

    #[account(
        mut,
        close = owner,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = pool,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = pool.token_program @ ImagineError::VaultAccountingMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> Unlock<'info> {
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

    fn release_tokens(&self, amount: u64) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        let bump = [self.pool.bump];
        let seeds: [&[u8]; 3] = [POOL_SEED, self.pool.mint.as_ref(), &bump];
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

    fn burn_penalty(&self, amount: u64) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        let bump = [self.pool.bump];
        let seeds: [&[u8]; 3] = [POOL_SEED, self.pool.mint.as_ref(), &bump];
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

/// Close a matured lock: pay out everything accrued and return all principal.
///
/// Permissionless. Everything lands on the position's recorded owner, so a
/// keeper closing expired positions is doing the owner a favour while stopping
/// served-out locks from diluting the people still committed.
pub fn unlock(ctx: Context<Unlock>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    require!(now >= a.position.lock_end, ImagineError::StillLocked);
    let pool_key = a.pool.key();
    let rewards = a.rewards()?;
    rewards.sync(&mut a.pool, pool_key, now)?;

    let pending = settle(&a.pool, &a.position)?;
    let owner = a.owner.to_account_info();
    let destination = a.owner_quote_account.as_ref().map(|x| x.to_account_info());
    pay_accrued(
        &mut a.pool,
        &mut a.position,
        &rewards,
        &owner,
        destination.as_ref(),
        pool_key,
        pending,
        now,
    )?;
    // Everything accrued is settled, so the lock takes only its unused cap
    // with it.
    a.pool.close_capacity(&a.position, 0);

    let amount = a.position.amount;
    let weight = a.position.weight;
    a.release_tokens(amount)?;

    let position_key = a.position.key();
    let pool = &mut a.pool;
    pool.total_locked = pool
        .total_locked
        .checked_sub(amount)
        .ok_or(ImagineError::MathOverflow)?;
    pool.total_weight = pool
        .total_weight
        .checked_sub(weight)
        .ok_or(ImagineError::MathOverflow)?;
    pool.open_positions = pool.open_positions.saturating_sub(1);

    emit!(Unlocked {
        pool: pool_key,
        position: position_key,
        owner: owner.key(),
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

/// Break a lock before term, or leave a matured one without its rewards.
///
/// Before term, two costs, both flowing to the people who stayed: accrued
/// rewards are forfeited back into the pool's release stream, and a slice of
/// principal — linear in the fraction of the term left unserved — is burned.
///
/// From the end date the burn is zero, so this returns every coin and moves no
/// quote at all. That is the way out when the matured `unlock` cannot pay the
/// rewards because the quote's issuer has paused, frozen or hooked it: the
/// coins never depend on the quote. The rewards are forfeited to the stayers
/// as before; waiting and using `unlock` keeps them.
///
/// Owner-only, unlike the matured path: burning someone else's principal, or
/// giving up their rewards, is not a decision a third party gets to make for
/// them. Pays out no quote, so the quote mint, program and owner quote account
/// may be omitted.
pub fn early_unlock(ctx: Context<Unlock>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    require_keys_eq!(
        a.payer.key(),
        a.position.owner,
        ImagineError::NotPositionOwner
    );
    let early = now < a.position.lock_end;
    let pool_key = a.pool.key();
    let rewards = a.rewards()?;
    rewards.sync(&mut a.pool, pool_key, now)?;

    let forfeited = settle(&a.pool, &a.position)?;
    let amount = a.position.amount;
    let weight = a.position.weight;
    let penalty = early_exit_penalty(
        amount,
        a.position.lock_start,
        a.position.lock_end,
        now,
        a.pool.terms.early_unlock_penalty_bps,
    )?;
    let returned = amount
        .checked_sub(penalty)
        .ok_or(ImagineError::MathOverflow)?;

    // Drop this position's weight first so the forfeited rewards land only on
    // the lockers who stayed. They stream out rather than landing at once, so
    // weight added in the same slot as the exit cannot capture them.
    {
        let pool = &mut a.pool;
        pool.total_weight = pool
            .total_weight
            .checked_sub(weight)
            .ok_or(ImagineError::MathOverflow)?;
        pool.close_capacity(&a.position, forfeited);
        // The quote never left the vault, so `last_vault_balance` is
        // deliberately untouched: only its owner changes.
        pool.forfeit(forfeited, now)?;
    }

    a.release_tokens(returned)?;
    a.burn_penalty(penalty)?;

    let position_key = a.position.key();
    let owner = a.owner.key();
    let pool = &mut a.pool;
    pool.total_locked = pool
        .total_locked
        .checked_sub(amount)
        .ok_or(ImagineError::MathOverflow)?;
    pool.lifetime_burned = pool
        .lifetime_burned
        .checked_add(penalty)
        .ok_or(ImagineError::MathOverflow)?;
    pool.open_positions = pool.open_positions.saturating_sub(1);

    emit!(Unlocked {
        pool: pool_key,
        position: position_key,
        owner,
        returned,
        burned: penalty,
        forfeited_rewards: forfeited,
        early,
        total_locked: pool.total_locked,
        total_weight: pool.total_weight,
        timestamp: now,
    });
    Ok(())
}
