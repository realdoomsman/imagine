# Mechanism & Architecture Spec

Status: program deployed on mainnet (`imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa`);
this document describes the upgrade that moves launches onto IMAGINE's own Raydium
LaunchLab platform and adds `collect_creator_fee`. Tested on LiteSVM against the real
mainnet Raydium LaunchLab, CPMM and Token-2022 builds, and end to end on a mainnet
fork. Brand: `docs/BRAND.md`. Security review: `docs/AUDIT.md`. Operations:
`docs/RUNBOOK.md`.

## 1. The product in one paragraph

A lock-to-earn layer for coins launched on Raydium LaunchLab under the IMAGINE
platform. Every coin is paired with ("priced in") an asset LaunchLab supports —
SOL, USDC, tokenized stocks such as NVDAx and SPYx. Every trade of the coin,
anywhere, pays a 0.5% on-chain trading fee that LaunchLab routes to the coin's
pool; trades through imagine.fun add a 1.5% app fee into the same pool, so 2% of
an imagine.fun trade reaches the pool. Holders lock for 4 hours to 365 days;
longer commitment means more weight, and weight decides each locker's share of
what flows through the pool — paid in the coin's pair asset. The creator earns
nothing from fees; they earn only by locking, like everyone else. Rewards are
claimable at any time without unlocking, and nothing depends on the creator
continuing to exist.

## 2. Where the money comes from

Every stream is denominated in the coin's **quote mint** and lands in one vault
per coin.

1. **LaunchLab creator fee (user-facing: the 0.5% on-chain trading fee).** The
   IMAGINE PlatformConfig sets `creator_fee_rate` to LaunchLab's maximum, 5,000
   millionths (0.5%; verified against the mainnet `raydium_launchpad.so`, 5,001 is
   rejected), and the platform fee `fee_rate` to 0. `launch` makes each LaunchLab
   pool's `creator` the IMAGINE pool's reward-vault PDA. So 0.5% of every curve
   trade — on Raydium, through Jupiter, any terminal or bot — accrues on chain to
   the coin's LaunchLab creator-fee vault `[vault PDA, quote_mint]`, claimable only
   by the vault PDA. `collect_creator_fee` (permissionless) moves it into the
   reward vault and syncs.
2. **CPMM creator fee after graduation.** The platform's `cpswap_config` is an
   open Raydium CPMM AmmConfig with a creator fee, and `platform_cp_creator` is
   unset, so `migrate_to_cpswap` makes the CPMM pool creator the LaunchLab
   creator — the vault PDA. `collect_creator_fee` collects those fees too. CPMM
   keeps a protocol share of its creator fee, set by the AmmConfig, so the
   pool receives the rest.
3. **App fee.** A `deposit_reward(amount, kind)` instruction appended to every
   swap the API builds: 1.5% of the quote leg (`trade_fee_bps = 150`,
   admin-adjustable up to 10%). Enforced by the API, not the program; trading
   elsewhere pays only the on-chain 0.5%. `kind` is 0 buy fee, 1 sell fee,
   2 creator share, 3 donation; it only labels the event.
4. **Donations.** Anyone may `deposit_reward`, or transfer to the vault.

Raydium's LaunchLab protocol fee (0.25%) also applies to curve trades; it is
Raydium's. On graduation the whole LP position is locked (`platform_scale` 100%,
`creator_scale` 0, `burn_scale` 0); its Fee-Key NFT goes to the platform NFT
wallet, the IMAGINE treasury.

IMAGINE never relies on an instruction to tell it money arrived. `sync` compares
the vault's distributable balance with `last_vault_balance` and treats the
difference as inflow, so every stream is credited the same way.

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
4-hour minimum lock). New arrivals reprice the stream so a steady fee flow
becomes a steady payout.

Without the stream, a share would be decided by weight held at one instant:
anyone could watch creator fees pile up in LaunchLab's vault, lock a large bag,
collect, claim a slice of a backlog they were never present for, and leave. With
it, a share is earned by weight *held over time*.

### Accounting

```
SCALE = 1e12

acc_reward_per_weight += released × SCALE / total_weight     (released in quote base units)
claimable(position)    = (weight × acc - reward_debt) / SCALE
```

`reward_debt` is carried in scaled units, keeping each position's sub-unit
residue. The pool rounds its committed amount *up* from the credit it hands out
while each position's claim rounds *down*, so the sum of claims can never exceed
what was set aside. With nothing locked the lockers' share goes to the treasury
rather than parking in a pot the next minimum-size lock could take whole.

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
  two vaults. The pool must hold exactly (coin, quote), be the CPMM PDA
  `["pool", amm_config, token0, token1]` for its own `amm_config`, and have the
  pool's reward vault as `pool_creator`, which only LaunchLab's migration can
  set: anyone may open another pool for the pair under another AmmConfig at
  any price, and that one is refused. The vault keys must match the pool
  state. Price = quote vault / coin vault, net of fees parked in the vaults.

`increase` adds the new tokens' value at today's price times the repriced
multiplier; `extend` adds the whole bag's value today times any rise in the
multiplier. A claim pays at most `reward_cap − claimed`; the rest of what the
lock accrued becomes `treasury_claimable`. A lock paid to within `CAP_DUST`
(1,000 quote base units) of its cap is retired: its weight leaves the pool.
`harvest` (anyone, pays the owner) is how the keeper retires locks when due.

`reward_capacity` is what the open locks can still earn in total. An inflow's
lockers' share only joins the stream up to that room; everything beyond goes
straight to `treasury_claimable`, and a release is capped again in case locks
left mid-stream.

The price is spot and can be moved within a transaction. Moving it only moves a
lock's ceiling; the lock still earns its weight's share and nothing more.

### Exits

- **Matured.** Full principal, full accrued rewards, position closed. Callable
  by anyone; everything lands on the recorded owner.
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

LaunchLab and CPMM pay creator fees in WSOL for SOL-quoted coins;
`collect_creator_fee` receives them in the vault's WSOL ATA and closes it into
the vault, so they arrive as native lamports on the SOL path.

## 4. On-chain program

Program: `imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa` (crate `imagine`,
`programs/imagine`).

| Account | Seeds | Role |
|---|---|---|
| `Config` | `["config"]` | Platform defaults, treasury, `launchlab_platform` (the IMAGINE LaunchLab PlatformConfig). Read by `launch` |
| `Pool` | `["pool", mint]` | One per coin; quote mint and program, LaunchLab pool, terms frozen at launch, `founded` |
| reward vault | `["vault", pool]` | System-owned PDA. Holds SOL rewards; signs payouts and creator-fee claims; **is the LaunchLab (and later CPMM) pool creator** |
| reward token account | ATA of the reward vault | Rewards for non-SOL quotes; also the landing account for collected creator fees |
| token vault | `["token-vault", pool]` | Locked principal, pool PDA authority |
| `Position` | `["position", pool, owner, index]` | One lock |

| Instruction | Signer | Notes |
|---|---|---|
| `initialize_config` | upgrade authority | Once; gated on ProgramData |
| `update_config` / `transfer_admin` / `accept_admin` | admin | Bounded by hard ceilings; two-step handover |
| `launch` | creator | Requires the metadata `uri` to be exactly `https://api.imagine.fun/files/meta/<mint>.json` (`InvalidMetadataUri`), then inits the pool, funds the vault reserve, creates the reward token account for token quotes, charges `pool_creation_fee` in SOL, CPIs LaunchLab `initialize_with_token_2022` under `config.launchlab_platform` with the vault PDA as creator, then reads the new LaunchLab pool back. Refused while paused |
| `found` | creator, once | Opens the founding lock (position 0), values it, sets `founded` |
| `lock` / `increase` / `extend` | owner | Require `founded`; read the coin's price for the cap |
| `claim` | owner | Never pausable; pays up to the cap |
| `harvest` | anyone | `claim` paid to the owner; retires a capped-out lock |
| `renounce` | owner | Irreversible; weight leaves, accrued rewards rejoin the stream |
| `unlock` | anyone | Matured only; pays the owner's canonical ATAs |
| `early_unlock` | owner | Forfeits accrued rewards to the stream; burns the unserved share of the penalty, which is zero from the end date, so on a matured lock it returns every coin without moving quote (the way out when the quote's issuer blocks payouts) |
| `deposit_reward` | anyone | Requires `founded`; app fee leg or donation, in the quote |
| `collect_creator_fee` | anyone | See below; ends with an inline `sync` |
| `sync` / `claim_treasury` | anyone | Permissionless cranks; `sync` is a no-op before founding. A vault balance below the books (quote moved by the issuer) is absorbed: treasury share, then the stream, then the remainder, the rest recorded as `shortfall` and repaid from the next arrivals before they are split |
| `claim_creator` | pool creator | Only if the pool opted into a creator share (the platform ceiling is 0) |
| `set_auto_compound` | owner | Opt a lock in to (or out of) auto-compound; off by default, refused on renounced (`PositionRenounced`) and forever (`PositionLockedForever`) locks; renouncing clears it |
| `compound` | owner, or the IMAGINE keeper once opted in | See below |

### `collect_creator_fee`

Accounts: `payer` (signer; funds missing vault ATAs and receives the transient
WSOL account's rent back), `pool`, `reward_vault` (the PDA; signs the CPIs),
`mint`, `quote_mint`, `quote_token_program`,
`vault_quote_account` (`ATA(vault, quote)`), `creator_fee_vault` (LaunchLab
`[vault, quote_mint]`), `creator_fee_vault_authority`, `launchlab_program`, the
coin's token program, the associated-token and system programs. Once the coin
has migrated, remaining accounts: the CPMM pool state (canonical PDA, its
`pool_creator` must be the vault), CPMM authority, `amm_config`, the two token
vaults, the vault's coin ATA, the creator-fee-share PDA and the CPMM program.

Flow:

1. LaunchLab `claim_creator_fee`, signed by the vault PDA — skipped when the
   creator-fee vault is empty.
2. If migrated and fees are due: CPMM `collect_creator_fee`, signed by the
   vault PDA.
3. WSOL quote: close the vault's WSOL ATA into the vault's lamports (rent to
   `payer`), so the SOL path sees native lamports.
4. `sync` inline.

Every account is pinned or derived from the pool; the vault PDA signs only these
CPIs, `compound`'s buy and the program's own payouts.

### `compound`

"Hold → Earn → Buy → Lock → Repeat", opt-in per lock. Accounts: `payer`
(signer; the owner, or the IMAGINE keeper `KEEPER_AUTHORITY`
`6mgSanvKanCvzMnbyYa5dyWQGZ5wx36rSwybP1WTNh4M` once `Position.auto_compound`
is set — anyone else `NotKeeper`, the keeper on a lock not opted in
`CompoundNotEnabled`, the keeper with `min_tokens_out = 0`
`InvalidParameter`; fronts the transient WSOL account's rent and
gets it back), `owner`, `pool`, `position`, `mint`, `token_vault`,
`reward_vault` (signs the buy), `vault_quote_account` (`ATA(vault, quote)`:
the reward token account, or a transient WSOL account for SOL), `quote_mint`,
`quote_token_program`, the coin's token program, the associated-token and
system programs, `launchlab_pool`. Remaining accounts: on the curve, LaunchLab's
authority, global config, platform config, the curve's two vaults, event
authority, program, platform-fee and creator-fee vaults; once migrated, the
CPMM pool (canonical PDA, `pool_creator` = the vault), its coin and quote
vaults, authority, `amm_config`, observation and the CPMM program.

Flow, atomically:

1. `sync`, then settle the lock exactly as `claim` does: what it may be paid
   up to its cap counts as paid (`claimed`), any excess goes to the treasury.
   Below `MIN_COMPOUND_QUOTE` (1e6 quote base units, 0.001 SOL) it is
   refused (`CompoundTooSmall`).
2. Spend exactly that quote from the vault on the coin, delivered straight
   into the token vault: LaunchLab `buy_exact_in` on the curve, CPMM
   `swap_base_input` once migrated. The venue's normal trade fees apply (the
   0.5% creator fee lands back in the pool); no app fee.
3. Refuse (`CompoundSlippage`) a partial fill, fewer coins than
   `min_tokens_out`, or fewer than the quote at the venue's spot price before
   the buy less `COMPOUND_SLIPPAGE_BPS` (3%).
4. Add the coins to the lock as `increase` does: same unlock time, multiplier
   repriced on the term left (matured: `PositionMatured`; under the pool's
   minimum term: `InvalidDuration`), cap raised by the coins' value at that
   spot price. Emits `Compounded`.

The spot guard bounds the buy's own price impact; a price moved before the
transaction lands is caught by `min_tokens_out`, which the keeper sets 2% under
its live quote. Only the owner and the IMAGINE keeper may crank it, so no third
party can wrap a lock's buy in a sandwich. The quote never leaves the pool
except into the locker's own lock.

### Guarantees

Properties of the bytecode rather than policy: no admin path to pool funds;
terms immutable after launch; claims and unlocks unpausable; creator locks
first; coins created only under the configured platform with the vault as their
creator; the coin must be exactly LaunchLab's Token-2022 shape (metadata pointer
and metadata in the mint, no freeze authority, no transfer fee, no hook, no
permanent delegate); a quote mint must have no transfer fee (or authority to set
one), no transfer-hook program, no frozen-by-default accounts, and be
transferable.

## 5. The IMAGINE LaunchLab platform

Created once by `apps/api/scripts/setup-platform.ts` (LaunchLab
`create_platform_config`, PDA `["platform_config", admin]` under LaunchLab;
with the IMAGINE admin key that is `DYtCiTPJoqCyDApm45b9C7D3xotkSDecJaAtQHaQNULk`):

| Parameter | Value |
|---|---|
| `fee_rate` (platform fee) | 0 |
| `creator_fee_rate` | 5,000 millionths (0.5%), LaunchLab's maximum |
| `cpswap_config` | a CPMM AmmConfig with a creator fee, highest first (`--list-cpswap-configs`); rehearsed with CPMM index 16 `FMmwToGqT9iwDgsqvzLg65vcKSzKme4szbWqX1kyCBCJ` (trade 0.005%, creator 1.495%) |
| `platform_cp_creator` | unset, so the CPMM pool creator is the vault PDA |
| migration LP | `platform_scale` 100% (locked, Fee-Key NFT to the platform NFT wallet), `creator_scale` 0, `burn_scale` 0 |
| fee / NFT wallet | treasury `DNGM32EBgSwaG2Cj6NhYubzFHC8FTFopqgvPqp7ESY59` |
| name / web / img | IMAGINE / https://imagine.fun / https://imagine.fun/brand/imagine-512.png |

The platform does not restrict global configs or curve parameters; `launch`
still forwards the platform's allow-config and curve-rule PDAs as trailing
accounts whenever a configured platform does restrict them.

## 6. Launch ordering

One v0 transaction with the launch address lookup table (`LAUNCH_ALT`):

1. `imagine.launch` — the pool, the vault and the LaunchLab curve exist, with
   the vault as the curve's creator and the client-generated mint keypair as
   the coin. Curve parameters, chosen by the API: supply 1e15 base units
   (1e9 coins at 6 decimals), total sell 793,100,000,000,000 (79.31%), fund
   raising 85 SOL for SOL-quoted coins and, for other quotes, the USD value of
   85 SOL at launch (Jupiter), rounded and clamped to the GlobalConfig's
   minimum; migrate type CPMM.
2. LaunchLab `buy_exact_in` by the creator — the dev buy.
3. `imagine.found` — the founding lock, valued on the curve just bought into.

Without the table the three exceed the packet limit and the API splits the
launch, exposing the dev buy to anyone buying in between. Until `found` lands
nobody can lock or deposit.

## 7. Off-chain

```
apps/web        Next.js, Tailwind v4, wallet-adapter, "Imagine the chart" hero
apps/api        Fastify: pairs, LaunchLab + CPMM trade builders, read models, indexer, keeper, RPC proxy
packages/sdk    PDAs, decoders, LaunchLab/CPMM math + builders, quote registry, ImagineClient, math mirror
video/          Remotion films and cards
```

Launchable pairs are the SDK's quote registry (LaunchLab GlobalConfigs), priced
via Jupiter. The API builds transactions; the wallet signs (or, for Google
accounts, the API signs with the account's server-held key). Buyers paying in
SOL for a non-SOL-paired coin get an optional Jupiter SOL→quote swap prefixed
to the trade. The keeper cranks `collect_creator_fee` (or a plain `sync`) per
pool once the uncollected and unsynced value passes `SYNC_MIN_USD`. The chain
stays authoritative for every number a user acts on; Postgres is a read model.

Before a browser wallet is asked to sign, the web app checks the API's bytes
(`apps/web/lib/send.ts`, `assertTransactionAllowed`), so a compromised API
cannot redirect funds: only allowlisted programs and IMAGINE's user-facing
instructions; SOL and token transfers only into the signer's own accounts;
LaunchLab `buy_exact_in`/`sell_exact_in`, CPMM `swap_base_input` and Jupiter
`route`/`shared_accounts_route` paid from and into the signer's own token
accounts, on an IMAGINE coin's pool, with no share or platform fee; and, for a
trade, the input, the `deposit_reward` app fee and the minimum output held to
what the page showed (minimum output within slippage plus 30% of the spot
estimate). Swaps and fee deposits are refused in any transaction that is not a
trade or a launch. `set_auto_compound` and `compound` pass only for the
signer's own position (compound paid and owned by the signer, with a nonzero
minimum output within 30% of the page's estimate), each exactly once and only
when the page asked for it.

Coin links: `https://raydium.io/launchpad/token/?mint=<mint>`; after graduation
also `https://raydium.io/swap/?inputMint=<quote>&outputMint=<mint>`.

Amounts in the API are quote base units; USD figures come from Jupiter prices
and are display only. APR is trailing realised fees over locked value. Nothing
is projected.

## 8. Defaults

| Parameter | Value | Bound |
|---|---|---|
| App fee (`trade_fee_bps`) | 1.5% | ≤ 10% |
| On-chain trading fee (LaunchLab `creator_fee_rate`) | 0.5% | LaunchLab max 0.5% |
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
| LaunchLab platform | the IMAGINE PlatformConfig | admin-settable; checked at each `launch`, not stored on pools |
