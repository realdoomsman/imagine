//! Token-2022 extension checks on a quote mint. The TLV entries are scanned by
//! raw type number instead of through `spl-token-2022`'s typed lookup: the
//! version anchor-spl 0.31 links predates the ScaledUiAmount and Pausable
//! extensions every xStock carries, and its typed lookup fails on the first
//! extension type it doesn't know.

use anchor_lang::prelude::*;

use crate::errors::ImagineError;

/// `spl_token_2022::extension::ExtensionType` numbers this program looks at.
const TRANSFER_FEE_CONFIG: u16 = 1;
const DEFAULT_ACCOUNT_STATE: u16 = 6;
const NON_TRANSFERABLE: u16 = 9;
const TRANSFER_HOOK: u16 = 14;

/// Base mint length; Token-2022 pads extended mints to the token-account
/// length, writes the account type at 165 and the TLV entries after it.
const MINT_LEN: usize = 82;
const TLV_START: usize = 166;
/// `decimals` and `is_initialized` in the base mint layout.
const DECIMALS: usize = 44;
const IS_INITIALIZED: usize = 45;

/// Calls `f(type, value)` for every TLV extension entry of a Token-2022 mint
/// (none for an SPL Token mint or an unextended Token-2022 mint).
fn for_each_extension(data: &[u8], mut f: impl FnMut(u16, &[u8]) -> Result<()>) -> Result<()> {
    if data.len() <= MINT_LEN {
        return Ok(());
    }
    let mut at = TLV_START;
    while at + 4 <= data.len() {
        let ty = u16::from_le_bytes([data[at], data[at + 1]]);
        let len = u16::from_le_bytes([data[at + 2], data[at + 3]]) as usize;
        if ty == 0 {
            break;
        }
        let value = data
            .get(at + 4..at + 4 + len)
            .ok_or(ImagineError::QuoteAccountMismatch)?;
        f(ty, value)?;
        at += 4 + len;
    }
    Ok(())
}

/// TransferHook { authority: 32, program_id: 32 }
fn hook_program_set(value: &[u8]) -> bool {
    value.get(32..64).is_some_and(|p| p.iter().any(|b| *b != 0))
}

/// Decimals of an initialized SPL Token / Token-2022 mint owned by
/// `token_program`.
pub fn decimals(mint: &AccountInfo, token_program: &Pubkey) -> Result<u8> {
    require_keys_eq!(*mint.owner, *token_program, ImagineError::QuoteAccountMismatch);
    let data = mint.try_borrow_data()?;
    require!(
        data.len() >= MINT_LEN && data[IS_INITIALIZED] == 1,
        ImagineError::QuoteAccountMismatch
    );
    Ok(data[DECIMALS])
}

/// What `launch` requires of a quote mint, since every reward payout is a
/// plain `transfer_checked` out of the vault: no transfer fee (older or newer
/// rate) and no authority that could set one later, no transfer hook program,
/// new accounts not frozen by default, transferable.
///
/// Accepted issuer risks (xStocks carry them): a TransferHook with only its
/// authority set, a DefaultAccountState authority, and the PermanentDelegate /
/// Pausable / freeze powers. They can stop a payout, never corrupt the books.
pub fn require_plain_transfers(mint: &AccountInfo) -> Result<()> {
    let data = mint.try_borrow_data()?;
    for_each_extension(&data, |ty, v| {
        match ty {
            TRANSFER_FEE_CONFIG => {
                // TransferFeeConfig { config authority 32, withdraw authority 32,
                // withheld 8, older { epoch 8, maximum_fee 8, bps 2 },
                // newer { epoch 8, maximum_fee 8, bps 2 } }
                let bps = |at: usize| v.get(at..at + 2).map_or(1, |b| u16::from_le_bytes([b[0], b[1]]));
                let config_authority = v.get(..32).is_none_or(|a| a.iter().any(|b| *b != 0));
                require!(
                    !config_authority && bps(88) == 0 && bps(106) == 0,
                    ImagineError::QuoteTransferFee
                );
            }
            TRANSFER_HOOK => require!(!hook_program_set(v), ImagineError::QuoteHookActive),
            // AccountState::Frozen = 2
            DEFAULT_ACCOUNT_STATE => {
                require!(v.first() != Some(&2), ImagineError::QuoteNotTransferable)
            }
            NON_TRANSFERABLE => return err!(ImagineError::QuoteNotTransferable),
            _ => {}
        }
        Ok(())
    })
}
