use crate::constants::*;
use crate::errors::ImagineError;
use crate::events::{Compounded, RewardCapped};
use crate::instructions::lock::{grow_position, settle};
use crate::launchlab::{token_amount, IX_BUY_EXACT_IN, IX_CPMM_SWAP_BASE_INPUT};
use crate::price::{scale, spot};
use crate::rewards::{is_native, Rewards};
use crate::state::{Pool, Position};
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::{self, get_associated_token_address_with_program_id, AssociatedToken};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    close_account, sync_native, CloseAccount, Mint, SyncNative, TokenAccount, TokenInterface,
};

/// Remaining accounts of `compound` while the coin trades on its LaunchLab
/// curve, in this order. LaunchLab validates them against the pinned pool.
pub mod curve_buy_accounts {
    /// LaunchLab `["vault_auth_seed"]`.
    pub const AUTHORITY: usize = 0;
    /// The pool's `global_config`.
    pub const GLOBAL_CONFIG: usize = 1;
    /// The pool's `platform_config`.
    pub const PLATFORM_CONFIG: usize = 2;
    /// The curve's coin and quote vaults (writable).
    pub const BASE_VAULT: usize = 3;
    pub const QUOTE_VAULT: usize = 4;
    /// LaunchLab `["__event_authority"]`.
    pub const EVENT_AUTHORITY: usize = 5;
    /// The LaunchLab program.
    pub const PROGRAM: usize = 6;
    /// `[platform_config, quote_mint]` and `[reward_vault, quote_mint]`
    /// (writable): where the trade's platform and creator fees land.
    pub const PLATFORM_FEE_VAULT: usize = 7;
    pub const CREATOR_FEE_VAULT: usize = 8;
    pub const LEN: usize = 9;
}

/// Remaining accounts of `compound` once the coin has migrated to CPMM, in
/// this order. The first three are `price::valuation_accounts`.
pub mod cpmm_buy_accounts {
    /// The CPMM pool the coin graduated into (writable).
    pub const POOL: usize = 0;
    /// Its coin and quote vaults (writable).
    pub const BASE_VAULT: usize = 1;
    pub const QUOTE_VAULT: usize = 2;
    /// CPMM `["vault_and_lp_mint_auth_seed"]`.
    pub const AUTHORITY: usize = 3;
    /// The pool's `amm_config`.
    pub const AMM_CONFIG: usize = 4;
    /// The pool's observation state (writable).
    pub const OBSERVATION: usize = 5;
    /// The CPMM program.
    pub const PROGRAM: usize = 6;
    pub const LEN: usize = 7;
}

#[derive(Accounts)]
pub struct SetAutoCompound<'info> {
    pub owner: Signer<'info>,

    #[account(seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = pool,
    )]
    pub position: Box<Account<'info, Position>>,
}

/// Opt a lock in to (or out of) auto-compound. Owner-only, never on by
/// default. A renounced or forever lock earns nothing to compound.
pub fn set_auto_compound(ctx: Context<SetAutoCompound>, enabled: bool) -> Result<()> {
    let position = &mut ctx.accounts.position;
    require!(!position.forever, ImagineError::PositionLockedForever);
    require!(!position.renounced, ImagineError::PositionRenounced);
    position.auto_compound = enabled;
    Ok(())
}

#[derive(Accounts)]
pub struct Compound<'info> {
    /// The owner, or for a lock with auto-compound on, the IMAGINE keeper
    /// (`KEEPER_AUTHORITY`). Pays the fees and fronts the rent of the
    /// transient WSOL account (refunded).
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: pinned to the position's recorded owner by `has_one`.
    pub owner: UncheckedAccount<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = pool,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(address = pool.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// Receives the coins bought.
    #[account(
        mut,
        address = pool.token_vault @ ImagineError::VaultAccountingMismatch,
    )]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Signs the buy: it holds the quote being spent.
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ImagineError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    /// CHECK: `ATA(reward_vault, quote_mint, quote_token_program)`, checked in
    /// the handler: the pool's reward token account, or for a WSOL quote a
    /// transient WSOL account the spent lamports are wrapped into.
    #[account(mut)]
    pub vault_quote_account: UncheckedAccount<'info>,

    /// CHECK: the quote; pinned to the pool.
    #[account(address = pool.quote_mint)]
    pub quote_mint: UncheckedAccount<'info>,
    #[account(address = pool.quote_token_program @ ImagineError::QuoteAccountMismatch)]
    pub quote_token_program: Interface<'info, TokenInterface>,
    #[account(address = pool.token_program @ ImagineError::VaultAccountingMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    /// CHECK: the coin's LaunchLab pool, pinned to the pool; read for the
    /// price (owner and discriminator verified there) and traded on while the
    /// coin is on its curve.
    #[account(mut, address = pool.launchlab_pool @ ImagineError::InvalidLaunchLabAccount)]
    pub launchlab_pool: UncheckedAccount<'info>,
}

fn meta(info: &AccountInfo, writable: bool) -> AccountMeta {
    AccountMeta { pubkey: info.key(), is_signer: false, is_writable: writable }
}

/// Turn a lock's rewards into more of its coin, added to the same lock.
///
/// The owner's own one-click compound, or, once the owner has turned
/// auto-compound on, the IMAGINE keeper's (`KEEPER_AUTHORITY`) with a
/// non-zero `min_tokens_out`. Nobody else may crank it, so no third party can
/// sandwich a lock's buy. Atomically:
///
/// 1. Sync and settle the lock exactly like a claim: what it may be paid, up
///    to its cap (anything over goes to the treasury), counts as paid.
/// 2. Spend that quote from the reward vault on the coin: LaunchLab
///    `buy_exact_in` while on the curve (`curve_buy_accounts`), CPMM
///    `swap_base_input` once migrated (`cpmm_buy_accounts`, priced off the
///    pool the coin graduated into). The venue's trade fees apply as on any
///    trade; IMAGINE takes no app fee.
/// 3. Refuse the fill below `min_tokens_out`, or more than
///    `COMPOUND_SLIPPAGE_BPS` below the venue's spot price before the buy.
/// 4. The coins land in the pool's token vault and join the lock like
///    `increase`: same unlock time, multiplier repriced, cap raised by the
///    coins' value at that spot price.
pub fn compound<'info>(
    ctx: Context<'_, '_, 'info, 'info, Compound<'info>>,
    min_tokens_out: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let position = &a.position;
    require!(!position.forever, ImagineError::PositionLockedForever);
    require!(!position.renounced, ImagineError::PositionRenounced);
    if a.payer.key() != position.owner {
        require_keys_eq!(a.payer.key(), KEEPER_AUTHORITY, ImagineError::NotKeeper);
        require!(position.auto_compound, ImagineError::CompoundNotEnabled);
        require!(min_tokens_out > 0, ImagineError::InvalidParameter);
    }
    require!(now < position.lock_end, ImagineError::PositionMatured);

    let pool_key = a.pool.key();
    let vault = a.reward_vault.to_account_info();
    let quote_key = a.quote_mint.key();
    let quote_program = a.quote_token_program.to_account_info();
    let quote_account = a.vault_quote_account.to_account_info();
    require_keys_eq!(
        quote_account.key(),
        get_associated_token_address_with_program_id(&vault.key(), &quote_key, quote_program.key),
        ImagineError::QuoteAccountMismatch
    );
    let native = is_native(&quote_key);
    let mint = a.mint.to_account_info();
    let token_vault = a.token_vault.to_account_info();
    let coin_program = a.token_program.to_account_info();
    let system = a.system_program.to_account_info();
    let payer = a.payer.to_account_info();
    let launchlab_pool = a.launchlab_pool.to_account_info();
    let supply = a.mint.supply;
    let r = ctx.remaining_accounts;
    let rewards = Rewards::new(&a.pool, vault.clone(), Some(quote_account.clone()), None, None, None)?;
    let bump = [a.pool.vault_bump];
    let seeds: [&[u8]; 3] = [VAULT_SEED, pool_key.as_ref(), &bump];

    // 1. Settle, as a claim would.
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    rewards.sync(pool, pool_key, now)?;
    let pending = settle(pool, position)?;
    let (quote_in, excess) = pool.apply_cap(position, pending)?;
    require!(quote_in >= MIN_COMPOUND_QUOTE, ImagineError::CompoundTooSmall);
    position.claimed = position
        .claimed
        .checked_add(quote_in)
        .ok_or(ImagineError::MathOverflow)?;
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
    let (quote_reserve, base_reserve, migrated) = spot(pool, &launchlab_pool, r)?;

    // 2. Put the quote where the venue can take it from.
    if native {
        if quote_account.data_is_empty() {
            associated_token::create_idempotent(CpiContext::new(
                ctx.accounts.associated_token_program.to_account_info(),
                associated_token::Create {
                    payer: payer.clone(),
                    associated_token: quote_account.clone(),
                    authority: vault.clone(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    system_program: system.clone(),
                    token_program: quote_program.clone(),
                },
            ))?;
        }
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                system.clone(),
                anchor_lang::system_program::Transfer { from: vault.clone(), to: quote_account.clone() },
                &[&seeds],
            ),
            quote_in,
        )?;
        sync_native(CpiContext::new(
            quote_program.clone(),
            SyncNative { account: quote_account.clone() },
        ))?;
    }
    let quote_before = token_amount(&quote_account)?;
    let coins_before = token_amount(&token_vault)?;

    // 3. Buy into the token vault, the vault PDA signing for its quote.
    let mut data = Vec::with_capacity(32);
    let (program, metas, mut infos) = if migrated {
        use cpmm_buy_accounts as c;
        require!(r.len() >= c::LEN, ImagineError::PriceUnavailable);
        require_keys_eq!(r[c::PROGRAM].key(), CPMM_PROGRAM_ID, ImagineError::InvalidLaunchLabAccount);
        data.extend_from_slice(&IX_CPMM_SWAP_BASE_INPUT);
        let infos = vec![
            vault.clone(),
            r[c::AUTHORITY].clone(),
            r[c::AMM_CONFIG].clone(),
            r[c::POOL].clone(),
            quote_account.clone(),
            token_vault.clone(),
            r[c::QUOTE_VAULT].clone(),
            r[c::BASE_VAULT].clone(),
            quote_program.clone(),
            coin_program.clone(),
            ctx.accounts.quote_mint.to_account_info(),
            mint.clone(),
            r[c::OBSERVATION].clone(),
        ];
        let w = [false, false, false, true, true, true, true, true, false, false, false, false, true];
        let metas = infos.iter().zip(w).map(|(i, w)| meta(i, w)).collect::<Vec<_>>();
        (r[c::PROGRAM].clone(), metas, infos)
    } else {
        use curve_buy_accounts as c;
        require!(r.len() >= c::LEN, ImagineError::InvalidLaunchLabAccount);
        require_keys_eq!(r[c::PROGRAM].key(), LAUNCHLAB_PROGRAM_ID, ImagineError::InvalidLaunchLabAccount);
        data.extend_from_slice(&IX_BUY_EXACT_IN);
        let infos = vec![
            vault.clone(),
            r[c::AUTHORITY].clone(),
            r[c::GLOBAL_CONFIG].clone(),
            r[c::PLATFORM_CONFIG].clone(),
            launchlab_pool.clone(),
            token_vault.clone(),
            quote_account.clone(),
            r[c::BASE_VAULT].clone(),
            r[c::QUOTE_VAULT].clone(),
            mint.clone(),
            ctx.accounts.quote_mint.to_account_info(),
            coin_program.clone(),
            quote_program.clone(),
            r[c::EVENT_AUTHORITY].clone(),
            r[c::PROGRAM].clone(),
            system.clone(),
            r[c::PLATFORM_FEE_VAULT].clone(),
            r[c::CREATOR_FEE_VAULT].clone(),
        ];
        let w = [
            true, false, false, false, true, true, true, true, true, false, false, false, false,
            false, false, false, true, true,
        ];
        let metas = infos.iter().zip(w).map(|(i, w)| meta(i, w)).collect::<Vec<_>>();
        (r[c::PROGRAM].clone(), metas, infos)
    };
    data.extend_from_slice(&quote_in.to_le_bytes());
    // The venue's own minimum stays 0: the limits are checked below, against
    // what actually reached the vault, so a refusal is always CompoundSlippage.
    data.extend_from_slice(&0u64.to_le_bytes());
    if !migrated {
        // share_fee_rate: no share fee.
        data.extend_from_slice(&0u64.to_le_bytes());
    }
    let mut metas = metas;
    // The vault PDA signs (invoke_signed), and pays nothing but its quote.
    metas[0].is_signer = true;
    infos.push(program.clone());
    invoke_signed(
        &Instruction { program_id: program.key(), accounts: metas, data },
        &infos,
        &[&seeds],
    )?;

    let spent = quote_before.saturating_sub(token_amount(&quote_account)?);
    let tokens_out = token_amount(&token_vault)?
        .checked_sub(coins_before)
        .ok_or(ImagineError::VaultAccountingMismatch)?;
    // All of it, or the venue capped the fill (a curve about to complete).
    let floor = scale(quote_in, base_reserve, quote_reserve)?;
    require!(
        spent == quote_in
            && tokens_out >= min_tokens_out
            && tokens_out as u128 * BPS_DENOMINATOR as u128
                >= floor as u128 * (BPS_DENOMINATOR - COMPOUND_SLIPPAGE_BPS) as u128,
        ImagineError::CompoundSlippage
    );

    if native {
        // Unwrap whatever is left (normally nothing) back into the vault and
        // refund the account's rent to the payer.
        let rent = quote_account.lamports().saturating_sub(token_amount(&quote_account)?);
        close_account(CpiContext::new_with_signer(
            quote_program,
            CloseAccount { account: quote_account.clone(), destination: vault.clone(), authority: vault.clone() },
            &[&seeds],
        ))?;
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                system,
                anchor_lang::system_program::Transfer { from: vault.clone(), to: payer },
                &[&seeds],
            ),
            rent,
        )?;
    }
    pool.debit(quote_in)?;
    // The venue must not have taken anything else from the vault.
    require!(
        rewards.balance(pool)? >= pool.last_vault_balance,
        ImagineError::VaultAccountingMismatch
    );

    // 4. Add the coins to the lock, valued at the spot price before the buy.
    let added_value = scale(tokens_out, quote_reserve, base_reserve)?;
    grow_position(pool, position, tokens_out, added_value, supply, now)?;

    emit!(Compounded {
        pool: pool_key,
        position: position.key(),
        owner: position.owner,
        quote_in,
        tokens_out,
        new_amount: position.amount,
        new_weight: position.weight,
        timestamp: now,
    });
    Ok(())
}
