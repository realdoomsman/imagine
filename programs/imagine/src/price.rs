//! The quote value of a coin, read from the venue it trades on.
//!
//! Each lock's earnings are capped at the quote value of its tokens when
//! locked, times its multiplier. That value comes from the same place the coin
//! trades: the LaunchLab curve's virtual + real reserves while it is live, and
//! the canonical CPMM pool's two vaults once it has migrated. Every account is
//! verified by owner, discriminator and address before a byte of it is trusted.
//!
//! The price is spot, so it can be moved within a transaction. Moving it only
//! changes where a lock's ceiling sits; a lock still earns its weight's share
//! of fees and nothing more, so the most a manipulator gains is avoiding the
//! ceiling, at the cost of the round trip through the venue's fees.

use crate::errors::ImagineError;
use crate::launchlab::{cpmm_pool_pda, token_amount, CpmmPool, PoolState, POOL_MIGRATED};
use crate::state::Pool;
use anchor_lang::prelude::*;

/// Remaining accounts of a lock on a migrated coin, in this order.
pub mod valuation_accounts {
    /// The canonical CPMM `PoolState` of (mint, quote).
    pub const CPMM_POOL: usize = 0;
    /// Its vault of the coin.
    pub const BASE_VAULT: usize = 1;
    /// Its vault of the quote.
    pub const QUOTE_VAULT: usize = 2;
    pub const LEN: usize = 3;
}

fn scale(amount: u64, quote: u64, base: u64) -> Result<u64> {
    require!(base > 0 && quote > 0, ImagineError::PriceUnavailable);
    let value = (amount as u128)
        .checked_mul(quote as u128)
        .ok_or(ImagineError::MathOverflow)?
        / base as u128;
    u64::try_from(value).map_err(|_| error!(ImagineError::MathOverflow))
}

/// Quote base units `amount` base units of the pool's coin are worth now.
///
/// `launchlab_pool` must already be pinned to `pool.launchlab_pool` by the
/// caller's account constraints. Once the curve has migrated, `remaining`
/// must hold `valuation_accounts`.
pub fn coin_value(
    pool: &Pool,
    amount: u64,
    launchlab_pool: &AccountInfo,
    remaining: &[AccountInfo],
) -> Result<u64> {
    require_keys_eq!(
        launchlab_pool.key(),
        pool.launchlab_pool,
        ImagineError::InvalidLaunchLabAccount
    );
    let state = PoolState::load(launchlab_pool)?;
    if state.status != POOL_MIGRATED {
        let (quote, base) = state.reserves()?;
        return scale(amount, quote, base);
    }

    // Migrated: the curve's reserves are frozen, so price off the CPMM pool the
    // coin actually trades in.
    require!(
        remaining.len() >= valuation_accounts::LEN,
        ImagineError::PriceUnavailable
    );
    let cpmm_info = &remaining[valuation_accounts::CPMM_POOL];
    let cpmm = CpmmPool::load(cpmm_info)?;
    require_keys_eq!(
        cpmm_info.key(),
        cpmm_pool_pda(&cpmm.amm_config, &pool.mint, &pool.quote_mint),
        ImagineError::PriceUnavailable
    );
    let (base_vault, base_fees) = cpmm.side(&pool.mint)?;
    let (quote_vault, quote_fees) = cpmm.side(&pool.quote_mint)?;
    let base_info = &remaining[valuation_accounts::BASE_VAULT];
    let quote_info = &remaining[valuation_accounts::QUOTE_VAULT];
    require_keys_eq!(base_info.key(), base_vault, ImagineError::PriceUnavailable);
    require_keys_eq!(quote_info.key(), quote_vault, ImagineError::PriceUnavailable);
    require_keys_eq!(*base_info.owner, pool.token_program, ImagineError::PriceUnavailable);
    require_keys_eq!(
        *quote_info.owner,
        pool.quote_token_program,
        ImagineError::PriceUnavailable
    );
    let base = token_amount(base_info)?.saturating_sub(base_fees);
    let quote = token_amount(quote_info)?.saturating_sub(quote_fees);
    scale(amount, quote, base)
}
