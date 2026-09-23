use crate::errors::ViseError;
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
/// third party strand locked principal, so those mints cannot open a pool.
///
/// pump.fun coins are Token-2022 mints carrying only a metadata pointer and
/// inline metadata, so they always pass.
pub fn assert_custody_safe(mint: &InterfaceAccount<Mint>, mint_ai: &AccountInfo) -> Result<()> {
    // A live freeze authority can freeze the pool's token vault, permanently
    // trapping every locker's principal.
    require!(
        mint.freeze_authority.is_none(),
        ViseError::FreezeAuthoritySet
    );

    if mint_ai.owner != &anchor_spl::token_2022::ID {
        return Ok(()); // Legacy SPL Token has no extensions.
    }

    let data = mint_ai.try_borrow_data()?;
    let state = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(ViseError::UnsupportedMintExtension))?;

    for ext in state
        .get_extension_types()
        .map_err(|_| error!(ViseError::UnsupportedMintExtension))?
    {
        let allowed = matches!(
            ext,
            // Metadata and grouping are descriptive only.
            ExtensionType::MetadataPointer
                | ExtensionType::TokenMetadata
                | ExtensionType::GroupPointer
                | ExtensionType::GroupMemberPointer
                | ExtensionType::TokenGroup
                | ExtensionType::TokenGroupMember
                // Display-only rescaling: base units, which is all we account
                // in, are unaffected.
                | ExtensionType::InterestBearingConfig
                // Closing a mint requires zero supply, impossible while the
                // vault holds locked tokens.
                | ExtensionType::MintCloseAuthority
        );
        require!(allowed, ViseError::UnsupportedMintExtension);
    }

    Ok(())
}
