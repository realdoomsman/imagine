use crate::constants::{BPS_DENOMINATOR, SCALE};
use crate::errors::ViseError;
use anchor_lang::prelude::*;

/// `amount * bps / 10_000`, saturating-free and checked.
pub fn apply_bps(amount: u64, bps: u16) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(ViseError::MathOverflow)?
        / (BPS_DENOMINATOR as u128);
    u64::try_from(v).map_err(|_| ViseError::MathOverflow.into())
}

/// Linear weight multiplier: `min_lock -> 1.0x`, `max_lock -> max_multiplier`.
///
/// Returns basis points (10_000 == 1.0x). A pool where `min == max` pins every
/// position to the ceiling.
pub fn multiplier_bps(
    duration_secs: u32,
    min_lock_secs: u32,
    max_lock_secs: u32,
    max_multiplier_bps: u32,
) -> Result<u32> {
    require!(
        duration_secs >= min_lock_secs && duration_secs <= max_lock_secs,
        ViseError::InvalidDuration
    );
    if max_lock_secs == min_lock_secs {
        return Ok(max_multiplier_bps);
    }
    let span = (max_lock_secs - min_lock_secs) as u128;
    let travelled = (duration_secs - min_lock_secs) as u128;
    let headroom = (max_multiplier_bps as u128)
        .checked_sub(BPS_DENOMINATOR as u128)
        .ok_or(ViseError::InvalidParameter)?;
    let extra = headroom
        .checked_mul(travelled)
        .ok_or(ViseError::MathOverflow)?
        / span;
    let bps = (BPS_DENOMINATOR as u128)
        .checked_add(extra)
        .ok_or(ViseError::MathOverflow)?;
    u32::try_from(bps).map_err(|_| ViseError::MathOverflow.into())
}

/// `amount * multiplier`, in weight units.
pub fn weight_of(amount: u64, multiplier_bps: u32) -> Result<u128> {
    (amount as u128)
        .checked_mul(multiplier_bps as u128)
        .ok_or(ViseError::MathOverflow)
        .map(|v| v / (BPS_DENOMINATOR as u128))
        .map_err(Into::into)
}

/// Lamports a position may claim, given its scaled credit line.
///
/// `reward_debt` is carried in *scaled* units, not lamports. Keeping the
/// sub-lamport residue on the position is what makes the pool solvent: if the
/// debt were rounded to whole lamports on every claim, each position could
/// round up independently and the pool would owe more than it received.
pub fn accrued(weight: u128, acc_reward_per_weight: u128, reward_debt: u128) -> Result<u64> {
    let credit = weight
        .checked_mul(acc_reward_per_weight)
        .ok_or(ViseError::MathOverflow)?;
    let net = credit.saturating_sub(reward_debt) / SCALE;
    u64::try_from(net).map_err(|_| ViseError::MathOverflow.into())
}

/// Scaled credit line for a position at the current accumulator.
///
/// Used when a position is opened or its weight changes. Both discard any
/// unpaid sub-lamport residue, which can only ever favour the pool.
pub fn reward_debt_for(weight: u128, acc_reward_per_weight: u128) -> Result<u128> {
    weight
        .checked_mul(acc_reward_per_weight)
        .ok_or(ViseError::MathOverflow)
        .map_err(Into::into)
}

/// Advance a scaled debt by lamports actually paid, preserving the residue.
pub fn settle_debt(reward_debt: u128, paid: u64) -> Result<u128> {
    reward_debt
        .checked_add((paid as u128).checked_mul(SCALE).ok_or(ViseError::MathOverflow)?)
        .ok_or(ViseError::MathOverflow)
        .map_err(Into::into)
}

/// Spread `lamports` across `total_weight`.
///
/// Returns `(increment, committed, remainder)` where `committed` is the
/// lamports the pool must now set aside for lockers and `remainder` is carried
/// to the next distribution. `committed` is rounded *up* from the scaled credit
/// actually handed out, so the sum of every position's floored claim can never
/// exceed it.
pub fn distribute(lamports: u64, total_weight: u128) -> Result<(u128, u64, u64)> {
    if total_weight == 0 || lamports == 0 {
        return Ok((0, 0, lamports));
    }
    let increment = (lamports as u128)
        .checked_mul(SCALE)
        .ok_or(ViseError::MathOverflow)?
        / total_weight;
    let scaled_credit = increment
        .checked_mul(total_weight)
        .ok_or(ViseError::MathOverflow)?;
    let committed_u128 = scaled_credit.div_ceil(SCALE);
    let committed = u64::try_from(committed_u128).map_err(|_| ViseError::MathOverflow)?;
    let remainder = lamports
        .checked_sub(committed)
        .ok_or(ViseError::MathOverflow)?;
    Ok((increment, committed, remainder))
}

/// Penalty on an early exit, linear in the fraction of the term still unserved.
///
/// Serving the whole term costs nothing; bailing the instant after locking costs
/// the full `penalty_bps`.
pub fn early_exit_penalty(
    amount: u64,
    lock_start: i64,
    lock_end: i64,
    now: i64,
    penalty_bps: u16,
) -> Result<u64> {
    if now >= lock_end || penalty_bps == 0 {
        return Ok(0);
    }
    let term = lock_end
        .checked_sub(lock_start)
        .ok_or(ViseError::MathOverflow)?;
    if term <= 0 {
        return Ok(0);
    }
    let remaining = lock_end.checked_sub(now).ok_or(ViseError::MathOverflow)?;
    let remaining = remaining.clamp(0, term) as u128;
    let full = apply_bps(amount, penalty_bps)? as u128;
    let scaled = full
        .checked_mul(remaining)
        .ok_or(ViseError::MathOverflow)?
        / (term as u128);
    u64::try_from(scaled).map_err(|_| ViseError::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u32 = 86_400;

    #[test]
    fn multiplier_spans_one_to_ceiling() {
        let (min, max, ceiling) = (7 * DAY, 365 * DAY, 40_000);
        assert_eq!(multiplier_bps(7 * DAY, min, max, ceiling).unwrap(), 10_000);
        assert_eq!(multiplier_bps(365 * DAY, min, max, ceiling).unwrap(), 40_000);
        // 180 days lands near Printr's 2.5x reference point.
        let at_180 = multiplier_bps(180 * DAY, min, max, ceiling).unwrap();
        assert!((24_000..=25_000).contains(&at_180), "got {at_180}");
        // Monotonic in duration.
        let mut last = 0;
        for d in (7..=365).step_by(7) {
            let m = multiplier_bps(d * DAY, min, max, ceiling).unwrap();
            assert!(m >= last);
            last = m;
        }
    }

    #[test]
    fn multiplier_rejects_out_of_range() {
        assert!(multiplier_bps(DAY, 7 * DAY, 365 * DAY, 40_000).is_err());
        assert!(multiplier_bps(400 * DAY, 7 * DAY, 365 * DAY, 40_000).is_err());
    }

    #[test]
    fn distribute_conserves_lamports() {
        for &(lamports, weight) in &[
            (1u64, 1_000_000u128),
            (7, 3),
            (1_000_000_000, 4_000_000_000_000_000),
            (u32::MAX as u64, 999_983),
        ] {
            let (inc, committed, remainder) = distribute(lamports, weight).unwrap();
            assert_eq!(committed + remainder, lamports);
            // Committed lamports must cover the scaled credit handed out.
            assert!((committed as u128) * SCALE >= inc * weight);
        }
    }

    /// The failure this guards against: many small deposits, each one dividing
    /// unevenly, letting every position's floored claim tick up independently
    /// until the pool owes more than it ever received.
    #[test]
    fn many_uneven_deposits_stay_solvent() {
        let weights: [u128; 5] = [3, 7, 11, 1_000_003, 999_999_937];
        let total: u128 = weights.iter().sum();
        let mut acc: u128 = 0;
        let mut debts = [0u128; 5];
        let mut carried: u64 = 0;
        let mut received: u64 = 0;
        let mut paid: u64 = 0;

        for step in 1..=500u64 {
            let deposit = step * 7 + 1;
            received += deposit;
            let (inc, _committed, remainder) = distribute(deposit + carried, total).unwrap();
            acc += inc;
            carried = remainder;

            // Every third step, everyone claims.
            if step % 3 == 0 {
                for (i, w) in weights.iter().enumerate() {
                    let due = accrued(*w, acc, debts[i]).unwrap();
                    debts[i] = settle_debt(debts[i], due).unwrap();
                    paid += due;
                }
            }
            let outstanding: u64 = weights
                .iter()
                .enumerate()
                .map(|(i, w)| accrued(*w, acc, debts[i]).unwrap())
                .sum();
            assert!(
                paid + outstanding + carried <= received,
                "step {step}: owes {} of {received}",
                paid + outstanding + carried
            );
        }
    }

    #[test]
    fn distribute_holds_everything_when_no_weight() {
        let (inc, distributed, remainder) = distribute(500, 0).unwrap();
        assert_eq!((inc, distributed, remainder), (0, 0, 500));
    }

    /// The solvency direction is one-way: a pool may under-pay by a few
    /// lamports of truncation dust, but must never promise more than it holds.
    #[test]
    fn accrual_never_exceeds_deposits() {
        let cases: &[(&[u128], u64)] = &[
            (&[3_000_000, 7_000_000], 1_000_000_007),
            (&[1, 1, 1], 10),
            (&[999_983, 7, 123_456_789], 555_555_555),
            (&[4_000_000_000_000_000], 1),
        ];
        for (weights, deposit) in cases {
            let total: u128 = weights.iter().sum();
            let (acc, distributed, remainder) = distribute(*deposit, total).unwrap();
            let paid: u64 = weights.iter().map(|w| accrued(*w, acc, 0).unwrap()).sum();

            // Never promise more than arrived.
            assert!(paid <= *deposit, "paid {paid} > deposit {deposit}");
            // Never promise more than the accumulator says was distributed.
            assert!(paid <= distributed, "paid {paid} > distributed {distributed}");
            // Whatever the accumulator could not divide is carried, not lost.
            assert_eq!(distributed + remainder, *deposit);
            // Per-position truncation loses strictly less than one lamport each.
            assert!(distributed - paid < weights.len() as u64);
        }
    }

    #[test]
    fn reward_debt_zeroes_future_claims() {
        let weight = 12_345_678u128;
        let acc = 987_654_321_000u128;
        let debt = reward_debt_for(weight, acc).unwrap();
        assert_eq!(accrued(weight, acc, debt).unwrap(), 0);
    }

    #[test]
    fn penalty_decays_to_zero_over_the_term() {
        let (start, end) = (1_000i64, 1_000i64 + 100);
        assert_eq!(early_exit_penalty(1_000, start, end, start, 2_500).unwrap(), 250);
        assert_eq!(early_exit_penalty(1_000, start, end, start + 50, 2_500).unwrap(), 125);
        assert_eq!(early_exit_penalty(1_000, start, end, end, 2_500).unwrap(), 0);
        assert_eq!(early_exit_penalty(1_000, start, end, end + 10, 2_500).unwrap(), 0);
    }

    #[test]
    fn weight_matches_multiplier() {
        assert_eq!(weight_of(1_000_000, 10_000).unwrap(), 1_000_000);
        assert_eq!(weight_of(1_000_000, 40_000).unwrap(), 4_000_000);
    }

    #[test]
    fn extreme_supply_stays_within_u128() {
        // 1B tokens at 6 decimals, whole supply locked at the 10x ceiling.
        let weight = weight_of(1_000_000_000_000_000, 100_000).unwrap();
        // 1e7 SOL of lifetime rewards against a single 1-token position.
        let (inc, _, _) = distribute(10_000_000_000_000_000, 1_000_000).unwrap();
        assert!(weight.checked_mul(inc).is_some());
    }
}
