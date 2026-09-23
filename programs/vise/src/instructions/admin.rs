use crate::constants::*;
use crate::errors::ViseError;
use crate::events::ConfigUpdated;
use crate::state::{Config, PoolTerms};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ConfigArgs {
    pub treasury: Pubkey,
    pub trade_fee_bps: u16,
    pub default_treasury_share_bps: u16,
    pub max_creator_share_bps: u16,
    pub default_min_lock_secs: u32,
    pub default_max_lock_secs: u32,
    pub default_max_multiplier_bps: u32,
    pub default_early_unlock_penalty_bps: u16,
    pub default_min_lock_amount: u64,
    pub default_reward_stream_secs: u32,
    pub pool_creation_fee: u64,
    pub paused: bool,
}

impl ConfigArgs {
    fn validate(&self) -> Result<()> {
        require!(
            self.trade_fee_bps <= MAX_TRADE_FEE_BPS,
            ViseError::InvalidParameter
        );
        require!(
            self.max_creator_share_bps <= MAX_CREATOR_SHARE_BPS,
            ViseError::InvalidParameter
        );
        require!(
            self.pool_creation_fee <= MAX_POOL_CREATION_FEE,
            ViseError::InvalidParameter
        );
        require!(self.treasury != Pubkey::default(), ViseError::InvalidParameter);
        // Keeps accumulator growth bounded: acc scales as 1/min_weight, so a
        // pool held open by dust can inflate it until real locks overflow.
        require!(
            self.default_min_lock_amount >= MIN_LOCK_AMOUNT_FLOOR,
            ViseError::InvalidParameter
        );
        // Defaults must themselves be legal pool terms.
        PoolTerms {
            treasury_share_bps: self.default_treasury_share_bps,
            creator_share_bps: 0,
            min_lock_secs: self.default_min_lock_secs,
            max_lock_secs: self.default_max_lock_secs,
            max_multiplier_bps: self.default_max_multiplier_bps,
            early_unlock_penalty_bps: self.default_early_unlock_penalty_bps,
            min_lock_amount: self.default_min_lock_amount,
            reward_stream_secs: self.default_reward_stream_secs,
        }
        .validate()
    }

    fn apply(&self, config: &mut Config) {
        config.treasury = self.treasury;
        config.trade_fee_bps = self.trade_fee_bps;
        config.default_treasury_share_bps = self.default_treasury_share_bps;
        config.max_creator_share_bps = self.max_creator_share_bps;
        config.default_min_lock_secs = self.default_min_lock_secs;
        config.default_max_lock_secs = self.default_max_lock_secs;
        config.default_max_multiplier_bps = self.default_max_multiplier_bps;
        config.default_early_unlock_penalty_bps = self.default_early_unlock_penalty_bps;
        config.default_min_lock_amount = self.default_min_lock_amount;
        config.default_reward_stream_secs = self.default_reward_stream_secs;
        config.pool_creation_fee = self.pool_creation_fee;
        config.paused = self.paused;
    }
}

/// Only the program's upgrade authority may create the config.
///
/// Without this, the window between `deploy` and the first `initialize_config`
/// is a race anyone can win: the config is a singleton at a fixed PDA, and
/// whoever creates it becomes admin. The blast radius would be limited — an
/// admin cannot touch a live pool — but they would own the treasury address
/// stamped into every future pool.
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::Vise>,

    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ ViseError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_config(ctx: Context<InitializeConfig>, args: ConfigArgs) -> Result<()> {
    args.validate()?;
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.pending_admin = Pubkey::default();
    config.pool_count = 0;
    config.bump = ctx.bumps.config;
    args.apply(config);

    emit!(ConfigUpdated {
        admin: config.admin,
        trade_fee_bps: config.trade_fee_bps,
        paused: config.paused,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

/// Changes here only affect pools created *after* the change. Live pools carry
/// their own frozen terms.
pub fn update_config(ctx: Context<UpdateConfig>, args: ConfigArgs) -> Result<()> {
    args.validate()?;
    let config = &mut ctx.accounts.config;
    args.apply(config);

    emit!(ConfigUpdated {
        admin: config.admin,
        trade_fee_bps: config.trade_fee_bps,
        paused: config.paused,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

/// Two-step handover: a typo in `new_admin` cannot brick the config.
pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_admin = new_admin;
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(
        config.pending_admin != Pubkey::default(),
        ViseError::NotPendingAdmin
    );
    require_keys_eq!(
        config.pending_admin,
        ctx.accounts.pending_admin.key(),
        ViseError::NotPendingAdmin
    );
    config.admin = config.pending_admin;
    config.pending_admin = Pubkey::default();
    Ok(())
}
