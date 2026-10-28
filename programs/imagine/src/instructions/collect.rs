use crate::constants::*;
use crate::errors::ImagineError;
use crate::launchlab::{cpmm_pool_pda, token_amount, CpmmPool, IX_CLAIM_CREATOR_FEE, IX_CPMM_COLLECT_CREATOR_FEE};
use crate::rewards::{is_native, Rewards};
use crate::state::Pool;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::{self, get_associated_token_address_with_program_id, AssociatedToken};
use anchor_spl::token_interface::{close_account, CloseAccount, TokenInterface};

/// Remaining accounts of `collect_creator_fee` once the coin has migrated to
/// CPMM, in this order. Omit them while the coin is still on its curve.
pub mod cpmm_collect_accounts {
    /// The canonical CPMM pool of (mint, quote) (writable).
    pub const POOL: usize = 0;
    /// CPMM `["vault_and_lp_mint_auth_seed"]`.
    pub const AUTHORITY: usize = 1;
    /// The pool's `amm_config`.
    pub const AMM_CONFIG: usize = 2;
    /// The pool's token-0 and token-1 vaults (writable).
    pub const TOKEN_0_VAULT: usize = 3;
    pub const TOKEN_1_VAULT: usize = 4;
    /// `ATA(reward_vault, mint)` under Token-2022 (writable); created here if
    /// missing. CPMM pays any coin-side creator fee into it.
    pub const VAULT_COIN_ACCOUNT: usize = 5;
    /// CPMM `["creator_fee_share", reward_vault, amm_config]`; may be
    /// uninitialized.
    pub const CREATOR_FEE_SHARE: usize = 6;
    /// The CPMM program.
    pub const PROGRAM: usize = 7;
    pub const LEN: usize = 8;
}

#[derive(Accounts)]
pub struct CollectCreatorFee<'info> {
    /// Permissionless crank. Funds any missing reward-vault token account and
    /// is refunded the rent of the transient WSOL account.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,

    /// The LaunchLab (and CPMM) creator of the coin; signs the claims.
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        address = pool.reward_vault @ ImagineError::TreasuryMismatch,
    )]
    pub reward_vault: SystemAccount<'info>,

    /// CHECK: `ATA(reward_vault, quote_mint, quote_token_program)`, checked in
    /// the handler: the pool's reward token account, or for a WSOL quote a
    /// transient WSOL account unwrapped into the vault's lamports.
    #[account(mut)]
    pub vault_quote_account: UncheckedAccount<'info>,

    /// CHECK: the coin; pinned to the pool.
    #[account(address = pool.mint)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: the quote; pinned to the pool.
    #[account(address = pool.quote_mint)]
    pub quote_mint: UncheckedAccount<'info>,
    #[account(address = pool.quote_token_program @ ImagineError::QuoteAccountMismatch)]
    pub quote_token_program: Interface<'info, TokenInterface>,

    /// CHECK: LaunchLab `[reward_vault, quote_mint]`, the vault's creator-fee
    /// vault; LaunchLab validates it. Skipped while empty or not yet created.
    #[account(mut)]
    pub creator_fee_vault: UncheckedAccount<'info>,
    /// CHECK: LaunchLab `["creator_fee_vault_auth_seed"]`; LaunchLab validates it.
    pub creator_fee_vault_authority: UncheckedAccount<'info>,
    /// CHECK: the LaunchLab program.
    #[account(address = LAUNCHLAB_PROGRAM_ID @ ImagineError::InvalidLaunchLabAccount)]
    pub launchlab_program: UncheckedAccount<'info>,

    #[account(address = pool.token_program @ ImagineError::VaultAccountingMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Pull the coin's on-chain creator fees into its pool and sync them.
///
/// The pool's reward vault PDA is the coin's creator on LaunchLab (and on CPMM
/// after migration), so the IMAGINE platform's creator fee on every trade
/// accrues to it. Permissionless: anyone may crank it, and every unit lands in
/// the pool's reward balance, where `sync` splits it like any other inflow.
///
/// 1. LaunchLab `claim_creator_fee` empties the vault's creator-fee vault into
///    `vault_quote_account` (skipped while it is empty).
/// 2. With `cpmm_collect_accounts`, CPMM `collect_creator_fee` collects the
///    migrated pool's creator fees (skipped while none are due).
/// 3. For a WSOL quote, the WSOL account is closed into the vault, so the
///    lamports join the native reward balance; its rent goes back to `payer`.
pub fn collect_creator_fee<'info>(
    ctx: Context<'_, '_, 'info, 'info, CollectCreatorFee<'info>>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let pool_key = a.pool.key();
    let vault = a.reward_vault.to_account_info();
    let vault_key = vault.key();
    let quote_key = a.quote_mint.key();
    let quote_program = a.quote_token_program.to_account_info();
    let quote_account = a.vault_quote_account.to_account_info();
    require_keys_eq!(
        quote_account.key(),
        get_associated_token_address_with_program_id(&vault_key, &quote_key, &quote_program.key()),
        ImagineError::QuoteAccountMismatch
    );
    let bump = [a.pool.vault_bump];
    let seeds: [&[u8]; 3] = [VAULT_SEED, pool_key.as_ref(), &bump];
    let create_ata = |account: &AccountInfo<'info>, mint: AccountInfo<'info>, program: AccountInfo<'info>| {
        if !account.data_is_empty() {
            return Ok(());
        }
        associated_token::create_idempotent(CpiContext::new(
            a.associated_token_program.to_account_info(),
            associated_token::Create {
                payer: a.payer.to_account_info(),
                associated_token: account.clone(),
                authority: vault.clone(),
                mint,
                system_program: a.system_program.to_account_info(),
                token_program: program,
            },
        ))
    };
    create_ata(&quote_account, a.quote_mint.to_account_info(), quote_program.clone())?;

    let fee_vault = a.creator_fee_vault.to_account_info();
    if fee_vault.owner == quote_program.key && token_amount(&fee_vault)? > 0 {
        invoke_signed(
            &Instruction {
                program_id: LAUNCHLAB_PROGRAM_ID,
                accounts: vec![
                    AccountMeta::new(vault_key, true),
                    AccountMeta::new_readonly(a.creator_fee_vault_authority.key(), false),
                    AccountMeta::new(fee_vault.key(), false),
                    AccountMeta::new(quote_account.key(), false),
                    AccountMeta::new_readonly(quote_key, false),
                    AccountMeta::new_readonly(quote_program.key(), false),
                    AccountMeta::new_readonly(a.system_program.key(), false),
                    AccountMeta::new_readonly(a.associated_token_program.key(), false),
                ],
                data: IX_CLAIM_CREATOR_FEE.to_vec(),
            },
            &[
                vault.clone(),
                a.creator_fee_vault_authority.to_account_info(),
                fee_vault,
                quote_account.clone(),
                a.quote_mint.to_account_info(),
                quote_program.clone(),
                a.system_program.to_account_info(),
                a.associated_token_program.to_account_info(),
                a.launchlab_program.to_account_info(),
            ],
            &[&seeds],
        )?;
    }

    let r = ctx.remaining_accounts;
    if r.len() >= cpmm_collect_accounts::LEN {
        use cpmm_collect_accounts as c;
        require_keys_eq!(r[c::PROGRAM].key(), CPMM_PROGRAM_ID, ImagineError::InvalidLaunchLabAccount);
        let cpmm = CpmmPool::load(&r[c::POOL])?;
        let mint_key = a.mint.key();
        require!(
            r[c::POOL].key() == cpmm_pool_pda(&cpmm.amm_config, &mint_key, &quote_key)
                && r[c::AMM_CONFIG].key() == cpmm.amm_config
                && cpmm.pool_creator == vault_key,
            ImagineError::InvalidLaunchLabAccount
        );
        let coin_account = &r[c::VAULT_COIN_ACCOUNT];
        let coin_program = a.token_program.to_account_info();
        require_keys_eq!(
            coin_account.key(),
            get_associated_token_address_with_program_id(&vault_key, &mint_key, coin_program.key),
            ImagineError::InvalidLaunchLabAccount
        );
        if cpmm.creator_fees > 0 {
            create_ata(coin_account, a.mint.to_account_info(), coin_program.clone())?;
            let coin = (a.mint.to_account_info(), coin_account.clone(), coin_program);
            let quote = (a.quote_mint.to_account_info(), quote_account.clone(), quote_program.clone());
            let (t0, t1) = if cpmm.token_0_mint == mint_key { (coin, quote) } else { (quote, coin) };
            invoke_signed(
                &Instruction {
                    program_id: CPMM_PROGRAM_ID,
                    accounts: vec![
                        AccountMeta::new(vault_key, true),
                        AccountMeta::new_readonly(r[c::AUTHORITY].key(), false),
                        AccountMeta::new(r[c::POOL].key(), false),
                        AccountMeta::new_readonly(r[c::AMM_CONFIG].key(), false),
                        AccountMeta::new(r[c::TOKEN_0_VAULT].key(), false),
                        AccountMeta::new(r[c::TOKEN_1_VAULT].key(), false),
                        AccountMeta::new_readonly(t0.0.key(), false),
                        AccountMeta::new_readonly(t1.0.key(), false),
                        AccountMeta::new(t0.1.key(), false),
                        AccountMeta::new(t1.1.key(), false),
                        AccountMeta::new_readonly(t0.2.key(), false),
                        AccountMeta::new_readonly(t1.2.key(), false),
                        AccountMeta::new_readonly(a.associated_token_program.key(), false),
                        AccountMeta::new_readonly(a.system_program.key(), false),
                        AccountMeta::new_readonly(r[c::CREATOR_FEE_SHARE].key(), false),
                    ],
                    data: IX_CPMM_COLLECT_CREATOR_FEE.to_vec(),
                },
                &[
                    vault.clone(),
                    r[c::AUTHORITY].clone(),
                    r[c::POOL].clone(),
                    r[c::AMM_CONFIG].clone(),
                    r[c::TOKEN_0_VAULT].clone(),
                    r[c::TOKEN_1_VAULT].clone(),
                    t0.0,
                    t1.0,
                    t0.1,
                    t1.1,
                    t0.2,
                    t1.2,
                    a.associated_token_program.to_account_info(),
                    a.system_program.to_account_info(),
                    r[c::CREATOR_FEE_SHARE].clone(),
                    r[c::PROGRAM].clone(),
                ],
                &[&seeds],
            )?;
        }
    }

    if is_native(&quote_key) {
        // Unwrap: the whole WSOL account (rent + balance) lands on the vault,
        // then the rent goes back to whoever funded it.
        let rent = quote_account.lamports().saturating_sub(token_amount(&quote_account)?);
        close_account(CpiContext::new_with_signer(
            quote_program,
            CloseAccount {
                account: quote_account.clone(),
                destination: vault.clone(),
                authority: vault.clone(),
            },
            &[&seeds],
        ))?;
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                a.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: vault.clone(),
                    to: a.payer.to_account_info(),
                },
                &[&seeds],
            ),
            rent,
        )?;
    }

    let rewards = Rewards::new(&a.pool, vault, Some(quote_account), None, None, None)?;
    rewards.sync(&mut ctx.accounts.pool, pool_key, now)?;
    Ok(())
}
