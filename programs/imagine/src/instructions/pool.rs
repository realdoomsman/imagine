use crate::constants::*;
use crate::errors::ImagineError;
use crate::events::{Locked, PoolCreated, PoolLaunched};
use crate::instructions::lock::open_position;
use crate::launchlab::{self, PlatformConfig, PoolState};
use crate::mint_guard::assert_custody_safe;
use crate::price::coin_value;
use crate::quote_mint;
use crate::rewards::{is_native, Rewards};
use crate::state::{Config, Pool, PoolTerms, Position};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::{self, get_associated_token_address_with_program_id, AssociatedToken};
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Index of the creator's mandatory founding lock.
pub const FIRST_POSITION_INDEX: [u8; 4] = 0u32.to_le_bytes();

/// Remaining accounts of `launch`, in this order, read-only, needed only when
/// the configured platform restricts global configs or curve params: they are
/// then pinned here and forwarded to LaunchLab's `initialize`, which validates
/// them. Ignored otherwise (IMAGINE's own platform restricts nothing).
pub mod launch_accounts {
    /// `platform_allow_config_pda(config.launchlab_platform, global_config)`;
    /// may not exist.
    pub const ALLOW_CONFIG: usize = 0;
    /// `platform_curve_rule_pda(config.launchlab_platform, global_config)`;
    /// may not exist.
    pub const CURVE_RULE: usize = 1;
    pub const LEN: usize = 2;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LaunchArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    /// Curve shape; LaunchLab validates the combination against the quote's
    /// GlobalConfig (and the platform's curve rule, if it has one).
    pub supply: u64,
    pub total_sell: u64,
    pub fund_raising: u64,
    /// Slice of post-treasury inflow routed to the creator, forever.
    pub creator_share_bps: u16,
}

#[derive(Accounts)]
pub struct Launch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: pinned to the configured treasury; receives the creation fee only.
    #[account(mut, address = config.treasury @ ImagineError::TreasuryMismatch)]
    pub treasury: UncheckedAccount<'info>,

    /// The new coin. LaunchLab creates it (Token-2022, metadata in the mint,
    /// whole supply minted to the curve, mint authority revoked).
    #[account(mut)]
    pub mint: Signer<'info>,

    /// CHECK: the coin's quote; owner pinned to `quote_token_program` and its
    /// extensions checked in the handler, pinned to the curve by LaunchLab.
    pub quote_mint: UncheckedAccount<'info>,
    pub quote_token_program: Interface<'info, TokenInterface>,

    #[account(
        init,
        payer = creator,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// System-owned PDA: holds SOL rewards and is the LaunchLab pool's creator.
    #[account(mut, seeds = [VAULT_SEED, pool.key().as_ref()], bump)]
    pub reward_vault: SystemAccount<'info>,

    /// CHECK: `ATA(reward_vault, quote_mint, quote_token_program)`, created
    /// here; required unless the quote is WSOL.
    #[account(mut)]
    pub reward_token_account: Option<UncheckedAccount<'info>>,

    /// CHECK: the quote's LaunchLab GlobalConfig; LaunchLab validates it.
    pub global_config: UncheckedAccount<'info>,
    /// CHECK: IMAGINE's LaunchLab PlatformConfig, pinned to the config.
    #[account(address = config.launchlab_platform @ ImagineError::PlatformMismatch)]
    pub launchlab_platform: UncheckedAccount<'info>,
    /// CHECK: LaunchLab `["vault_auth_seed"]`; LaunchLab validates it.
    pub launchlab_authority: UncheckedAccount<'info>,
    /// CHECK: LaunchLab `["pool", mint, quote_mint]`; LaunchLab creates it and
    /// the handler reads it back.
    #[account(mut)]
    pub launchlab_pool: UncheckedAccount<'info>,
    /// CHECK: LaunchLab `["pool_vault", pool, mint]`; LaunchLab creates it.
    #[account(mut)]
    pub launchlab_base_vault: UncheckedAccount<'info>,
    /// CHECK: LaunchLab `["pool_vault", pool, quote_mint]`; LaunchLab creates it.
    #[account(mut)]
    pub launchlab_quote_vault: UncheckedAccount<'info>,
    /// CHECK: LaunchLab `["__event_authority"]`; LaunchLab validates it.
    pub launchlab_event_authority: UncheckedAccount<'info>,
    /// CHECK: the LaunchLab program.
    #[account(address = LAUNCHLAB_PROGRAM_ID @ ImagineError::InvalidLaunchLabAccount)]
    pub launchlab_program: UncheckedAccount<'info>,

    /// Token-2022: every LaunchLab coin here is a Token-2022 mint.
    #[account(address = anchor_spl::token_2022::ID @ ImagineError::InvalidLaunchLabAccount)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Create the coin on Raydium LaunchLab under the IMAGINE platform, and its
/// pool here, in one instruction.
///
/// The pool's terms are frozen from the config. Its reward vault PDA is made
/// the LaunchLab pool's creator, so the platform's on-chain creator fee on
/// every curve trade (and the CPMM creator fee after migration) accrues to the
/// pool, collected by `collect_creator_fee`. LaunchLab's
/// `initialize_with_token_2022` runs with the creator as payer and the mint
/// keypair as signer (both propagate), under `config.launchlab_platform`, and
/// is read back to prove it is exactly that pool. The client buys the dev bag
/// on LaunchLab and calls `found` in the same transaction.
pub fn launch<'info>(
    ctx: Context<'_, '_, 'info, 'info, Launch<'info>>,
    args: LaunchArgs,
) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, ImagineError::Paused);
    require!(
        args.creator_share_bps <= config.max_creator_share_bps,
        ImagineError::InvalidParameter
    );

    let quote_key = ctx.accounts.quote_mint.key();
    let quote_program_key = ctx.accounts.quote_token_program.key();
    quote_mint::decimals(&ctx.accounts.quote_mint, &quote_program_key)?;
    quote_mint::require_plain_transfers(&ctx.accounts.quote_mint)?;

    let platform_key = config.launchlab_platform;
    let global_config_key = ctx.accounts.global_config.key();
    let platform = PlatformConfig::load(&ctx.accounts.launchlab_platform)?;
    let r = ctx.remaining_accounts;
    if platform.restricted() {
        require!(r.len() >= launch_accounts::LEN, ImagineError::InvalidLaunchLabAccount);
        require_keys_eq!(
            r[launch_accounts::ALLOW_CONFIG].key(),
            launchlab::platform_allow_config_pda(&platform_key, &global_config_key),
            ImagineError::InvalidLaunchLabAccount
        );
        require_keys_eq!(
            r[launch_accounts::CURVE_RULE].key(),
            launchlab::platform_curve_rule_pda(&platform_key, &global_config_key),
            ImagineError::InvalidLaunchLabAccount
        );
    }

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
    let pool_creation_fee = config.pool_creation_fee;
    let treasury = config.treasury;

    let pool_key = ctx.accounts.pool.key();
    let vault_key = ctx.accounts.reward_vault.key();
    let native = is_native(&quote_key);
    let reward_token_account = if native {
        Pubkey::default()
    } else {
        get_associated_token_address_with_program_id(&vault_key, &quote_key, &quote_program_key)
    };
    // Over-fund the rent floor: the reserve is snapshotted here for the life of
    // the pool, and a future rise in the rent minimum would otherwise make the
    // last payout fail until somebody donated lamports.
    let vault_reserve = Rent::get()?.minimum_balance(0).saturating_mul(2);

    {
        let pool = &mut ctx.accounts.pool;
        pool.mint = ctx.accounts.mint.key();
        pool.creator = ctx.accounts.creator.key();
        pool.treasury = treasury;
        pool.reward_vault = vault_key;
        pool.token_program = ctx.accounts.token_program.key();
        pool.quote_mint = quote_key;
        pool.quote_token_program = quote_program_key;
        pool.reward_token_account = reward_token_account;
        pool.launchlab_pool = ctx.accounts.launchlab_pool.key();
        pool.terms = terms;
        pool.vault_reserve = vault_reserve;
        pool.created_at = now;
        pool.bump = ctx.bumps.pool;
        pool.vault_bump = ctx.bumps.reward_vault;
    }

    // The reward vault's rent floor, so it exists as a system account and
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

    if pool_creation_fee > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            pool_creation_fee,
        )?;
    }

    if !native {
        let account = ctx
            .accounts
            .reward_token_account
            .as_ref()
            .ok_or(ImagineError::QuoteAccountMismatch)?;
        require_keys_eq!(account.key(), reward_token_account, ImagineError::QuoteAccountMismatch);
        associated_token::create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            associated_token::Create {
                payer: ctx.accounts.creator.to_account_info(),
                associated_token: account.to_account_info(),
                authority: ctx.accounts.reward_vault.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.quote_token_program.to_account_info(),
            },
        ))?;
    }

    let a = &ctx.accounts;
    let mut accounts = vec![
        AccountMeta::new(a.creator.key(), true),
        AccountMeta::new_readonly(vault_key, false),
        AccountMeta::new_readonly(global_config_key, false),
        AccountMeta::new_readonly(platform_key, false),
        AccountMeta::new_readonly(a.launchlab_authority.key(), false),
        AccountMeta::new(a.launchlab_pool.key(), false),
        AccountMeta::new(a.mint.key(), true),
        AccountMeta::new_readonly(quote_key, false),
        AccountMeta::new(a.launchlab_base_vault.key(), false),
        AccountMeta::new(a.launchlab_quote_vault.key(), false),
        AccountMeta::new_readonly(a.token_program.key(), false),
        AccountMeta::new_readonly(quote_program_key, false),
        AccountMeta::new_readonly(a.system_program.key(), false),
        AccountMeta::new_readonly(a.launchlab_event_authority.key(), false),
        AccountMeta::new_readonly(LAUNCHLAB_PROGRAM_ID, false),
    ];
    let mut infos = vec![
        a.creator.to_account_info(),
        a.reward_vault.to_account_info(),
        a.global_config.to_account_info(),
        a.launchlab_platform.to_account_info(),
        a.launchlab_authority.to_account_info(),
        a.launchlab_pool.to_account_info(),
        a.mint.to_account_info(),
        a.quote_mint.to_account_info(),
        a.launchlab_base_vault.to_account_info(),
        a.launchlab_quote_vault.to_account_info(),
        a.token_program.to_account_info(),
        a.quote_token_program.to_account_info(),
        a.system_program.to_account_info(),
        a.launchlab_event_authority.to_account_info(),
        a.launchlab_program.to_account_info(),
    ];
    if platform.restricted() {
        for info in &r[..launch_accounts::LEN] {
            accounts.push(AccountMeta::new_readonly(info.key(), false));
            infos.push(info.clone());
        }
    }
    invoke(
        &Instruction {
            program_id: LAUNCHLAB_PROGRAM_ID,
            accounts,
            data: launchlab::initialize_with_token_2022_data(
                COIN_DECIMALS,
                &args.name,
                &args.symbol,
                &args.uri,
                args.supply,
                args.total_sell,
                args.fund_raising,
            ),
        },
        &infos,
    )?;

    let state = PoolState::load(&a.launchlab_pool)?;
    require!(
        state.base_mint == a.mint.key()
            && state.quote_mint == quote_key
            && state.creator == vault_key
            && state.platform_config == platform_key,
        ImagineError::InvalidLaunchLabAccount
    );

    emit!(PoolLaunched {
        pool: pool_key,
        mint: a.mint.key(),
        quote_mint: quote_key,
        creator: a.creator.key(),
        launchlab_pool: a.launchlab_pool.key(),
        reward_vault: vault_key,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Found<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.mint.as_ref()],
        bump = pool.bump,
        has_one = creator @ ImagineError::NotPoolCreator,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(address = pool.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        seeds = [TOKEN_VAULT_SEED, pool.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: the coin's LaunchLab pool, pinned to the pool and read for the
    /// founding lock's value (owner and discriminator verified there).
    #[account(address = pool.launchlab_pool @ ImagineError::InvalidLaunchLabAccount)]
    pub launchlab_pool: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, pool.key().as_ref(), creator.key().as_ref(), &FIRST_POSITION_INDEX],
        bump
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        constraint = creator_token_account.mint == mint.key(),
        constraint = creator_token_account.owner == creator.key(),
    )]
    pub creator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = pool.token_program @ ImagineError::VaultAccountingMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Open the pool with the creator's founding lock.
///
/// Required, once, by the creator: it guarantees the pool has weight from its
/// first slot, so no later locker can scoop an accumulated remainder, and it
/// puts the creator's own coins at risk first. One-shot by construction: it
/// creates the pool's token vault, which can only be created once. Remaining
/// accounts, only for a
/// coin that has already migrated: `price::valuation_accounts`.
pub fn found<'info>(
    ctx: Context<'_, '_, 'info, 'info, Found<'info>>,
    initial_lock_amount: u64,
    initial_lock_duration: u32,
) -> Result<()> {
    assert_custody_safe(&ctx.accounts.mint, &ctx.accounts.mint.to_account_info())?;
    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool.key();

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
        initial_lock_amount,
        ctx.accounts.mint.decimals,
    )?;

    let value = coin_value(
        &ctx.accounts.pool,
        initial_lock_amount,
        &ctx.accounts.launchlab_pool.to_account_info(),
        ctx.remaining_accounts,
    )?;
    let pool = &mut ctx.accounts.pool;
    pool.token_vault = ctx.accounts.token_vault.key();
    pool.founded = true;
    open_position(
        pool,
        &mut ctx.accounts.position,
        ctx.accounts.creator.key(),
        pool_key,
        0,
        ctx.bumps.position,
        initial_lock_amount,
        initial_lock_duration,
        ctx.accounts.mint.supply,
        value,
        now,
    )?;

    ctx.accounts.config.pool_count = ctx
        .accounts
        .config
        .pool_count
        .checked_add(1)
        .ok_or(ImagineError::MathOverflow)?;

    let pool = &ctx.accounts.pool;
    emit!(PoolCreated {
        pool: pool_key,
        mint: pool.mint,
        quote_mint: pool.quote_mint,
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
        amount: initial_lock_amount,
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
    #[account(
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ImagineError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,
    /// CHECK: `pool.reward_token_account`; required unless the quote is WSOL.
    pub reward_token_account: Option<UncheckedAccount<'info>>,
}

/// Permissionless crank. Anyone may fold newly arrived quote into the
/// accumulator, creator fees collected into the vault included; it is also called
/// inline by every other instruction. A no-op before the pool is founded.
pub fn sync(ctx: Context<Sync>) -> Result<()> {
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
    Ok(())
}
