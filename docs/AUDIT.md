# Security review — internal pass

Scope: `programs/imagine/src/` at the pre-deployment working tree.
IMAGINE's program is the lock-to-earn engine reviewed earlier for its
predecessor, ported to StonkFun: the reward accumulator, stream, caps, exits
and admin model are carried over; the launch path, pricing and every payout are
new (LaunchLab CPI, LaunchLab/CPMM pricing, quote-asset payouts). Earlier
findings are kept below only where the fix is still load-bearing in this code,
renumbered and re-scoped. New surfaces follow.

Method: manual read of the program source, every `address =` / `seeds =` /
`has_one` / `Signer` constraint traced, accounting invariants re-derived and
checked against the Rust unit tests and the LiteSVM suites, which run the real
mainnet LaunchLab, CPMM and Token-2022 builds (`tests/fixtures/raydium/`).

**This is an internal review. An independent external audit is still required
before mainnet** — see `docs/RUNBOOK.md`.

Regression tests: `describe("audit regressions")` in
`packages/sdk/test/imagine.test.ts`; launch and pricing guards in
`describe("StonkFun launch guards")` and `describe("migrated coins")` in
`packages/sdk/test/stonkfun.test.ts`.

## Carried-over findings, still enforced

### IMG-01 — Critical — `increase()` on a matured position

A matured, unclosed position kept its multiplier, so topping it up minted
full-multiplier weight with no term left, then exited penalty-free.
*Enforced:* `increase` rejects a matured position (`ImagineError::PositionMatured`)
and reprices the whole position against the term still to run. `unlock` is
permissionless once matured, paying the recorded owner, and the keeper closes
matured positions so served-out locks stop diluting. `early_unlock` stays
owner-only.

### IMG-02 — High — inflow recognised at an attacker-chosen moment

More acute on StonkFun than before: forwarded creator shares arrive as plain
transfers with no instruction, so a backlog is readable from public state at
any time. *Enforced:* inflow is streamed over `reward_stream_secs` (frozen per
pool, 1 hour – 7 days, default 1 hour, shorter than the 4-hour minimum lock),
so weight created after funds arrive earns nothing from them.
`MIN_PENALTY_BPS = 500` keeps a floor under the exit cost.

### IMG-03 — High — remainder scoopable when nothing is locked

*Enforced:* with zero weight the lockers' share goes to the treasury instead of
parking for the next minimum-size lock.

### IMG-04 — High — anyone could open a pool for anyone's coin

Re-scoped. A pool can no longer be opened for an existing coin at all: `launch`
creates the coin itself, through a LaunchLab CPI, in the same instruction that
creates the pool, with the signer as the pool's creator. The pool PDA is
`["pool", mint]` and the mint is a fresh keypair that must sign, so there is
nothing to front-run. After the CPI the handler reads the LaunchLab `PoolState`
back and requires `base_mint`, `quote_mint`, `creator == reward vault` and
`platform_config == config.launchlab_platform`
(`ImagineError::InvalidLaunchLabAccount`).

### IMG-05 — Medium — `initialize_config` permissionless

*Enforced:* `InitializeConfig` takes the program and its ProgramData and
requires the signer to be the upgrade authority (`NotUpgradeAuthority`).

### IMG-06 — Low — unbounded accumulator growth at tiny weight

*Enforced:* `MIN_LOCK_AMOUNT_FLOOR` (one whole token; every LaunchLab coin has 6
decimals). The `SCALE` bound is now stated in quote base units: about 1e18 of
lifetime inflow into one pool (1e9 SOL, or 1e10 of an 8-decimal xStock) before
an overflow, which is rejected, not wrapped.

### IMG-07 — Low — `sync` absorbing an unexplained balance drop

*Enforced:* `sync` requires the distributable balance to be at least
`last_vault_balance` (`VaultAccountingMismatch`), in both asset paths.

### IMG-08 — Low — rent reserve

*Enforced:* the SOL vault reserve is funded at twice the rent-exempt minimum at
launch and excluded from the distributable balance.

### IMG-09 — Medium — forfeited rewards bypassed the stream

*Enforced:* `Pool::forfeit` puts an early exit's forfeited rewards into
`undistributed` and restarts the stream; with no weight left they go to the
treasury.

### IMG-10 — Medium — `increase()` kept the original penalty basis

*Enforced:* `increase` moves `lock_start` to `math::blended_lock_start`, so with
old principal `A` over term `T`, top-up `B` and time left `R`:

    (A + B) / T' = A / T + B / R
    lock_start' = lock_end - floor((A + B) * T * R / (A * R + B * T))

The combined penalty at every later moment equals the old position's plus a
fresh lock of `B` over `R`; rounding only raises it.

### IMG-11 — Low — matured unlock into a stray account

*Enforced:* `owner_token_account` must be the owner's canonical ATA for
`(mint, owner, token_program)`, and the quote payout goes to the owner's
canonical quote ATA. The SDK prepends idempotent ATA creates.

### Informational, still true

- `reward_debt` is `SCALE`-scaled, not base units. Load-bearing for solvency.
- `accept_admin` rejects a default `pending_admin`.
- `unlock` emits `Claimed`, so the final payout of a permissionless close is
  indexed.

## New surfaces

### N-01 — LaunchLab CPI in `launch`

`launch` invokes LaunchLab `initialize_with_token_2022` with the creator as
payer and the mint keypair as signer (both propagate) and the reward vault PDA
as a non-signing creator. Checked:

- The LaunchLab program account is pinned to `LAUNCHLAB_PROGRAM_ID`; Token-2022
  is pinned.
- `launchlab_platform` must equal `config.launchlab_platform`
  (`PlatformMismatch`), StonkFun's PlatformConfig on mainnet.
- GlobalConfig, authority, pool, vaults and event authority are validated by
  LaunchLab itself; the pool is then read back (IMG-04).
- When StonkFun's platform restricts global configs or curve params, the
  platform allow-config and curve-rule PDAs are forwarded and LaunchLab
  enforces them; curve parameters come from StonkFun's pricing API via the
  API, and a mismatch fails the whole transaction.
- No lamports or tokens owned by the pool move during the CPI; the vault PDA
  never signs it.

Residual: IMAGINE trusts LaunchLab's program at its mainnet address. A LaunchLab
upgrade that changes `PoolState` offsets breaks reads (they fail closed on owner,
discriminator and length) rather than corrupting accounts.

### N-02 — Pricing for the earnings cap (`price.rs`)

On the curve the `PoolState` is pinned to `pool.launchlab_pool`, owner and
discriminator checked. After migration the CPMM pool must be the canonical PDA
for its own `amm_config`, hold exactly (coin, quote), and its vault keys must
match; fees parked in the vaults are excluded. The price is spot and
manipulable within a transaction; manipulation only moves a lock's cap, never
its share of inflow, so the gain is bounded by avoiding the cap and costs a
round trip through venue fees. Accepted.

### N-03 — Quote-asset payouts

Rewards for a non-SOL quote sit in `ATA(reward_vault, quote_mint,
quote_token_program)`, recorded on the pool as `reward_token_account`; every
payout is `transfer_checked` signed by the vault PDA to the recipient's
canonical quote ATA. Every instruction that touches it checks the account,
mint and program against the pool (`QuoteAccountMismatch`). `launch` refuses a
quote mint with a transfer fee or a fee authority (`QuoteTransferFee`), an
active transfer-hook program (`QuoteHookActive`), frozen-by-default accounts or
non-transferability (`QuoteNotTransferable`), because any of them would make
the books disagree with the balance. Solvency is asserted by the churn test in
both the SOL and SPYx paths.

### N-04 — StonkFun's off-chain forwarding (trust assumption)

The creator share is forwarded by StonkFun off-chain to the LaunchLab pool's
`creator` — for IMAGINE coins, the reward vault. Nothing on chain obliges
StonkFun to forward, fixes the amount, or prevents it from changing its policy.
IMAGINE's correctness does not depend on it: forwards are simply inflow when
they arrive. Product copy must not promise amounts or timing. The keeper syncs
vaults once their unsynced balance passes `SYNC_MIN_USD`; anyone can `sync`.

### N-05 — xStock issuer powers

xStocks are Token-2022 mints carrying a PermanentDelegate, Pausable,
ScaledUiAmount, a TransferHook with only its authority set, a
DefaultAccountState authority and a freeze authority. These are accepted for
**quote** mints (never for the coin): the issuer could freeze or pause the
vault's token account, or move tokens out of it with the permanent delegate.
Effects: payouts of that quote stop (pause/freeze), or the vault holds less
than the books (delegate transfer) — then `sync` fails with
`VaultAccountingMismatch` and every payout of that pool stops until the
balance is restored. No other pool and no locked principal (the coin) is
affected. ScaledUiAmount changes only the UI amount; the program works in raw
base units. This is the issuer risk every xStock holder already carries;
lockers of an xStock-paired coin take it on for their rewards.

### N-06 — Founding gate

Between `launch` and `found` the pool exists unfounded: `lock`, `increase`,
`extend` and `deposit_reward` require `founded` (`NotFounded`), `sync` is a
no-op, and `found` runs once, creator only (`AlreadyFounded`,
`NotPoolCreator`). The API sends all three in one v0 transaction; anything
forwarded meanwhile is inflow on the first sync after founding.

## Verified correct

- Solvency by construction in both asset paths: the pool rounds its committed
  amount up, each claim rounds down, `reward_debt` keeps the residue. Asserted
  after every step of a randomised churn test, SOL and SPYx.
- The SOL vault can never be drained below its reserve.
- No admin path moves pool funds. The only signers over a pool's funds are the
  vault PDA (paying the locker, creator or treasury that earned it) and the pool
  PDA (returning or burning locked tokens).
- Pause blocks only `launch`; claiming and unlocking are unpausable.
- Pool terms are written once at launch and never rewritten.
- Every arithmetic site is checked; `overflow-checks = true` for release builds.
- Coin mints: exactly the Token-2022 shape LaunchLab creates passes; anything
  with a freeze authority (`FreezeAuthoritySet`) or another extension
  (`UnsupportedMintExtension`) fails. Quote mints are scanned by raw TLV type,
  so extensions newer than the linked `spl-token-2022` (ScaledUiAmount,
  Pausable) do not break parsing.
- No loop over caller-supplied data, so no compute-unit griefing.

## Accepted residual risks

- **`pool.treasury` is frozen per pool.** Rotating the treasury key leaves
  existing pools paying the old address. Use a multisig.
- **`trade_fee_bps` is advisory.** The 1% app fee is added by the API; trading
  on StonkFun, Raydium or an aggregator directly does not pay it.
- **StonkFun forwarding is off-chain** (N-04) and **xStock issuers hold
  powers over quote balances** (N-05).
- **Tokens sent directly to a pool's token vault are unrecoverable.** A sweep
  would be an admin token-movement path.
- **Position enumeration is off-chain only.** The indexer must paginate.
