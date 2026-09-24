use crate::constants::{BPS_DENOMINATOR, CURVE_LINEAR, CURVE_SQRT, SCALE, SIZE_TIERS};
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

/// Integer square root, floor. Newton's method converges in ~64 steps for
/// u128 and is exact at every integer, which the curve below depends on.
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut x = 1u128 << ((128 - n.leading_zeros()).div_ceil(2));
    loop {
        let y = (x + n / x) / 2;
        if y >= x {
            return x;
        }
        x = y;
    }
}

/// Duration multiplier along the pool's curve: `min_lock -> 1.0x`,
/// `max_lock -> max_multiplier`.
///
/// `CURVE_LINEAR` interpolates. `CURVE_SQRT` pays `sqrt(t / T)` of the headroom,
/// which is front-loaded: with a 4.0x ceiling over 7..365 days, thirty days is
/// worth 1.76x rather than the 1.19x a straight line gives, and ninety is 2.44x.
/// A year still takes the top. Computed as `sqrt(t * T) / T` so the whole thing
/// stays in integers.
///
/// Returns basis points (10_000 == 1.0x). A pool where `min == max` pins every
/// position to the ceiling.
pub fn duration_multiplier_bps(
    duration_secs: u32,
    min_lock_secs: u32,
    max_lock_secs: u32,
    max_multiplier_bps: u32,
    curve: u8,
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
    let progress = match curve {
        CURVE_LINEAR => travelled,
        CURVE_SQRT => isqrt(travelled.checked_mul(span).ok_or(ViseError::MathOverflow)?),
        _ => return Err(ViseError::InvalidParameter.into()),
    };
    let extra = headroom
        .checked_mul(progress)
        .ok_or(ViseError::MathOverflow)?
        / span;
    let bps = (BPS_DENOMINATOR as u128)
        .checked_add(extra)
        .ok_or(ViseError::MathOverflow)?;
    u32::try_from(bps).map_err(|_| ViseError::MathOverflow.into())
}

/// Bonus for the share of supply a single position commits.
///
/// Tiers are ascending thresholds in bps of total supply; the highest one the
/// position clears applies, and a zero threshold disables the tier. Measured
/// against supply rather than against the pool, so a position's tier never
/// changes because of what other people do.
pub fn size_bonus_bps(
    amount: u64,
    supply: u64,
    tiers: &[u16; SIZE_TIERS],
    bonuses: &[u16; SIZE_TIERS],
) -> u16 {
    if supply == 0 {
        return 0;
    }
    let share_bps = (amount as u128) * (BPS_DENOMINATOR as u128) / (supply as u128);
    let mut bonus = 0u16;
    for (tier, reward) in tiers.iter().zip(bonuses) {
        if *tier > 0 && share_bps >= *tier as u128 {
            bonus = *reward;
        }
    }
    bonus
}

/// The multiplier a position earns: duration curve scaled by size tier.
pub fn combined_multiplier_bps(duration_bps: u32, size_bonus: u16) -> Result<u32> {
    let scaled = (duration_bps as u128)
        .checked_mul((BPS_DENOMINATOR as u128) + size_bonus as u128)
        .ok_or(ViseError::MathOverflow)?
        / (BPS_DENOMINATOR as u128);
    u32::try_from(scaled).map_err(|_| ViseError::MathOverflow.into())
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

/// Penalty basis for a running lock that has just been topped up.
///
/// `early_exit_penalty` charges `amount * bps * remaining / term`, so each
/// token's penalty rate is `bps / term`. Keeping the old `lock_start` would
/// charge added principal at the old, long term's rate: a top-up a week before
/// the end of a year-long lock would cost ~0.5% to pull straight back out
/// instead of the full penalty a fresh week-long lock pays.
///
/// The returned start gives the combined position a term `T'` with
/// `new_amount / T' = old_amount / T + added / R`, where `T` is the old term and
/// `R` the time left. Because the penalty is linear in time remaining, that
/// makes the combined penalty at *every* later moment equal to what the old
/// position and a fresh lock of `added` over `R` would each charge separately:
/// existing principal keeps exactly its old basis and added principal gets a
/// fresh lock's. `T'` is rounded down, so rounding only ever raises the penalty.
///
/// The result satisfies `lock_start <= result <= now < lock_end`.
pub fn blended_lock_start(
    old_amount: u64,
    lock_start: i64,
    lock_end: i64,
    added: u64,
    now: i64,
) -> Result<i64> {
    require!(
        lock_start <= now && now < lock_end,
        ViseError::MathOverflow
    );
    let term = (lock_end - lock_start) as u128;
    let remaining = (lock_end - now) as u128;
    let new_amount = (old_amount as u128)
        .checked_add(added as u128)
        .ok_or(ViseError::MathOverflow)?;
    let numerator = new_amount
        .checked_mul(term)
        .and_then(|v| v.checked_mul(remaining))
        .ok_or(ViseError::MathOverflow)?;
    let denominator = (old_amount as u128)
        .checked_mul(remaining)
        .and_then(|v| v.checked_add((added as u128).checked_mul(term)?))
        .ok_or(ViseError::MathOverflow)?;
    require!(denominator > 0, ViseError::MathOverflow);
    // remaining <= blended <= term, so this fits in i64 and lands in range.
    let blended = (numerator / denominator) as i64;
    lock_end
        .checked_sub(blended)
        .ok_or_else(|| ViseError::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u32 = 86_400;

    #[test]
    fn linear_curve_spans_one_to_ceiling() {
        let (min, max, ceiling) = (7 * DAY, 365 * DAY, 40_000);
        let m = |d| duration_multiplier_bps(d, min, max, ceiling, CURVE_LINEAR).unwrap();
        assert_eq!(m(7 * DAY), 10_000);
        assert_eq!(m(365 * DAY), 40_000);
        let at_180 = m(180 * DAY);
        assert!((24_000..=25_000).contains(&at_180), "got {at_180}");
    }

    #[test]
    fn sqrt_curve_is_front_loaded_and_monotonic() {
        let (min, max, ceiling) = (7 * DAY, 365 * DAY, 40_000);
        let m = |d| duration_multiplier_bps(d, min, max, ceiling, CURVE_SQRT).unwrap();
        let lin = |d| duration_multiplier_bps(d, min, max, ceiling, CURVE_LINEAR).unwrap();
        // Same endpoints as the line...
        assert_eq!(m(7 * DAY), 10_000);
        assert_eq!(m(365 * DAY), 40_000);
        // ...and strictly above it everywhere between: a month is ~1.76x, not 1.19x.
        let at_30 = m(30 * DAY);
        assert!((17_400..=17_800).contains(&at_30), "got {at_30}");
        assert!((24_200..=24_600).contains(&m(90 * DAY)));
        for d in (8..365).step_by(3) {
            assert!(m(d * DAY) > lin(d * DAY), "sqrt must exceed linear at {d}d");
        }
        let mut last = 0;
        for d in (7..=365).step_by(1) {
            let v = m(d * DAY);
            assert!(v >= last, "non-monotonic at {d}d");
            last = v;
        }
    }

    #[test]
    fn hour_scale_window_starts_at_one_and_climbs_every_hour() {
        const HOUR: u32 = 3_600;
        let (min, max, ceiling) = (4 * HOUR, 365 * DAY, 40_000);
        let m = |d| duration_multiplier_bps(d, min, max, ceiling, CURVE_SQRT).unwrap();
        // The shortest lock still carries full weight: 1.0x, not zero.
        assert_eq!(m(4 * HOUR), 10_000);
        assert_eq!(m(365 * DAY), 40_000);
        assert!((11_300..=11_500).contains(&m(DAY)), "1d got {}", m(DAY));
        assert!((18_400..=18_800).contains(&m(30 * DAY)), "30d got {}", m(30 * DAY));
        let mut last = 0;
        for h in 4..=(365 * 24) {
            let v = m(h * HOUR);
            assert!(v > last, "not strictly increasing at {h}h");
            last = v;
        }
        assert!(duration_multiplier_bps(3 * HOUR, min, max, ceiling, CURVE_SQRT).is_err());
    }

    #[test]
    fn isqrt_is_exact_floor() {
        for n in [0u128, 1, 2, 3, 4, 15, 16, 17, 1 << 40, (1 << 63) - 1, u64::MAX as u128] {
            let r = isqrt(n);
            assert!(r * r <= n && (r + 1) * (r + 1) > n, "isqrt({n}) = {r}");
        }
        let big = (u64::MAX as u128) * (u64::MAX as u128);
        assert_eq!(isqrt(big), u64::MAX as u128);
    }

    #[test]
    fn multiplier_rejects_out_of_range() {
        assert!(duration_multiplier_bps(DAY, 7 * DAY, 365 * DAY, 40_000, CURVE_SQRT).is_err());
        assert!(duration_multiplier_bps(400 * DAY, 7 * DAY, 365 * DAY, 40_000, CURVE_SQRT).is_err());
        assert!(duration_multiplier_bps(30 * DAY, 7 * DAY, 365 * DAY, 40_000, 7).is_err());
    }

    #[test]
    fn size_tiers_pick_the_highest_cleared() {
        let supply = 1_000_000_000_000_000u64; // 1B tokens at 6 decimals
        let tiers = [10u16, 50, 100]; // 0.10%, 0.50%, 1.00% of supply
        let bonuses = [1_000u16, 2_500, 5_000];
        let bonus = |amount| size_bonus_bps(amount, supply, &tiers, &bonuses);
        assert_eq!(bonus(999_999_000_000), 0); // just under 0.10%
        assert_eq!(bonus(1_000_000_000_000), 1_000);
        assert_eq!(bonus(4_999_999_000_000), 1_000);
        assert_eq!(bonus(5_000_000_000_000), 2_500);
        assert_eq!(bonus(10_000_000_000_000), 5_000);
        assert_eq!(bonus(supply), 5_000);
        // Disabled tiers never fire, and a zero supply pays no bonus.
        assert_eq!(size_bonus_bps(supply, supply, &[0, 0, 0], &[0, 0, 0]), 0);
        assert_eq!(size_bonus_bps(supply, 0, &tiers, &bonuses), 0);
    }

    #[test]
    fn combined_multiplier_scales_duration_by_tier() {
        assert_eq!(combined_multiplier_bps(10_000, 0).unwrap(), 10_000);
        assert_eq!(combined_multiplier_bps(40_000, 5_000).unwrap(), 60_000);
        assert_eq!(combined_multiplier_bps(17_600, 1_000).unwrap(), 19_360);
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

    /// A top-up must cost exactly what a fresh lock of the added principal over
    /// the remaining term would, on top of the old position's own penalty, at
    /// every moment until the end — never the old long term's cheaper rate.
    #[test]
    fn blended_start_charges_top_up_as_a_fresh_lock() {
        let bps = 2_500;
        let year = 365 * DAY as i64;
        let week = 7 * DAY as i64;
        let cases: &[(u64, u64, i64, i64)] = &[
            // old, added, term, remaining
            (10_000_000_000, 100_000_000_000, year, week),
            (100_000_000_000, 1_000_000, year, week),
            (1_000_000, 100_000_000_000, year, year / 2),
            (5_000_000_000, 5_000_000_000, 30 * DAY as i64, 30 * DAY as i64),
            (7, 3, 1_000, 1),
        ];
        for &(old, added, term, remaining) in cases {
            let start = 1_000_000i64;
            let end = start + term;
            let now = end - remaining;
            let blended = blended_lock_start(old, start, end, added, now).unwrap();
            assert!(start <= blended && blended <= now, "start {blended} out of range");
            for t in [now, now + remaining / 3, now + remaining / 2, end - 1] {
                let combined = early_exit_penalty(old + added, blended, end, t, bps).unwrap();
                let separate = early_exit_penalty(old, start, end, t, bps).unwrap()
                    + early_exit_penalty(added, now, end, t, bps).unwrap();
                // Never cheaper; at most rounding above.
                assert!(combined + 2 >= separate, "{combined} < {separate} at {t}");
                let slack = apply_bps(old + added, bps).unwrap() / 1_000 + 3;
                assert!(combined <= separate + slack, "{combined} >> {separate} at {t}");
            }
        }
        // Topping up at the very start of a lock leaves the basis unchanged.
        assert_eq!(blended_lock_start(10, 50, 150, 90, 50).unwrap(), 50);
        // Nothing sane comes out of a clock outside the term.
        assert!(blended_lock_start(10, 50, 150, 1, 150).is_err());
        assert!(blended_lock_start(10, 50, 150, 1, 49).is_err());
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
