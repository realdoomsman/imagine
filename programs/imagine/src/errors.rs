use anchor_lang::prelude::*;

#[error_code]
pub enum ImagineError {
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
    /// Retired: `early_unlock` also closes matured locks now. Kept so the
    /// codes of the variants after it do not shift.
    #[msg("Position has already unlocked; use unlock instead")]
    AlreadyUnlocked,
    #[msg("Launches are paused for new pools")]
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
    #[msg("Vault balance does not match pool accounting")]
    VaultAccountingMismatch,
    #[msg("Position has matured; extend it or open a new one")]
    PositionMatured,
    #[msg("Only the position owner may do this")]
    NotPositionOwner,
    #[msg("Only the program upgrade authority may initialise the config")]
    NotUpgradeAuthority,
    #[msg("Only the pool's creator may do this")]
    NotPoolCreator,
    #[msg("Account is not this coin's LaunchLab or CPMM pool")]
    InvalidLaunchLabAccount,
    #[msg("Coin price unavailable: pass the CPMM pool state and both vaults for a migrated coin")]
    PriceUnavailable,
    #[msg("This lock gave up its earnings; it cannot earn again")]
    PositionRenounced,
    #[msg("Pool has not been founded yet")]
    NotFounded,
    #[msg("Quote accounts missing or not this pool's quote")]
    QuoteAccountMismatch,
    #[msg("Quote mint charges a transfer fee or can be made to")]
    QuoteTransferFee,
    #[msg("Quote mint has an active transfer hook")]
    QuoteHookActive,
    #[msg("Quote mint is not freely transferable")]
    QuoteNotTransferable,
    #[msg("LaunchLab platform is not the configured IMAGINE platform")]
    PlatformMismatch,
    #[msg("Metadata URI is not this coin's IMAGINE metadata document")]
    InvalidMetadataUri,
    #[msg("This lock is locked forever; it can never be unlocked, grown or extended")]
    PositionLockedForever,
    #[msg("This lock has not turned on auto-compound; only its owner may compound it")]
    CompoundNotEnabled,
    #[msg("Rewards to compound are below the minimum")]
    CompoundTooSmall,
    #[msg("Compound bought fewer coins than the slippage guard allows")]
    CompoundSlippage,
    #[msg("Only the lock's owner or the IMAGINE keeper may compound it")]
    NotKeeper,
}
