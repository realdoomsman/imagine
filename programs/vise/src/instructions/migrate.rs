use crate::errors::ViseError;
use crate::state::{Pool, Position};
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_lang::Discriminator;

#[derive(Accounts)]
pub struct Migrate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: a `Pool` or `Position` this program owns, told apart by its
    /// discriminator in the handler.
    #[account(mut, owner = crate::ID)]
    pub target: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Grow a pool or position written before earnings limits to the current
/// layout. Permissionless and idempotent: the new bytes are zero, which reads
/// as an uncapped pool (`capped = false`) and a zero cap that an uncapped pool
/// never consults, so an old pool keeps exactly the deal it was created with.
/// The payer covers the extra rent.
pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
    let info = ctx.accounts.target.to_account_info();
    let new_len = {
        let data = info.try_borrow_data()?;
        let discriminator = data.get(..8).ok_or(ViseError::InvalidParameter)?;
        if discriminator == Pool::DISCRIMINATOR {
            8 + Pool::INIT_SPACE
        } else if discriminator == Position::DISCRIMINATOR {
            8 + Position::INIT_SPACE
        } else {
            return err!(ViseError::InvalidParameter);
        }
    };
    if info.data_len() >= new_len {
        return Ok(());
    }

    let needed = Rent::get()?
        .minimum_balance(new_len)
        .saturating_sub(info.lamports());
    if needed > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: info.clone(),
                },
            ),
            needed,
        )?;
    }
    // New bytes are zero-filled.
    info.resize(new_len)?;
    Ok(())
}
