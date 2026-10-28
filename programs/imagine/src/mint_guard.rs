use crate::errors::ImagineError;
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as SplMint,
};
use anchor_spl::token_interface::Mint;

/// Reject mints whose token configuration would break custody or accounting.
///
/// A lock vault holds someone else's tokens for up to four years. Anything that
/// lets a third party freeze, claw back, tax, or halt a transfer would let that
/// third party strand locked principal, so such a mint cannot open a pool.
///
/// Every coin here is created by LaunchLab's `initialize_with_token_2022`
/// inside `launch`: a Token-2022 mint with a metadata pointer and its metadata
/// inline, no freeze authority, no transfer fee. Exactly that shape passes.
pub fn assert_custody_safe(mint: &InterfaceAccount<Mint>, mint_ai: &AccountInfo) -> Result<()> {
    // A live freeze authority can freeze the pool's token vault, permanently
    // trapping every locker's principal.
    require!(
        mint.freeze_authority.is_none(),
        ImagineError::FreezeAuthoritySet
    );
    require_keys_eq!(
        *mint_ai.owner,
        anchor_spl::token_2022::ID,
        ImagineError::UnsupportedMintExtension
    );

    let data = mint_ai.try_borrow_data()?;
    let state = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(ImagineError::UnsupportedMintExtension))?;

    for ext in state
        .get_extension_types()
        .map_err(|_| error!(ImagineError::UnsupportedMintExtension))?
    {
        // Metadata is descriptive only.
        let allowed = matches!(
            ext,
            ExtensionType::MetadataPointer | ExtensionType::TokenMetadata
        );
        require!(allowed, ImagineError::UnsupportedMintExtension);
    }

    Ok(())
}
