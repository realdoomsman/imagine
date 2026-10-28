use crate::constants::*;
use crate::errors::ImagineError;
use crate::events::FeeDeposited;
use crate::quote_mint;
use crate::rewards::Rewards;
use crate::state::Pool;
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token_interface::{transfer_checked, TokenInterface, TransferChecked};

#[derive(Accounts)]
pub struct DepositReward<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.mint.as_ref()],
        bump = pool.bump,
        constraint = pool.founded @ ImagineError::NotFounded,
    )]
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
    /// CHECK: the payer's quote token account (any the payer may spend from);
    /// required unless the quote is WSOL. The token program enforces mint and
    /// authority.
    #[account(mut)]
    pub payer_quote_account: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

/// Push quote into a pool and fold it into the accumulator in the same
/// instruction: lamports for a WSOL-quoted pool, quote tokens (by
/// `transfer_checked` from `payer_quote_account`) otherwise.
///
/// This is the app-fee leg appended to every trade routed through the IMAGINE
/// front-end, but it is fully permissionless: anyone can top up any founded
/// pool, and StonkFun's forwarded creator share reaches the vault directly
/// without calling this at all — the balance-diff sync picks that up too.
///
/// `kind` is metadata for indexers: 0 buy fee, 1 sell fee, 2 creator share,
/// 3 donation.
pub fn deposit_reward(ctx: Context<DepositReward>, amount: u64, kind: u8) -> Result<()> {
    require!(amount > 0, ImagineError::AmountTooSmall);
    let a = ctx.accounts;
    let now = Clock::get()?.unix_timestamp;
    let pool_key = a.pool.key();

    let rewards = Rewards::new(
        &a.pool,
        a.reward_vault.to_account_info(),
        a.reward_token_account.as_ref().map(|x| x.to_account_info()),
        a.quote_mint.as_ref().map(|x| x.to_account_info()),
        a.quote_token_program.as_ref().map(|x| x.to_account_info()),
        Some(a.system_program.to_account_info()),
    )?;

    match (&a.reward_token_account, crate::rewards::is_native(&a.pool.quote_mint)) {
        (_, true) => transfer(
            CpiContext::new(
                a.system_program.to_account_info(),
                Transfer {
                    from: a.payer.to_account_info(),
                    to: a.reward_vault.to_account_info(),
                },
            ),
            amount,
        )?,
        (Some(vault_account), false) => {
            let mint = a.quote_mint.as_ref().ok_or(ImagineError::QuoteAccountMismatch)?;
            let program = a
                .quote_token_program
                .as_ref()
                .ok_or(ImagineError::QuoteAccountMismatch)?;
            let source = a
                .payer_quote_account
                .as_ref()
                .ok_or(ImagineError::QuoteAccountMismatch)?;
            let decimals = quote_mint::decimals(mint, &a.pool.quote_token_program)?;
            transfer_checked(
                CpiContext::new(
                    program.to_account_info(),
                    TransferChecked {
                        from: source.to_account_info(),
                        mint: mint.to_account_info(),
                        to: vault_account.to_account_info(),
                        authority: a.payer.to_account_info(),
                    },
                ),
                amount,
                decimals,
            )?;
        }
        (None, false) => return err!(ImagineError::QuoteAccountMismatch),
    }

    rewards.sync(&mut a.pool, pool_key, now)?;
    emit!(FeeDeposited {
        pool: pool_key,
        payer: a.payer.key(),
        amount,
        kind,
        timestamp: now,
    });
    Ok(())
}
