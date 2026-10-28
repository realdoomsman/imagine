//! The slice of Raydium LaunchLab (`raydium_launchpad`) and Raydium CPMM
//! (`raydium_cp_swap`) this program touches: the PDAs it pins, the instruction
//! data of `initialize_with_token_2022`, and the account fields it reads (by
//! byte offset, owner and discriminator checked). Layouts come from LaunchLab's
//! on-chain IDL and the raydium-cp-swap source; only the fields used here are
//! decoded, so later appended fields don't break anything.

use anchor_lang::prelude::*;

use crate::constants::{CPMM_PROGRAM_ID, LAUNCHLAB_PROGRAM_ID};
use crate::errors::ImagineError;

const PLATFORM_CONFIG_DISC: [u8; 8] = [0xa0, 0x4e, 0x80, 0x00, 0xf8, 0x53, 0xe6, 0xa0];
/// `PoolState` on both programs (same account name, same hash).
const POOL_STATE_DISC: [u8; 8] = [0xf7, 0xed, 0xe3, 0xf5, 0xd7, 0xc3, 0xde, 0x46];

const IX_INITIALIZE_WITH_TOKEN_2022: [u8; 8] = [37, 190, 126, 222, 44, 154, 171, 17];
/// LaunchLab `claim_creator_fee` (no arguments).
pub const IX_CLAIM_CREATOR_FEE: [u8; 8] = [26, 97, 138, 203, 132, 171, 141, 252];
/// CPMM `collect_creator_fee` (no arguments).
pub const IX_CPMM_COLLECT_CREATOR_FEE: [u8; 8] = [20, 22, 86, 123, 198, 28, 219, 132];
/// LaunchLab `buy_exact_in(amount_in, minimum_amount_out, share_fee_rate)`.
pub const IX_BUY_EXACT_IN: [u8; 8] = [0xfa, 0xea, 0x0d, 0x7b, 0xd5, 0x9c, 0x13, 0xec];
/// CPMM `swap_base_input(amount_in, minimum_amount_out)`.
pub const IX_CPMM_SWAP_BASE_INPUT: [u8; 8] = [0x8f, 0xbe, 0x5a, 0xda, 0xc4, 0x1e, 0x33, 0xde];

/// LaunchLab pool status once migrated to CPMM (0 = selling on the curve,
/// 1 = sold out, waiting for `migrate_to_cpswap`).
pub const POOL_MIGRATED: u8 = 2;

/// LaunchLab `["platform_allow_config", platform_config, global_config]`.
pub fn platform_allow_config_pda(platform_config: &Pubkey, global_config: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"platform_allow_config", platform_config.as_ref(), global_config.as_ref()],
        &LAUNCHLAB_PROGRAM_ID,
    )
    .0
}

/// LaunchLab `["platform_curve_rule", platform_config, global_config]`.
pub fn platform_curve_rule_pda(platform_config: &Pubkey, global_config: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"platform_curve_rule", platform_config.as_ref(), global_config.as_ref()],
        &LAUNCHLAB_PROGRAM_ID,
    )
    .0
}

/// The canonical CPMM pool of a token pair under `amm_config`
/// (`["pool", config, token0, token1]`, tokens sorted by bytes): where
/// LaunchLab's `migrate_to_cpswap` puts a graduated curve.
pub fn cpmm_pool_pda(amm_config: &Pubkey, mint_a: &Pubkey, mint_b: &Pubkey) -> Pubkey {
    let (t0, t1) = if mint_a.to_bytes() < mint_b.to_bytes() {
        (mint_a, mint_b)
    } else {
        (mint_b, mint_a)
    };
    Pubkey::find_program_address(
        &[b"pool", amm_config.as_ref(), t0.as_ref(), t1.as_ref()],
        &CPMM_PROGRAM_ID,
    )
    .0
}

fn load<'a, 'info>(
    info: &'a AccountInfo<'info>,
    owner: &Pubkey,
    disc: &[u8; 8],
    len: usize,
) -> Result<std::cell::Ref<'a, &'a mut [u8]>> {
    require_keys_eq!(*info.owner, *owner, ImagineError::InvalidLaunchLabAccount);
    let data = info.try_borrow_data()?;
    require!(
        data.len() >= len && data[..8] == *disc,
        ImagineError::InvalidLaunchLabAccount
    );
    Ok(data)
}

fn u64_at(d: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(d[at..at + 8].try_into().unwrap())
}

fn key_at(d: &[u8], at: usize) -> Pubkey {
    Pubkey::new_from_array(d[at..at + 32].try_into().unwrap())
}

/// LaunchLab `PlatformConfig` (944 bytes): whether it restricts global
/// configs or curve params, in which case `initialize` takes the platform's
/// allow-config and curve-rule accounts as trailing accounts.
pub struct PlatformConfig {
    pub restrict_global_config: u8,
    pub restrict_curve_param: u8,
}

impl PlatformConfig {
    pub fn load(info: &AccountInfo) -> Result<Self> {
        let d = load(info, &LAUNCHLAB_PROGRAM_ID, &PLATFORM_CONFIG_DISC, 834)?;
        Ok(Self {
            restrict_global_config: d[832],
            restrict_curve_param: d[833],
        })
    }

    pub fn restricted(&self) -> bool {
        self.restrict_global_config != 0 || self.restrict_curve_param != 0
    }
}

/// LaunchLab `PoolState` (429 bytes).
pub struct PoolState {
    pub status: u8,
    pub virtual_base: u64,
    pub virtual_quote: u64,
    pub real_base: u64,
    pub real_quote: u64,
    pub platform_config: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub creator: Pubkey,
}

impl PoolState {
    pub fn load(info: &AccountInfo) -> Result<Self> {
        let d = load(info, &LAUNCHLAB_PROGRAM_ID, &POOL_STATE_DISC, 365)?;
        Ok(Self {
            status: d[17],
            virtual_base: u64_at(&d, 37),
            virtual_quote: u64_at(&d, 45),
            real_base: u64_at(&d, 53),
            real_quote: u64_at(&d, 61),
            platform_config: key_at(&d, 173),
            base_mint: key_at(&d, 205),
            quote_mint: key_at(&d, 237),
            creator: key_at(&d, 333),
        })
    }

    /// The curve's (quote, base) reserves every trade is priced on:
    /// `(vB + rB, vA − rA)`.
    pub fn reserves(&self) -> Result<(u64, u64)> {
        let quote = self
            .virtual_quote
            .checked_add(self.real_quote)
            .ok_or(ImagineError::MathOverflow)?;
        let base = self
            .virtual_base
            .checked_sub(self.real_base)
            .ok_or(ImagineError::PriceUnavailable)?;
        Ok((quote, base))
    }
}

/// CPMM `PoolState` (637 bytes).
pub struct CpmmPool {
    pub amm_config: Pubkey,
    /// Who collects the pool's creator fees: for a LaunchLab migration under a
    /// platform without a `platform_cp_creator`, the LaunchLab creator.
    pub pool_creator: Pubkey,
    pub token_0_vault: Pubkey,
    pub token_1_vault: Pubkey,
    pub token_0_mint: Pubkey,
    pub token_1_mint: Pubkey,
    /// Protocol + fund + creator fees parked in each vault until collected;
    /// they aren't liquidity (`vault_amount_without_fee`).
    pub fees_token_0: u64,
    pub fees_token_1: u64,
    /// Creator fees accrued and not yet collected (included in `fees_*`).
    pub creator_fees: u64,
}

impl CpmmPool {
    pub fn load(info: &AccountInfo) -> Result<Self> {
        let d = load(info, &CPMM_PROGRAM_ID, &POOL_STATE_DISC, 413)?;
        let fees = |p: usize, f: usize, c: usize| -> Result<u64> {
            u64_at(&d, p)
                .checked_add(u64_at(&d, f))
                .and_then(|s| s.checked_add(u64_at(&d, c)))
                .ok_or(ImagineError::MathOverflow.into())
        };
        Ok(Self {
            amm_config: key_at(&d, 8),
            pool_creator: key_at(&d, 40),
            token_0_vault: key_at(&d, 72),
            token_1_vault: key_at(&d, 104),
            token_0_mint: key_at(&d, 168),
            token_1_mint: key_at(&d, 200),
            fees_token_0: fees(341, 357, 397)?,
            fees_token_1: fees(349, 365, 405)?,
            creator_fees: u64_at(&d, 397).saturating_add(u64_at(&d, 405)),
        })
    }

    /// The pool's (vault, fees) on `mint`'s side.
    pub fn side(&self, mint: &Pubkey) -> Result<(Pubkey, u64)> {
        if *mint == self.token_0_mint {
            Ok((self.token_0_vault, self.fees_token_0))
        } else if *mint == self.token_1_mint {
            Ok((self.token_1_vault, self.fees_token_1))
        } else {
            err!(ImagineError::PriceUnavailable)
        }
    }
}

/// `amount` field of an SPL Token / Token-2022 account (same offset in both).
pub fn token_amount(info: &AccountInfo) -> Result<u64> {
    let d = info.try_borrow_data()?;
    require!(d.len() >= 72, ImagineError::VaultAccountingMismatch);
    Ok(u64_at(&d, 64))
}

/// Body of `initialize_with_token_2022`: a Token-2022 coin with its metadata
/// in the mint, a constant-product curve migrating to CPMM, no vesting, the
/// CPMM creator fee on the quote token and no transfer fee.
pub fn initialize_with_token_2022_data(
    decimals: u8,
    name: &str,
    symbol: &str,
    uri: &str,
    supply: u64,
    total_sell: u64,
    fund_raising: u64,
) -> Vec<u8> {
    let mut d = Vec::with_capacity(8 + 1 + 12 + name.len() + symbol.len() + uri.len() + 1 + 25 + 24 + 2);
    d.extend_from_slice(&IX_INITIALIZE_WITH_TOKEN_2022);
    d.push(decimals);
    for s in [name, symbol, uri] {
        d.extend_from_slice(&(s.len() as u32).to_le_bytes());
        d.extend_from_slice(s.as_bytes());
    }
    d.push(0); // CurveParams::Constant
    d.extend_from_slice(&supply.to_le_bytes());
    d.extend_from_slice(&total_sell.to_le_bytes());
    d.extend_from_slice(&fund_raising.to_le_bytes());
    d.push(1); // migrate_type: CPMM
    d.extend_from_slice(&[0u8; 24]); // VestingParams: nothing locked
    d.push(0); // AmmCreatorFeeOn::QuoteToken
    d.push(0); // transfer_fee_extension_param: None
    d
}
