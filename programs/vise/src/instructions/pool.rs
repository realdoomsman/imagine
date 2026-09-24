use crate::constants::*;
use crate::errors::ViseError;
use crate::events::{Locked, PoolCreated, RewardsSynced};
use crate::instructions::lock::open_position;
use crate::price::coin_value_lamports;
use crate::mint_guard::assert_custody_safe;
use crate::state::{Config, Pool, PoolTerms, Position};
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Index of the creator's mandatory founding lock.
pub const FIRST_POSITION_INDEX: [u8; 4] = 0u32.to_le_bytes();

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreatePoolArgs {
    /// Slice of post-treasury inflow routed to the creator, forever.
    pub creator_share_bps: u16,
    /// The creator's own founding lock. Required: it guarantees the pool has
    /// non-zero weight from its first slot, so no later locker can scoop an
    /// accumulated remainder, and it puts the creator's tokens at risk first.
    pub initial_lock_amount: u64,
    pub initial_lock_duration: u32,
}

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: pinned to the configured treasury; receives the creation fee only.
    #[account(mut, address = config.treasury @ ViseError::TreasuryMismatch)]
    pub treasury: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: pump.fun's `BondingCurve` for this mint. Deserialised by hand in
    /// the handler to prove the signer is the coin's real creator; owner and
    /// PDA derivation are both verified there.
    #[account(
        seeds = [b"bonding-curve", mint.key().as_ref()],
        bump,
        seeds::program = PUMP_PROGRAM_ID,
    )]
    pub bonding_curve: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        init,
        payer = creator,
        seeds = [TOKEN_VAULT_SEED, pool.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: system-owned PDA that holds SOL rewards. Never carries data, so
    /// lamports can leave only through a signed system transfer.
    #[account(mut, seeds = [VAULT_SEED, pool.key().as_ref()], bump)]
    pub reward_vault: SystemAccount<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, pool.key().as_ref(), creator.key().as_ref(), &FIRST_POSITION_INDEX],
        bump
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        constraint = creator_token_account.mint == mint.key(),
        constraint = creator_token_account.owner == creator.key(),
    )]
    pub creator_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Read `BondingCurve::creator` straight out of pump.fun's account.
///
/// This is what stops pool squatting. The pool PDA is one-per-mint, so whoever
/// creates it owns that coin's creator share forever; without this check the
/// first caller — not the person who launched the coin — would collect it, and
/// the real creator could never open a competing pool.
///
/// Deserialised by offset rather than through a CPI: pump exposes no read
/// instruction, and the account is proven to be the canonical PDA by the seeds
/// constraint plus this owner check, so the bytes are pump's own.
fn pump_coin_creator(account: &UncheckedAccount) -> Result<Pubkey> {
    require_keys_eq!(
        *account.owner,
        PUMP_PROGRAM_ID,
        ViseError::InvalidBondingCurve
    );
    let data = account.try_borrow_data()?;
    let end = PUMP_BONDING_CURVE_CREATOR_OFFSET + 32;
    require!(data.len() >= end, ViseError::InvalidBondingCurve);
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&data[PUMP_BONDING_CURVE_CREATOR_OFFSET..end]);
    let creator = Pubkey::new_from_array(bytes);
    require_keys_neq!(creator, Pubkey::default(), ViseError::InvalidBondingCurve);
    Ok(creator)
}

/// Remaining accounts, only when the coin has already graduated (a coin
/// brought over from pump.fun): the canonical pump AMM pool's base and quote
/// vaults, to value the founding lock.
pub fn create_pool<'info>(
    ctx: Context<'_, '_, 'info, 'info, CreatePool<'info>>,
    args: CreatePoolArgs,
) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, ViseError::Paused);
    require!(
        args.creator_share_bps <= config.max_creator_share_bps,
        ViseError::InvalidParameter
    );
    assert_custody_safe(&ctx.accounts.mint, &ctx.accounts.mint.to_account_info())?;
    require_keys_eq!(
        pump_coin_creator(&ctx.accounts.bonding_curve)?,
        ctx.accounts.creator.key(),
        ViseError::NotCoinCreator
    );

    let now = Clock::get()?.unix_timestamp;
    let terms = PoolTerms {
        treasury_share_bps: config.default_treasury_share_bps,
        creator_share_bps: args.creator_share_bps,
        min_lock_secs: config.default_min_lock_secs,
        max_lock_secs: config.default_max_lock_secs,
        max_multiplier_bps: config.default_max_multiplier_bps,
        early_unlock_penalty_bps: config.default_early_unlock_penalty_bps,
        min_lock_amount: config.default_min_lock_amount,
        reward_stream_secs: config.default_reward_stream_secs,
        duration_curve: config.default_duration_curve,
        size_tier_bps: config.default_size_tier_bps,
        size_bonus_bps: config.default_size_bonus_bps,
    };
    terms.validate()?;

    let pool_key = ctx.accounts.pool.key();
    // Over-fund the rent floor: the reserve is snapshotted here for the life of
    // the pool, and a future rise in the rent minimum would otherwise make the
    // last payout fail until somebody donated lamports.
    let vault_reserve = Rent::get()?
        .minimum_balance(0)
        .saturating_mul(2);

    {
        let pool = &mut ctx.accounts.pool;
        pool.mint = ctx.accounts.mint.key();
        pool.creator = ctx.accounts.creator.key();
        pool.treasury = config.treasury;
        pool.token_vault = ctx.accounts.token_vault.key();
        pool.reward_vault = ctx.accounts.reward_vault.key();
        pool.token_program = ctx.accounts.token_program.key();
        pool.terms = terms;
        pool.vault_reserve = vault_reserve;
        pool.created_at = now;
        pool.bump = ctx.bumps.pool;
        pool.vault_bump = ctx.bumps.reward_vault;
        // Every pool from here on limits what each lock can earn.
        pool.capped = true;
    }

    // Fund the reward vault's rent floor so it can exist as a system account and
    // never risks dropping below rent exemption on a payout.
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
            },
        ),
        vault_reserve,
    )?;

    if config.pool_creation_fee > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            config.pool_creation_fee,
        )?;
    }

    // Founding lock.
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.creator_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.token_vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        args.initial_lock_amount,
        ctx.accounts.mint.decimals,
    )?;

    let value = coin_value_lamports(
        &ctx.accounts.mint.key(),
        &ctx.accounts.token_program.key(),
        args.initial_lock_amount,
        &ctx.accounts.bonding_curve.to_account_info(),
        ctx.remaining_accounts,
    )?;
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    open_position(
        pool,
        position,
        ctx.accounts.creator.key(),
        pool_key,
        0,
        ctx.bumps.position,
        args.initial_lock_amount,
        args.initial_lock_duration,
        ctx.accounts.mint.supply,
        value,
        now,
    )?;

    ctx.accounts.config.pool_count = ctx
        .accounts
        .config
        .pool_count
        .checked_add(1)
        .ok_or(ViseError::MathOverflow)?;

    let pool = &ctx.accounts.pool;
    emit!(PoolCreated {
        pool: pool_key,
        mint: pool.mint,
        creator: pool.creator,
        treasury_share_bps: pool.terms.treasury_share_bps,
        creator_share_bps: pool.terms.creator_share_bps,
        min_lock_secs: pool.terms.min_lock_secs,
        max_lock_secs: pool.terms.max_lock_secs,
        max_multiplier_bps: pool.terms.max_multiplier_bps,
        early_unlock_penalty_bps: pool.terms.early_unlock_penalty_bps,
        timestamp: now,
    });
    emit!(Locked {
        pool: pool_key,
        position: ctx.accounts.position.key(),
        owner: ctx.accounts.creator.key(),
        index: 0,
        amount: args.initial_lock_amount,
        weight: ctx.accounts.position.weight,
        multiplier_bps: ctx.accounts.position.multiplier_bps,
        lock_end: ctx.accounts.position.lock_end,
        total_locked: pool.total_locked,
        total_weight: pool.total_weight,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Sync<'info> {
    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: verified against the pool's recorded vault.
    #[account(
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ViseError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,
}

/// Permissionless crank. Anyone may fold newly arrived lamports into the
/// accumulator; it is also called inline by every other instruction.
pub fn sync(ctx: Context<Sync>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let lamports = ctx.accounts.reward_vault.lamports();
    let pool_key = ctx.accounts.pool.key();
    let pool = &mut ctx.accounts.pool;
    let result = pool.sync(lamports, now)?;
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
