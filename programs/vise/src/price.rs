//! The SOL value of a coin, read from pump.fun's own accounts.
//!
//! A capped pool limits each lock's earnings to the SOL value of its tokens
//! when locked, times its multiplier. That value comes from the same place the
//! coin trades: the bonding curve's virtual reserves while it is live, and the
//! canonical pump AMM pool's two vaults once it has graduated. Every account
//! is verified by owner and address before a byte of it is trusted.
//!
//! The price is spot, so it can be moved within a transaction. Moving it only
//! changes where a lock's ceiling sits; a lock still earns its weight's share
//! of fees and nothing more, so the most a manipulator gains is avoiding the
//! ceiling, at the cost of the round trip through pump's fees and slippage.

use crate::constants::*;
use crate::errors::ViseError;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;

/// Byte offsets inside pump's `BondingCurve` (after the 8-byte discriminator).
const CURVE_VIRTUAL_TOKEN_RESERVES: usize = 8;
const CURVE_VIRTUAL_SOL_RESERVES: usize = 16;
const CURVE_COMPLETE: usize = 8 + 5 * 8;

/// `amount` of an SPL / Token-2022 account: the base layout is shared.
const TOKEN_ACCOUNT_AMOUNT: usize = 64;

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let bytes: [u8; 8] = data
        .get(offset..offset + 8)
        .and_then(|slice| slice.try_into().ok())
        .ok_or(ViseError::PriceUnavailable)?;
    Ok(u64::from_le_bytes(bytes))
}

fn scale(amount: u64, quote: u64, base: u64) -> Result<u64> {
    require!(base > 0 && quote > 0, ViseError::PriceUnavailable);
    let value = (amount as u128)
        .checked_mul(quote as u128)
        .ok_or(ViseError::MathOverflow)?
        / base as u128;
    u64::try_from(value).map_err(|_| error!(ViseError::MathOverflow))
}

/// Lamports `amount` base units of `mint` are worth right now.
///
/// `bonding_curve` must already be pinned to the mint's curve PDA by the
/// caller's account constraints. Once the curve is complete, `amm_vaults` must
/// hold the canonical pump AMM pool's base and quote vaults, in that order.
pub fn coin_value_lamports(
    mint: &Pubkey,
    token_program: &Pubkey,
    amount: u64,
    bonding_curve: &AccountInfo,
    amm_vaults: &[AccountInfo],
) -> Result<u64> {
    require_keys_eq!(
        *bonding_curve.owner,
        PUMP_PROGRAM_ID,
        ViseError::InvalidBondingCurve
    );
    let (complete, virtual_tokens, virtual_sol) = {
        let data = bonding_curve.try_borrow_data()?;
        (
            *data.get(CURVE_COMPLETE).ok_or(ViseError::InvalidBondingCurve)? != 0,
            read_u64(&data, CURVE_VIRTUAL_TOKEN_RESERVES)?,
            read_u64(&data, CURVE_VIRTUAL_SOL_RESERVES)?,
        )
    };
    if !complete {
        return scale(amount, virtual_sol, virtual_tokens);
    }

    // Graduated: the curve's reserves are frozen at migration, so price off
    // the AMM pool the coin actually trades in.
    require!(amm_vaults.len() >= 2, ViseError::PriceUnavailable);
    let (authority, _) =
        Pubkey::find_program_address(&[b"pool-authority", mint.as_ref()], &PUMP_PROGRAM_ID);
    let (pool, _) = Pubkey::find_program_address(
        &[
            b"pool",
            &0u16.to_le_bytes(),
            authority.as_ref(),
            mint.as_ref(),
            WSOL_MINT.as_ref(),
        ],
        &PUMP_AMM_PROGRAM_ID,
    );
    let base_vault = &amm_vaults[0];
    let quote_vault = &amm_vaults[1];
    require_keys_eq!(
        base_vault.key(),
        get_associated_token_address_with_program_id(&pool, mint, token_program),
        ViseError::PriceUnavailable
    );
    require_keys_eq!(
        quote_vault.key(),
        get_associated_token_address_with_program_id(&pool, &WSOL_MINT, &SPL_TOKEN_PROGRAM_ID),
        ViseError::PriceUnavailable
    );
    require_keys_eq!(*base_vault.owner, *token_program, ViseError::PriceUnavailable);
    require_keys_eq!(*quote_vault.owner, SPL_TOKEN_PROGRAM_ID, ViseError::PriceUnavailable);
    let base = read_u64(&base_vault.try_borrow_data()?, TOKEN_ACCOUNT_AMOUNT)?;
    let quote = read_u64(&quote_vault.try_borrow_data()?, TOKEN_ACCOUNT_AMOUNT)?;
    scale(amount, quote, base)
}
