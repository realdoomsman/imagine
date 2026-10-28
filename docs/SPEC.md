# Mechanism & Architecture Spec

Status: implemented and tested on LiteSVM against the real mainnet Raydium
LaunchLab, CPMM and Token-2022 builds, and end to end on a mainnet fork. Not yet
deployed. Brand: `docs/BRAND.md`. Security review: `docs/AUDIT.md`. Operations:
`docs/RUNBOOK.md`.

## 1. The product in one paragraph

A lock-to-earn layer for coins launched on StonkFun, the Solana launchpad where
every coin is paired with ("priced in") an asset: a tokenized stock (xStocks
such as NVDAx, SPYx, TSLAx), a stablecoin, SOL or another quote. A coin launched
through imagine.fun is created on StonkFun's Raydium LaunchLab platform, so it
trades and shows up wherever StonkFun coins do. Every trade routed through the
site pays a 1% app fee into a per-coin vault, and StonkFun's forwarded creator
share lands in the same vault. Holders lock for 4 hours to 365 days; longer
commitment means more weight, and weight decides each locker's share of what
flows through the vault — paid in the coin's pair asset. Rewards are claimable
at any time without unlocking, and nothing depends on the creator continuing to
exist.

## 2. Where the money comes from

Every stream is denominated in the coin's **quote mint** and lands in one vault
per coin:

1. **App fee.** A `deposit_reward(amount, kind)` instruction appended to the
   swap, in the same transaction: 1% of the quote leg by default
   (`trade_fee_bps = 100`, admin-adjustable up to 10%). Enforced by the API that
   builds the transaction, not by the program — trading on StonkFun, Raydium or
   an aggregator directly bypasses it. `kind` is 0 buy fee, 1 sell fee,
   2 creator share, 3 donation; it only labels the event.
2. **StonkFun creator share.** StonkFun charges a 1% platform fee on curve
   trades (the on-chain creator rate is 0%) and forwards a creator share
   off-chain to the LaunchLab pool's `creator`. `launch` makes that creator the
   pool's reward vault PDA, so forwards arrive directly: native SOL on the vault
   for SOL-quoted coins, quote tokens in the vault's associated token account
   otherwise. The amount and timing are StonkFun's policy; IMAGINE neither
   controls nor promises them.
3. **Donations.** Anyone may `deposit_reward`, or simply transfer to the vault.

IMAGINE never relies on an instruction to tell it money arrived. `sync` compares
the vault's distributable balance with `last_vault_balance` and treats the
difference as inflow, so every stream is credited the same way.

Raydium LaunchLab's protocol fee also applies to curve trades; it is Raydium's.

## 3. Reward mechanics

### Weight

```
progress(d)   = (d - min_lock) / (max_lock - min_lock)
duration(d)   = 1.0 + (max_multiplier - 1.0) × √progress(d)      # CURVE_SQRT
              = 1.0 + (max_multiplier - 1.0) × progress(d)       # CURVE_LINEAR
size_bonus    = highest tier cleared by amount / total_supply, else 0
multiplier    = duration(d) × (1 + size_bonus)
weight        = amount × multiplier
```

Both factors are frozen on the pool. The shipped defaults use the square-root
curve: 4 hours is 1.0×, 1 day 1.14×, 7 days 1.41×, 30 days 1.86×, 90 days
2.49×, 180 days 3.11×, 365 days 4.0×. Size tiers are measured against total
supply (never the pool, so no other locker can move yours): +10% at 0.1% of
supply, +25% at 0.5%, +50% at 1%. The combined ceiling is validated against the
10.0× bound the accumulator's overflow analysis assumes. `increase` re-tiers on
the new amount and reprices on the term still to run; `extend` reprices duration
and keeps the tier.

The square root is computed in integers as `isqrt(t × T) / T`; the SDK carries
the same `isqrt`, and a LiteSVM test asserts the two agree on real positions.

### Release

Fees do **not** land on lockers the instant they arrive. Each inflow is split by
the pool's frozen terms, and the lockers' share enters `undistributed`, which
pays out linearly over `reward_stream_secs` (default 1 hour, shorter than the
4-hour minimum lock, so every locker holds through the whole release of what
arrived while they were in). New arrivals reprice the stream so a steady fee
flow becomes a steady payout.

Without the stream, a share would be decided by weight held at one instant:
anyone could watch the vault fill — StonkFun's forwards arrive with no
instruction at all — lock a large bag, sync, claim a slice of a backlog they
were never present for, and leave. With it, a share is earned by weight *held
over time*.

### Accounting

```
SCALE = 1e12

acc_reward_per_weight += released × SCALE / total_weight     (released in quote base units)
claimable(position)    = (weight × acc - reward_debt) / SCALE
```

`reward_debt` is carried in scaled units, keeping each position's sub-unit
residue. The pool rounds its committed amount *up* from the credit it hands out
while each position's claim rounds *down*, so the sum of claims can never exceed
what was set aside. With nothing locked there is nobody to pay, so the lockers'
share goes to the treasury rather than parking in a pot the next minimum-size
lock could take whole.

### Earnings limits

Every lock is capped:

```
reward_cap = quote value of the tokens when locked × multiplier
```

The value (`price.rs`) is read on chain from the venue the coin trades on:

- **On the curve** (LaunchLab `PoolState` status 0 or 1): constant-product spot
  on virtual + real reserves, `(virtual_quote + real_quote) / (virtual_base −
  real_base)`. The account is pinned to `pool.launchlab_pool`, its owner must be
  LaunchLab and its discriminator is checked.
- **Migrated** (status 2): remaining accounts are the CPMM `PoolState` and its
  two vaults. The pool must hold exactly (coin, quote), be the canonical CPMM PDA
  `["pool", amm_config, token0, token1]` for its own `amm_config`, and the vault
  keys must match the pool state. Price = quote vault / coin vault, net of fees
  parked in the vaults.

`increase` adds the new tokens' value at today's price times the repriced
multiplier; `extend` adds the whole bag's value today times any rise in the
multiplier. A claim pays at most `reward_cap − claimed`; the rest of what the
lock accrued is already in the vault and becomes `treasury_claimable`. A lock
paid to within `CAP_DUST` (1,000 quote base units) of its cap is retired: its
weight leaves the pool, so the locks still earning split what arrives.
`harvest` (anyone, pays the owner) is how the keeper retires locks the moment
they are due.

`reward_capacity` is what the open locks can still earn in total. An inflow's
lockers' share only joins the stream up to that room; everything beyond goes
straight to `treasury_claimable`, and a release is capped again in case locks left
mid-stream. A pool never holds more than its locks can use.

The price is spot and can be moved within a transaction. Moving it only moves a
lock's ceiling; the lock still earns its weight's share and nothing more, so the
most a manipulator gains is avoiding the ceiling, at the cost of a round trip
through the venue's fees.

### Exits

- **Matured.** Full principal, full accrued rewards, position closed. Callable
  by anyone: everything lands on the recorded owner, and letting a keeper sweep
  expired positions stops served-out locks from diluting people still committed.
- **Early.** Owner only. Accrued rewards are forfeited back into the stream for
  the remaining weight; a slice of principal is burned, linear in the fraction
  of term left unserved — 5%–50%, default 25% at full remaining term.
- **Renounce.** Owner only. Gives up the lock's earnings for good; tokens stay
  locked to the same end date.

Claiming never touches a lock, and a lock never blocks a claim.

### Two asset paths

| Quote | Rewards held as | Distributable balance | Payout |
|---|---|---|---|
| WSOL (SOL-paired coins) | native lamports on the reward vault PDA | lamports − `vault_reserve` | system transfer signed by the vault PDA |
| any other quote (USDC, xStocks, …) | `ATA(reward_vault, quote_mint, quote_token_program)`, the pool's `reward_token_account` | that account's amount | `transfer_checked` signed by the vault PDA to the recipient's quote ATA |

One helper reads the distributable balance and one pays out; every payout
instruction (`claim`, `harvest`, `claim_creator`, `claim_treasury`, `unlock`,
`early_unlock`) goes through them. The SDK prepends idempotent ATA creates for
recipients.

## 4. On-chain program

Program: `imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa` (crate `imagine`,
`programs/imagine`).

| Account | Seeds | Role |
|---|---|---|
| `Config` | `["config"]` | Platform defaults, treasury, `launchlab_platform`. Read by `launch` |
| `Pool` | `["pool", mint]` | One per coin; quote mint and program, LaunchLab pool, terms frozen at launch, `founded` |
| reward vault | `["vault", pool]` | System-owned PDA. Holds SOL rewards; signs payouts; **is the LaunchLab pool creator** |
| reward token account | ATA of the reward vault | Rewards for non-SOL quotes |
| token vault | `["token-vault", pool]` | Locked principal, pool PDA authority |
| `Position` | `["position", pool, owner, index]` | One lock |

| Instruction | Signer | Notes |
|---|---|---|
| `initialize_config` | upgrade authority | Once; gated on ProgramData |
| `update_config` / `transfer_admin` / `accept_admin` | admin | Bounded by hard ceilings; two-step handover |
| `launch` | creator | Inits the pool, funds the vault reserve, creates the reward token account for token quotes, charges `pool_creation_fee` in SOL, CPIs LaunchLab `initialize_with_token_2022` under `config.launchlab_platform` with the vault PDA as creator, then reads the new LaunchLab pool back. Refused while paused |
| `found` | creator, once | Opens the founding lock (position 0), values it, sets `founded` |
| `lock` / `increase` / `extend` | owner | Require `founded`; read the coin's price for the cap |
| `claim` | owner | Never pausable; pays up to the cap |
| `harvest` | anyone | `claim` paid to the owner; retires a capped-out lock |
| `renounce` | owner | Irreversible; weight leaves, accrued rewards rejoin the stream |
| `unlock` | anyone | Matured only; pays the owner's canonical ATAs |
| `early_unlock` | owner | Forfeit + burn |
| `deposit_reward` | anyone | Requires `founded`; app fee leg or donation, in the quote |
| `sync` / `claim_treasury` | anyone | Permissionless cranks; `sync` is a no-op before founding |
| `claim_creator` | pool creator | Only if the pool opted into a creator share |

Guarantees, as properties of the bytecode rather than policy: no admin path to
pool funds; terms immutable after launch; claims and unlocks unpausable;
creator locks first; coins created only under the configured StonkFun platform;
the coin must be exactly LaunchLab's Token-2022 shape (metadata pointer and
metadata in the mint, no freeze authority, no transfer fee, no hook, no
permanent delegate); a quote mint must have no transfer fee (or authority to set
one), no transfer-hook program, no frozen-by-default accounts, and be
transferable.

## 5. Launch ordering

One v0 transaction with the launch address lookup table (`LAUNCH_ALT`):

1. `imagine.launch` — the pool, the vault and the LaunchLab curve exist, with
   the vault as the curve's creator and the client-generated mint keypair as
   the coin. Curve parameters (supply, total sell, fund raising, migrate type)
   come from StonkFun's pricing API so StonkFun's curve rule accepts them.
2. LaunchLab `buy_exact_in` by the creator — the dev buy. The creator holds no
   coins until this lands.
3. `imagine.found` — the founding lock, valued on the curve just bought into.

Without the table the three exceed the packet limit and the API splits the
launch, exposing the dev buy to anyone buying in between. Until `found` lands,
nobody can lock or deposit; anything forwarded to the vault in the meantime is
inflow on the first sync after founding.

## 6. Off-chain

```
apps/web        Next.js, Tailwind v4, wallet-adapter, "Imagine the chart" hero
apps/api        Fastify: StonkFun pricing/pairs, LaunchLab + CPMM trade builders, read models, indexer, keeper
packages/sdk    PDAs, decoders, LaunchLab/CPMM math + builders, ImagineClient, math mirror
video/          Remotion films and cards
```

The API builds transactions; the wallet signs (or, for Google accounts, the
API signs with the account's server-held key). Buyers paying in SOL for a
non-SOL-paired coin get an optional Jupiter SOL→quote swap prefixed to the
trade. The chain stays authoritative for every number a user acts on — Postgres
is a read model for lists, charts and leaderboards, rebuilt from program events
with a reconciler that re-reads pool accounts.

Amounts in the API are quote base units; USD figures are derived from Jupiter
prices and are display only. APR is trailing realised fees over locked value.
Nothing is projected.

## 7. Defaults

| Parameter | Value | Bound |
|---|---|---|
| App fee (`trade_fee_bps`) | 1% | ≤ 10% |
| Treasury share | 10% of inflow | ≤ 30% |
| Creator share | 0% — platform ceiling is zero | ≤ 30% of post-treasury |
| Lock window | 4 hours – 365 days | 1 hour – 4 years |
| Duration curve | square root (`CURVE_SQRT`) | linear or sqrt |
| Max duration multiplier | 4.0× | 1.0×–10.0× |
| Size tiers | +10% at 0.1% of supply, +25% at 0.5%, +50% at 1% | ≤ +100% each; combined ceiling ≤ 10.0× |
| Early exit penalty | 25% | 5%–50% |
| Reward stream | 1 hour | 1 hour – 7 days |
| Min lock | 1 token (coins have 6 decimals) | ≥ 1 whole token |
| Pool creation fee | 0.05 SOL, in SOL whatever the quote | ≤ 5 SOL |
| LaunchLab platform | StonkFun `4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7` | admin-settable; checked at each `launch`, not stored on pools |
