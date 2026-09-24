# Security review — internal pass

Reviewed: `programs/vise/src/` at the pre-deployment working tree, 2026-09-22.
Method: full manual read of the program source, every `address =` / `seeds =` /
`has_one` / `Signer` constraint traced, accounting invariants re-derived by hand
and checked against the Rust unit tests and the LiteSVM suite.

**This is an internal review. An independent external audit is still required
before mainnet** — see `docs/RUNBOOK.md`.

## Outcome

Fourteen findings: one critical, three high, one medium, four low, five
informational. No solvency break, no custody break, no missing signer or owner
check, no PDA collision, and no admin path to pool funds was found. A
post-deployment pass added R02–R04, below.

Every finding at low severity and above is fixed. Each fix carries a regression
test that fails against the old code — see `describe("audit regressions")` in
`packages/sdk/test/vise.test.ts`.

## Findings and resolutions

### VISE-01 — Critical — `increase()` minted full-multiplier weight with no remaining term

A position that had matured but was never closed kept its original multiplier.
`increase()` applied that multiplier to newly deposited principal without
checking that any lock term remained, and `unlock()` on a matured position
charges no penalty. An attacker could keep a ladder of dust positions opened at
365 days, wait them out, then in one transaction top one up with a large bag,
claim a pro-rata slice of the reward stream, and withdraw everything — capital
exposed for a single slot, cost limited to transaction fees.

*Fixed:* `increase` now rejects a matured position (`ViseError::PositionMatured`)
and reprices the whole position against the term still to run, so added
principal can never buy more weight than the time it is actually committed for.

A second, deeper problem the finding exposed: a matured position keeps full
weight indefinitely, diluting people who are still committed. `unlock` is now
permissionless for matured positions — principal, rewards and rent all go to the
position's recorded owner — so a third party *can* close them out. Nothing does
so yet: the program only makes the crank possible, and the keeper that closes
matured positions is being added to the API separately. Until it ships,
matured-but-open positions keep diluting. `early_unlock` remains owner-only,
because burning someone else's principal is not a third party's decision.

### VISE-02 — High — reward inflow was recognised at an attacker-chosen moment

Inflow was folded into the accumulator only when somebody triggered a sync, and
pump.fun credits the vault with no instruction at all. An attacker could read
the unassigned backlog straight from public state, then atomically lock, sync,
claim a share of rewards that accrued while only honest lockers were committed,
and exit for at most the early-exit penalty.

*Fixed:* rewards now stream. Arriving lamports go into `Pool::undistributed` and
are released linearly over `reward_stream_secs`, a term frozen on the pool at
creation (1 hour to 7 days, default 24 hours). A reward share is therefore a
function of weight *held over time*, and weight created after lamports arrive
earns nothing from them. The early-exit penalty also gained a floor
(`MIN_PENALTY_BPS = 500`) so a pool cannot be configured with no exit cost at
all.

### VISE-03 — High — the parked remainder was scoopable when nothing was locked

Once every position exited, `total_weight` reached zero and the entire locker
share parked in `reward_remainder`, growing for as long as fees kept arriving. A
single minimum-size lock could then take the whole pot.

*Fixed:* with no weight there is nobody to pay, so the lockers' share is credited
to the treasury instead of parking. The creator's share is unaffected — it was
always theirs.

### VISE-04 — High — anyone could create a pool for anyone's coin

The pool PDA is one-per-mint and `create_pool` authenticated nobody, so the
first caller permanently owned up to 30% of every lamport that coin ever
generated — including fees routed there by the real creator, who could then
never open a competing pool.

*Fixed:* `create_pool` reads `BondingCurve::creator` out of pump.fun's own
account for that mint and requires it to equal the signer. The account is proven
canonical by a `seeds::program` constraint plus an owner check, and the field is
read by offset because pump exposes no read instruction.

This makes ordering load-bearing: the pool must be created *before* the
fee-sharing migration, which rewrites `BondingCurve::creator` to the sharing
config PDA. Both `apps/api/src/routes/tx.ts` and the end-to-end script follow
that order, and the e2e would fail loudly if either were reordered.

### VISE-05 — Medium — `initialize_config` was permissionless

Between deploying the program and initialising it, anyone could seize the
singleton config PDA. There is no re-init path, so the treasury address stamped
into every future pool would have been theirs.

*Fixed:* `InitializeConfig` now takes the program and its ProgramData account
and requires the signer to be the recorded upgrade authority.

### VISE-06 — Low — unbounded accumulator growth at tiny weight

`acc_reward_per_weight` grows as `lamports / total_weight`, so a pool held open
by dust could inflate it until legitimate large locks overflowed. The `SCALE`
safety comment also assumed a 4.0x ceiling where 10.0x is enforced.

*Fixed:* `MIN_LOCK_AMOUNT_FLOOR` (one whole token at 6 decimals) is enforced in
`ConfigArgs::validate`, and the comment now states the enforced ceiling and
expresses the bound as a function of the minimum lock.

### VISE-07 — Low — matured unlock emitted no `Claimed` event

Real lamports were paid with no event, so indexers missed every position's final
and largest harvest. *Fixed:* `unlock` now emits `Claimed`. This matters more
since unlock became permissionless, as the payout is no longer attributable to
the signer.

### VISE-08 — Low — `sync` silently absorbed an unexplained balance drop

Not reachable today, since every outflow path calls `debit`, but a future path
that forgot to would have silently made recorded obligations exceed holdings.
*Fixed:* `sync` now requires the balance to be at least `last_vault_balance` and
fails with `VaultAccountingMismatch` otherwise.

### VISE-09 — Low — `vault_reserve` frozen against a future rent increase

*Fixed:* the reserve is funded at twice the rent-exempt minimum at creation.

### VISE-10 to VISE-14 — Informational

- `redistribute` no longer re-counts forfeited lamports into `lifetime_rewards`.
  (Since replaced by `Pool::forfeit`; see R02.)
- The `reward_debt` doc comment now states it is `SCALE`-scaled, not lamports —
  it is load-bearing, and "cleaning it up" would reintroduce a solvency bug.
- The dead `PositionIndexInUse` error was removed; `VaultReserveMissing` was
  repurposed for VISE-08.
- `accept_admin` now rejects a default `pending_admin`.
- No `mint_authority` check: deliberate. A live mint authority can dilute a coin
  but cannot touch locked principal, and requiring a revoked one would exclude
  every coin still on its bonding curve.

## Post-deployment review — 2026-09-24

A second pass over the live program found three economic issues. All are fixed
in the upgrade without any account-layout change: `Pool`, `Position` and
`Config` keep every field, in order, at the same size, so existing mainnet
accounts deserialise unchanged. Each fix has a regression test in
`describe("audit regressions")`.

### R02 — Medium — forfeited rewards bypassed the stream

`early_unlock` handed the exiting position's unclaimed rewards to the remaining
lockers through `credit_lockers`, jumping `acc_reward_per_weight` in one step.
That reopened the timing attack VISE-02 closed for inflow: a sniper locking a
large bag in the same bundle as a big early exit took a pro-rata slice of the
forfeit for one slot of exposure.

*Fixed:* `Pool::forfeit` adds the forfeited lamports to `undistributed` and
restarts the stream, so they are released over `reward_stream_secs` like any
inflow. `last_vault_balance` is untouched (the lamports never move) and
`lifetime_inflow` is untouched (nothing arrived). `lifetime_rewards` gives the
forfeit back when it enters the stream and counts it again when the stream
releases it, so `lifetime_rewards + reward_remainder + undistributed` stays equal
to every lamport ever routed to lockers; it can dip by the forfeit for up to one
window. With no weight left, the forfeit still goes to the treasury.

### R03 — Medium — `increase()` kept the original penalty basis

`increase` left `lock_start` alone, so the early-exit penalty on added principal
was computed over the position's original term. Topping up a year-long lock a
week before it ends and exiting at once burned ~0.5% instead of the 25% a fresh
week-long lock pays — a cheap way to buy multiplier weight with an exit option.

*Fixed:* `increase` moves `lock_start` to `math::blended_lock_start`. With old
principal `A` over term `T`, top-up `B` and time left `R`, the new term `T'`
satisfies

    (A + B) / T' = A / T + B / R
    lock_start' = lock_end - floor((A + B) * T * R / (A * R + B * T))

Because the penalty is linear in time remaining, the combined penalty at every
later moment equals the old position's penalty plus that of a fresh lock of `B`
over `R` — the existing principal's basis is exactly preserved. The plain
amount-weighted average of the two start times was rejected: it under-charges
the top-up whenever `T > R`: with a 1:1 top-up a week before the end of a
year-long lock, exiting at once would burn ~1.1% of the position instead of
~12.7% (25% of the top-up plus ~0.5% of the old principal). `T'` rounds down,
so rounding only ever raises the penalty, and
`lock_start <= lock_start' <= now < lock_end` holds.

### R04 — Low — matured unlock could pay principal into a stray account

The permissionless matured `unlock` accepted any token account whose owner field
was the position's owner. A third party could create such an account at an
address of their choosing and close the victim's lock into it; the tokens were
still the owner's, but in an account no wallet or the app ever displays.

*Fixed:* the `Unlock` accounts (shared by `unlock` and `early_unlock`) require
`owner_token_account` to be the owner's canonical associated token account for
`(mint, owner, token_program)`. The program does not create it —
`init_if_needed` would have added an account and a crate feature to a live
instruction — so it must exist; the SDK's `unlockInstructions` prepends an
idempotent ATA create paid by `payer`, which keepers and the API use.

## Verified correct

Confirmed by reading the source and, where noted, asserted by tests:

- Solvency holds by construction: `distribute` rounds the pool's committed
  amount *up* from the scaled credit handed out while each position's claim
  rounds *down*, and `reward_debt` keeps the sub-lamport residue on the position.
  Asserted after every step of a randomised churn test.
- The reward vault can never be drained below rent-exemption.
- No admin path moves pool SOL or tokens. The only signers over a pool's funds
  are the vault PDA (paying the locker, creator, or treasury that earned it) and
  the pool PDA (returning or burning locked tokens).
- Pause blocks only `create_pool`; claiming and unlocking are unpausable.
- Pool terms are written once at creation and never rewritten.
- Sync ordering is correct in every instruction, including `early_unlock`, which
  drops the exiting position's weight before streaming its forfeited rewards.
- Closed positions cannot be revived or double-claimed; a re-created position at
  the same seeds starts with a fresh credit line.
- Every arithmetic site is checked and returns an error rather than panicking;
  `overflow-checks = true` for release builds.
- Token-2022 handling is deny-by-default and fails closed on extensions the
  compiled library does not know about.
- No loop over caller-supplied data anywhere, so no compute-unit griefing.

## Accepted residual risks

- **`pool.treasury` is frozen per pool.** If the treasury key is ever rotated,
  existing pools keep paying the old address. This is the cost of immutability;
  use an address you can hold for years — a multisig, not a hot wallet.
- **`trade_fee_bps` is advisory.** The 2% app fee is enforced by the API when it
  builds a transaction, not by the program; anyone can trade on pump directly
  without paying it. The transaction-building service is therefore
  revenue-critical infrastructure.
- **Tokens sent directly to a pool's token vault are unrecoverable.** Adding a
  sweep would mean adding an admin token-movement path, which is exactly the
  thing the design refuses to have.
- **Position enumeration is off-chain only.** Nothing bounds how many positions a
  wallet opens, so the indexer must paginate.
