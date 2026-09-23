use crate::constants::*;
use crate::errors::ViseError;
use crate::math::{apply_bps, distribute};
use anchor_lang::prelude::*;

/// Platform-wide settings. Only ever read when a *new* pool is created: live
/// pools carry their own frozen copy of the terms, so nothing an admin does
/// later can change the deal an existing locker agreed to.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    /// Destination stamped into new pools' `treasury` field.
    pub treasury: Pubkey,
    /// App fee charged by the front-end on routed swaps, in bps of the SOL leg.
    /// Advisory: it is enforced when our API builds the transaction, not by this
    /// program. Stored here so the UI and indexer share one source of truth.
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
    /// Blocks new pool creation only. Never blocks lock, claim, or unlock.
    pub paused: bool,
    pub pool_count: u64,
    pub bump: u8,
}

/// Immutable economic terms, copied into every pool at creation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Debug)]
pub struct PoolTerms {
    pub treasury_share_bps: u16,
    pub creator_share_bps: u16,
    pub min_lock_secs: u32,
    pub max_lock_secs: u32,
    pub max_multiplier_bps: u32,
    pub early_unlock_penalty_bps: u16,
    pub min_lock_amount: u64,
    /// Window over which arriving fees are released to lockers.
    ///
    /// Fees are not handed out at the instant they land. They stream in
    /// linearly over this window, so a reward share is earned by weight *held
    /// over time* rather than by weight held at one chosen instant. Without it,
    /// anyone could watch lamports pile up in the vault, lock a large bag,
    /// trigger the accounting, claim a slice of a backlog they were not present
    /// for, and leave.
    pub reward_stream_secs: u32,
}

impl PoolTerms {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.treasury_share_bps <= MAX_TREASURY_SHARE_BPS,
            ViseError::InvalidParameter
        );
        require!(
            self.creator_share_bps <= MAX_CREATOR_SHARE_BPS,
            ViseError::InvalidParameter
        );
        // A floor as well as a ceiling: the exit penalty is the economic
        // backstop behind the reward stream, and a pool that sets it to zero
        // makes churning in and out of the stream free.
        require!(
            (MIN_PENALTY_BPS..=MAX_PENALTY_BPS).contains(&self.early_unlock_penalty_bps),
            ViseError::InvalidParameter
        );
        require!(
            (MIN_REWARD_STREAM_SECS..=MAX_REWARD_STREAM_SECS)
                .contains(&self.reward_stream_secs),
            ViseError::InvalidParameter
        );
        require!(
            self.min_lock_secs >= MIN_LOCK_SECS_FLOOR
                && self.max_lock_secs <= MAX_LOCK_SECS_CEILING
                && self.min_lock_secs <= self.max_lock_secs,
            ViseError::InvalidParameter
        );
        require!(
            self.max_multiplier_bps >= BPS_DENOMINATOR as u32
                && self.max_multiplier_bps <= MAX_MULTIPLIER_BPS,
            ViseError::InvalidParameter
        );
        require!(self.min_lock_amount > 0, ViseError::InvalidParameter);
        Ok(())
    }
}

/// One lock-to-earn vault, keyed by mint.
///
/// Reward accounting is the MasterChef accumulator: every lamport that lands in
/// `reward_vault` is detected by balance diff, split, and spread over
/// `total_weight`. No instruction can move SOL or tokens out of a pool except
/// to the locker, creator, or treasury that earned it.
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub treasury: Pubkey,
    pub token_vault: Pubkey,
    pub reward_vault: Pubkey,
    /// Token program that owns `mint` (SPL Token or Token-2022).
    pub token_program: Pubkey,
    pub terms: PoolTerms,

    pub total_locked: u64,
    pub total_weight: u128,
    pub acc_reward_per_weight: u128,
    /// Lamports received but too small to divide across `total_weight` yet.
    pub reward_remainder: u64,
    /// `reward_vault.lamports - vault_reserve` as of the last sync.
    pub last_vault_balance: u64,
    /// Rent-exempt minimum parked in `reward_vault`; never distributable.
    pub vault_reserve: u64,

    /// Lockers' lamports that have arrived but are still streaming out.
    pub undistributed: u64,
    /// Release rate in `lamports * SCALE` per second.
    pub stream_rate: u128,
    /// When the current release window ends.
    pub stream_end: i64,
    /// Last timestamp the stream was advanced to.
    pub last_stream_at: i64,

    pub creator_claimable: u64,
    pub treasury_claimable: u64,
    pub lifetime_inflow: u64,
    pub lifetime_rewards: u64,
    pub lifetime_creator: u64,
    pub lifetime_treasury: u64,
    pub lifetime_burned: u64,

    pub open_positions: u64,
    pub positions_created: u64,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

/// Outcome of a sync, for event emission.
#[derive(Default, Clone, Copy, Debug)]
pub struct SyncResult {
    /// Newly absorbed lamports, before the split.
    pub inflow: u64,
    pub to_lockers: u64,
    pub to_creator: u64,
    pub to_treasury: u64,
    /// Lamports the stream actually handed to lockers during this call.
    pub released: u64,
}

impl Pool {
    /// Absorb arrivals and advance the release stream.
    ///
    /// Two distinct steps, in this order:
    ///
    /// 1. **Release.** Lamports already absorbed are handed to lockers at a
    ///    fixed rate per second. This is what makes a reward share a function of
    ///    weight *held over time* rather than weight held at one instant, and it
    ///    is what stops anyone from watching a backlog accumulate, locking a
    ///    large bag, and claiming a slice of rewards they were not present for.
    /// 2. **Absorb.** Any new lamports in the vault are split by the pool's
    ///    frozen terms; the lockers' share joins the stream and the window
    ///    restarts, so a steady fee flow becomes a steady payout.
    ///
    /// Idempotent, permissionless, and safe to call when nothing arrived.
    /// Callers MUST pass the vault's live lamport balance and MUST call this
    /// before reading `acc_reward_per_weight` or mutating `total_weight`.
    pub fn sync(&mut self, vault_lamports: u64, now: i64) -> Result<SyncResult> {
        let balance = vault_lamports.saturating_sub(self.vault_reserve);
        // Only this program can move lamports out, and every such path calls
        // `debit`. A drop we did not record means an accounting path was added
        // without one, and that must fail loudly rather than quietly reducing
        // what the pool believes it owes.
        require!(
            balance >= self.last_vault_balance,
            ViseError::VaultAccountingMismatch
        );

        let mut out = SyncResult::default();
        out.released = self.release(now)?;

        if balance > self.last_vault_balance {
            let inflow = balance - self.last_vault_balance;
            out.inflow = inflow;
            self.lifetime_inflow = self
                .lifetime_inflow
                .checked_add(inflow)
                .ok_or(ViseError::MathOverflow)?;

            let to_treasury = apply_bps(inflow, self.terms.treasury_share_bps)?;
            let after_treasury = inflow - to_treasury;
            let to_creator = apply_bps(after_treasury, self.terms.creator_share_bps)?;
            let to_lockers = after_treasury - to_creator;

            self.treasury_claimable = self
                .treasury_claimable
                .checked_add(to_treasury)
                .ok_or(ViseError::MathOverflow)?;
            self.creator_claimable = self
                .creator_claimable
                .checked_add(to_creator)
                .ok_or(ViseError::MathOverflow)?;
            self.lifetime_treasury = self
                .lifetime_treasury
                .checked_add(to_treasury)
                .ok_or(ViseError::MathOverflow)?;
            self.lifetime_creator = self
                .lifetime_creator
                .checked_add(to_creator)
                .ok_or(ViseError::MathOverflow)?;

            out.to_treasury = to_treasury;
            out.to_creator = to_creator;
            out.to_lockers = to_lockers;

            self.undistributed = self
                .undistributed
                .checked_add(to_lockers)
                .ok_or(ViseError::MathOverflow)?;
            self.restart_stream(now)?;
        }

        // Also tracks outflows: every payout lowers the vault, and recording the
        // new floor here keeps the next inflow diff exact.
        self.last_vault_balance = balance;
        Ok(out)
    }

    /// Hand the stream's elapsed share to lockers. Returns lamports released.
    fn release(&mut self, now: i64) -> Result<u64> {
        let until = now.min(self.stream_end);
        let elapsed = until.saturating_sub(self.last_stream_at).max(0) as u128;
        self.last_stream_at = now;
        if elapsed == 0 || self.undistributed == 0 {
            return Ok(0);
        }

        let due_scaled = self
            .stream_rate
            .checked_mul(elapsed)
            .ok_or(ViseError::MathOverflow)?;
        let due = u64::try_from(due_scaled / SCALE)
            .map_err(|_| ViseError::MathOverflow)?
            .min(self.undistributed);
        if due == 0 {
            return Ok(0);
        }

        self.undistributed -= due;
        self.credit_lockers(due)?;
        Ok(due)
    }

    /// Reprice the stream so everything outstanding pays out over a fresh
    /// window. New arrivals therefore extend and flatten the payout rather than
    /// landing as a lump anyone can time.
    fn restart_stream(&mut self, now: i64) -> Result<()> {
        let window = self.terms.reward_stream_secs as u128;
        self.stream_rate = (self.undistributed as u128)
            .checked_mul(SCALE)
            .ok_or(ViseError::MathOverflow)?
            / window;
        self.stream_end = now
            .checked_add(self.terms.reward_stream_secs as i64)
            .ok_or(ViseError::MathOverflow)?;
        self.last_stream_at = now;
        Ok(())
    }

    /// Spread lamports across current weight.
    ///
    /// With nothing locked there is nobody to pay, so the share goes to the
    /// treasury rather than parking in a pot that the next locker could scoop
    /// whole for the price of a minimum lock.
    fn credit_lockers(&mut self, lamports: u64) -> Result<()> {
        if lamports == 0 {
            return Ok(());
        }
        if self.total_weight == 0 {
            self.treasury_claimable = self
                .treasury_claimable
                .checked_add(lamports)
                .ok_or(ViseError::MathOverflow)?;
            self.lifetime_treasury = self
                .lifetime_treasury
                .checked_add(lamports)
                .ok_or(ViseError::MathOverflow)?;
            return Ok(());
        }

        let pot = lamports
            .checked_add(self.reward_remainder)
            .ok_or(ViseError::MathOverflow)?;
        let (increment, committed, remainder) = distribute(pot, self.total_weight)?;
        self.acc_reward_per_weight = self
            .acc_reward_per_weight
            .checked_add(increment)
            .ok_or(ViseError::MathOverflow)?;
        self.reward_remainder = remainder;
        self.lifetime_rewards = self
            .lifetime_rewards
            .checked_add(committed)
            .ok_or(ViseError::MathOverflow)?;
        Ok(())
    }

    /// Hand lamports already sitting in the vault back to the remaining lockers.
    ///
    /// Used when an early exit forfeits accrued rewards. The lamports never
    /// move, so `last_vault_balance` must NOT change — only their ownership
    /// does. These were already counted in `lifetime_rewards` when they were
    /// first released, so `credit_lockers` re-counting them is corrected here.
    pub fn redistribute(&mut self, lamports: u64) -> Result<()> {
        if lamports == 0 {
            return Ok(());
        }
        let before = self.lifetime_rewards;
        self.credit_lockers(lamports)?;
        self.lifetime_rewards = before;
        Ok(())
    }

    /// Record lamports leaving the vault so the next sync does not mistake the
    /// drop for a negative inflow.
    pub fn debit(&mut self, lamports: u64) -> Result<()> {
        self.last_vault_balance = self
            .last_vault_balance
            .checked_sub(lamports)
            .ok_or(ViseError::MathOverflow)?;
        Ok(())
    }

    pub fn vault_signer_seeds<'a>(&'a self, pool_key: &'a Pubkey, bump: &'a [u8; 1]) -> [&'a [u8]; 3] {
        [VAULT_SEED, pool_key.as_ref(), bump]
    }
}

/// A single lock. A wallet may hold many, each with its own term and weight.
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub index: u32,
    pub amount: u64,
    pub weight: u128,
    pub multiplier_bps: u32,
    pub lock_start: i64,
    pub lock_end: i64,
    /// Credit line already settled, in `SCALE`-scaled units, not lamports.
    ///
    /// Keeping the sub-lamport residue here is what makes the pool solvent:
    /// rounding it to whole lamports would let positions round up
    /// independently until the pool owed more than it holds.
    pub reward_debt: u128,
    pub claimed: u64,
    pub bump: u8,
}
