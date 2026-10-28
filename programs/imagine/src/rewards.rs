//! Where a pool's rewards sit and how they leave.
//!
//! A WSOL-quoted pool holds rewards as native lamports on its `reward_vault`
//! PDA, above the rent `vault_reserve`; StonkFun's forwarded SOL creator share
//! is a plain transfer to that address. Any other quote is held in
//! `reward_token_account`, the vault PDA's associated token account, which is
//! where StonkFun's forwarded quote-token share lands. Every instruction reads
//! the distributable balance through `Rewards::balance` and pays through
//! `Rewards::pay`, so the two paths cannot drift apart.

use crate::constants::*;
use crate::errors::ImagineError;
use crate::events::RewardsSynced;
use crate::launchlab::token_amount;
use crate::quote_mint;
use crate::state::{Pool, SyncResult};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{transfer_checked, TransferChecked};

/// Is `quote_mint` paid as native lamports?
pub fn is_native(quote_mint: &Pubkey) -> bool {
    *quote_mint == WSOL_MINT
}

/// The reward accounts an instruction was handed, checked against the pool.
pub struct Rewards<'info> {
    vault: AccountInfo<'info>,
    token: Option<TokenRewards<'info>>,
    system_program: Option<AccountInfo<'info>>,
}

struct TokenRewards<'info> {
    account: AccountInfo<'info>,
    mint: Option<AccountInfo<'info>>,
    program: Option<AccountInfo<'info>>,
}

impl<'info> Rewards<'info> {
    /// `reward_vault` must already be pinned to `pool.reward_vault` by the
    /// caller's constraints. For a token quote `token_account` is required and
    /// must be `pool.reward_token_account`; `quote_mint` and
    /// `quote_token_program` are needed only to pay out, and are checked
    /// against the pool when passed. For a WSOL quote the token accounts are
    /// ignored.
    pub fn new(
        pool: &Pool,
        vault: AccountInfo<'info>,
        token_account: Option<AccountInfo<'info>>,
        quote_mint: Option<AccountInfo<'info>>,
        quote_token_program: Option<AccountInfo<'info>>,
        system_program: Option<AccountInfo<'info>>,
    ) -> Result<Self> {
        if is_native(&pool.quote_mint) {
            return Ok(Self { vault, token: None, system_program });
        }
        let account = token_account.ok_or(ImagineError::QuoteAccountMismatch)?;
        require_keys_eq!(
            account.key(),
            pool.reward_token_account,
            ImagineError::QuoteAccountMismatch
        );
        require_keys_eq!(
            *account.owner,
            pool.quote_token_program,
            ImagineError::QuoteAccountMismatch
        );
        if let Some(mint) = &quote_mint {
            require_keys_eq!(mint.key(), pool.quote_mint, ImagineError::QuoteAccountMismatch);
        }
        if let Some(program) = &quote_token_program {
            require_keys_eq!(
                program.key(),
                pool.quote_token_program,
                ImagineError::QuoteAccountMismatch
            );
        }
        Ok(Self {
            vault,
            token: Some(TokenRewards { account, mint: quote_mint, program: quote_token_program }),
            system_program,
        })
    }

    /// Quote that is the pool's to account for: vault lamports above the rent
    /// reserve, or the reward token account's balance.
    pub fn balance(&self, pool: &Pool) -> Result<u64> {
        match &self.token {
            None => Ok(self.vault.lamports().saturating_sub(pool.vault_reserve)),
            Some(t) => token_amount(&t.account),
        }
    }

    /// Fold arrivals into the accumulator and emit what happened.
    pub fn sync(&self, pool: &mut Pool, pool_key: Pubkey, now: i64) -> Result<SyncResult> {
        let balance = self.balance(pool)?;
        let result = pool.sync(balance, now)?;
        emit_sync(pool, pool_key, result, now);
        Ok(result)
    }

    /// Pay `amount` to `recipient`: lamports straight to it, or quote tokens to
    /// `destination`, which must be the recipient's canonical associated
    /// token account for the quote (a caller that cannot be sure it exists
    /// prepends an idempotent create). Keeps `last_vault_balance` exact.
    pub fn pay(
        &self,
        pool: &mut Pool,
        pool_key: Pubkey,
        recipient: &AccountInfo<'info>,
        destination: Option<&AccountInfo<'info>>,
        amount: u64,
    ) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        let bump = [pool.vault_bump];
        let seeds: [&[u8]; 3] = [VAULT_SEED, pool_key.as_ref(), &bump];
        let signer: &[&[&[u8]]] = &[&seeds];
        match &self.token {
            None => {
                let system_program = self
                    .system_program
                    .clone()
                    .ok_or(ImagineError::QuoteAccountMismatch)?;
                anchor_lang::system_program::transfer(
                    CpiContext::new_with_signer(
                        system_program,
                        anchor_lang::system_program::Transfer {
                            from: self.vault.clone(),
                            to: recipient.clone(),
                        },
                        signer,
                    ),
                    amount,
                )?;
            }
            Some(t) => {
                let mint = t.mint.as_ref().ok_or(ImagineError::QuoteAccountMismatch)?;
                let program = t.program.as_ref().ok_or(ImagineError::QuoteAccountMismatch)?;
                let destination = destination.ok_or(ImagineError::QuoteAccountMismatch)?;
                require_keys_eq!(
                    destination.key(),
                    get_associated_token_address_with_program_id(
                        &recipient.key(),
                        &pool.quote_mint,
                        &pool.quote_token_program,
                    ),
                    ImagineError::QuoteAccountMismatch
                );
                let decimals = quote_mint::decimals(mint, &pool.quote_token_program)?;
                transfer_checked(
                    CpiContext::new_with_signer(
                        program.clone(),
                        TransferChecked {
                            from: t.account.clone(),
                            mint: mint.clone(),
                            to: destination.clone(),
                            authority: self.vault.clone(),
                        },
                        signer,
                    ),
                    amount,
                    decimals,
                )?;
            }
        }
        pool.debit(amount)
    }
}

pub fn emit_sync(pool: &Pool, pool_key: Pubkey, result: SyncResult, now: i64) {
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
