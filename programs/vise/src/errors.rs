use anchor_lang::prelude::*;

#[error_code]
pub enum ViseError {
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Parameter outside the allowed range")]
    InvalidParameter,
    #[msg("Lock duration outside this pool's allowed range")]
    InvalidDuration,
    #[msg("Amount below this pool's minimum lock")]
    AmountTooSmall,
    #[msg("New unlock time must be later than the current one")]
    NotAnExtension,
    #[msg("Position is still locked")]
    StillLocked,
    #[msg("Position has already unlocked; use unlock instead")]
    AlreadyUnlocked,
    #[msg("Launchpad is paused for new pools")]
    Paused,
    #[msg("Signer is not the pending admin")]
    NotPendingAdmin,
    #[msg("Treasury account does not match the pool's treasury")]
    TreasuryMismatch,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Mint uses a token extension that is incompatible with custody")]
    UnsupportedMintExtension,
    #[msg("Mint has a freeze authority; vault funds could be frozen")]
    FreezeAuthoritySet,
    #[msg("Token vault balance does not match pool accounting")]
    VaultAccountingMismatch,
    #[msg("Reward vault is missing its rent reserve")]
    VaultReserveMissing,
    #[msg("Position has matured; extend it or open a new one")]
    PositionMatured,
    #[msg("Only the position owner may do this")]
    NotPositionOwner,
    #[msg("Only the program upgrade authority may initialise the config")]
    NotUpgradeAuthority,
    #[msg("Signer is not the coin's creator on pump.fun")]
    NotCoinCreator,
    #[msg("Bonding curve account is not a readable pump.fun curve")]
    InvalidBondingCurve,
    #[msg("Coin price unavailable: pass the pump AMM pool vaults for a graduated coin")]
    PriceUnavailable,
}
