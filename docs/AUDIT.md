# Security review — internal pass

Scope: `programs/imagine/src/` at the working tree of the upgrade that moves
launches onto IMAGINE's own Raydium LaunchLab platform and adds
`collect_creator_fee`. The deployed program
(`imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa`) is the lock-to-earn engine
reviewed earlier for its predecessor: the reward accumulator, stream, caps,
exits and admin model are carried over; the launch path, pricing, payouts and
creator-fee collection are new (LaunchLab and CPMM CPIs, LaunchLab/CPMM pricing,
quote-asset payouts). Earlier findings are kept below only where the fix is
still load-bearing, renumbered and re-scoped. New surfaces follow.

Method: manual read of the program source, every `address =` / `seeds =` /
`has_one` / `Signer` constraint traced, accounting invariants re-derived and
checked against the Rust unit tests and the LiteSVM suites, which run the real
mainnet LaunchLab, CPMM and Token-2022 builds (`tests/fixtures/raydium/`).

**This is an internal review. An independent external audit is still owed** —
see `docs/RUNBOOK.md`.

Regression tests: `describe("audit regressions")` in
`packages/sdk/test/imagine.test.ts`; launch, creator-fee collection and pricing
guards in `packages/sdk/test/raydium.test.ts`.

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

More acute here than before: the 0.5% creator fee piles up in LaunchLab's
creator-fee vault in public view, and anyone can call `collect_creator_fee`, so
a backlog is readable and its arrival is attacker-timed. *Enforced:* inflow is
streamed over `reward_stream_secs` (frozen per
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
  (`PlatformMismatch`) — the IMAGINE PlatformConfig on mainnet.
- GlobalConfig, authority, pool, vaults and event authority are validated by
  LaunchLab itself; the pool is then read back (IMG-04), including
  `creator == reward vault`, which is what routes the creator fee to the pool.
- If a configured platform restricts global configs or curve params, its
  allow-config and curve-rule PDAs are forwarded and LaunchLab enforces them.
  The IMAGINE platform restricts neither; curve parameters are chosen by the
  API, and LaunchLab rejects an invalid combination, failing the transaction.
- The metadata `uri` must be byte for byte
  `https://api.imagine.fun/files/meta/<mint base58>.json`
  (`METADATA_URI_PREFIX` + mint + `METADATA_URI_SUFFIX`, else
  `InvalidMetadataUri`), checked before anything is created, so every coin's
  mint points at the IMAGINE-hosted document whose website is its IMAGINE
  page. That document's contents are off chain and frozen by the API once the
  mint exists.
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

### N-04 — `collect_creator_fee`: LaunchLab and CPMM creator-fee CPIs

New and permissionless. It CPIs LaunchLab `claim_creator_fee` and, once the
coin has migrated, CPMM `collect_creator_fee`, then (WSOL quote) closes the
vault's WSOL ATA into the vault and runs `sync` inline. Checked:

- LaunchLab and CPMM program accounts are pinned to their mainnet ids.
- The creator-fee vault is derived (LaunchLab `[vault PDA, quote_mint]`), and
  the LaunchLab pool is pinned to `pool.launchlab_pool`.
- The CPMM pool must be the canonical PDA for its own `amm_config` holding
  (coin, quote), and its `pool_creator` must be the vault PDA; the vault keys
  must match the pool state.
- Destination accounts are the vault's own ATAs (`QuoteAccountMismatch`
  otherwise); nothing is paid to the caller except the transient WSOL account's
  rent, which the caller fronted.
- Collection only ever increases the vault's balance; it is credited by the
  same balance-diff `sync` as every other inflow, so a failed or partial CPI
  cannot desynchronise the books.

Residual: a LaunchLab or CPMM upgrade that changes these instructions' account
lists breaks collection (the CPI fails), not custody; fees stay claimable by
the vault PDA in Raydium's vaults until a program upgrade adapts.

### N-05 — The reward-vault PDA as a signer

The vault PDA now signs outside IMAGINE: LaunchLab `claim_creator_fee` and CPMM
`collect_creator_fee`, both of which can only move fees *to* accounts the vault
owns. Every signing site was traced: the PDA signs only those two CPIs, the
WSOL account close (destination: the vault), and IMAGINE's own payouts to the
locker, creator or treasury that earned them. No caller-supplied program id
ever receives the vault's signature.

### N-06 — Fee rates live in configs IMAGINE does not freeze

LaunchLab reads `creator_fee_rate` from the PlatformConfig at every trade
(verified in LiteSVM: changing the platform's rate on a live coin changed the
next trade's accrual), and CPMM reads its creator fee from the AmmConfig;
neither is frozen per IMAGINE pool. The IMAGINE program cannot change either.
LaunchLab has `update_platform_config`; whether it lets the platform admin (the
IMAGINE admin key) change `creator_fee_rate` was not verified, so treat it as
possible, within LaunchLab's cap of 0.5%. Raydium controls the AmmConfig.
Lowering a rate reduces
future inflow only; nothing already in a pool's vault or in Raydium's
creator-fee vault is affected. The fees are enforced on-chain by Raydium
LaunchLab, not by IMAGINE. The platform admin key should move to the same
multisig as the program's upgrade authority.

### N-07 — xStock issuer powers

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

### N-08 — Founding gate

Between `launch` and `found` the pool exists unfounded: `lock`, `increase`,
`extend` and `deposit_reward` require `founded` (`NotFounded`), `sync` is a
no-op, and `found` runs once, creator only (`AlreadyFounded`,
`NotPoolCreator`). The API sends all three in one v0 transaction; creator fees
accrued meanwhile (the dev buy pays them) are inflow on the first sync after
founding.

## Verified correct

- Solvency by construction in both asset paths: the pool rounds its committed
  amount up, each claim rounds down, `reward_debt` keeps the residue. Asserted
  after every step of a randomised churn test, SOL and SPYx.
- The SOL vault can never be drained below its reserve.
- No admin path moves pool funds. The only signers over a pool's funds are the
  vault PDA (paying the locker, creator or treasury that earned it, and pulling
  creator fees in — N-05) and the pool PDA (returning or burning locked tokens).
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
- **`trade_fee_bps` is advisory.** The 1.5% app fee is added by the API;
  trading on Raydium or through an aggregator pays only the on-chain 0.5%.
- **Fee rates are set in LaunchLab/CPMM configs** (N-06) and **xStock issuers
  hold powers over quote balances** (N-07).
- **The graduated LP is locked, not burned.** The liquidity stays locked; its
  Fee-Key NFT, which collects the LP's trading fees, goes to the treasury.
- **Tokens sent directly to a pool's token vault are unrecoverable.** A sweep
  would be an admin token-movement path.
- **Position enumeration is off-chain only.** The indexer must paginate.
