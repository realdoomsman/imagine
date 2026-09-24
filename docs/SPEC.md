# Mechanism & Architecture Spec

Status: v1.0 — implemented, tested, and verified end to end against the real
pump.fun programs on a local validator. Brand: see `docs/BRAND.md`. Security
review: `docs/AUDIT.md`. Operations: `docs/RUNBOOK.md`.

## 1. The product in one paragraph

A lock-to-earn layer on top of pump.fun. Coins launch on pump.fun normally,
through our site. Every trade routed through the site pays an adjustable app fee
(default 2%), and the coin's pump.fun creator fees are permanently redirected to
the same place: a per-coin vault. Holders lock tokens for 4 hours to 365 days. Longer
commitment means more weight, and weight decides your share of the SOL flowing
through that vault. Rewards are claimable at any time without unlocking, and
nothing depends on the creator continuing to exist.

Inspired by Printr V2's "Proof of Belief" (7–180d locks, duration multipliers,
creator must stake). Printr shut down 2026-08-31.

## 2. Where the money comes from

Two streams, both SOL, both landing in one vault per coin:

1. **App fee.** A `deposit_reward` instruction appended to the swap, in the same
   transaction. 2% of the SOL leg by default, admin-adjustable 0–10%. Enforced
   by the API that builds the transaction, not by the program — trading on pump
   directly bypasses it, which is true of every terminal.

2. **pump.fun creator fees.** At launch the coin opts into pump's fee-sharing
   program with the lock pool's vault as the sole shareholder.
   `update_fee_shares_v2` revokes its own admin, so the routing is permanent:
   neither the creator nor VISE can redirect it afterwards. The permissionless
   `distribute_creator_fees_v2` pushes accrued fees to the vault directly.

VISE never CPIs into pump. The vault is an ordinary address that pump pays, and
the pool detects arrivals by balance difference — so donations, and any future
stream, work with no code change.

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
2.49×, 180 days 3.11×, 365 days 4.0×. Front-loaded on purpose — even the
shortest lock earns, a month is worth making, a year still takes
the top. Size tiers are measured against total supply (never the pool, so no
other locker can move yours): +10% at 0.1% of supply, +25% at 0.5%, +50% at
1%. The combined ceiling is validated against the 10.0× bound the accumulator's
overflow analysis assumes. `increase` re-tiers on the new amount and reprices
on the term still to run; `extend` reprices duration and keeps the tier.

The square root is computed in integers as `isqrt(t × T) / T`; the SDK carries
the same `isqrt`, and a LiteSVM test asserts the two agree on real positions.

### Release

Fees do **not** land on lockers the instant they arrive. Each inflow is split by
the pool's frozen terms, and the lockers' share enters `undistributed`, which
pays out linearly over `reward_stream_secs` (default 1 hour, shorter than the
4-hour minimum lock, so every locker holds through the whole release of what
arrived while they were in). New arrivals
reprice the stream so a steady fee flow becomes a steady payout.

This is the property that makes the headline claim true. Without it, a reward
share is decided by weight held at one instant, and anyone could watch lamports
pile up, lock a large bag, claim a slice of a backlog they were never present
for, and leave. With it, a share is earned by weight *held over time*.

### Accounting

```
SCALE = 1e12

acc_reward_per_weight += released × SCALE / total_weight
claimable(position)    = (weight × acc - reward_debt) / SCALE
```

`reward_debt` is carried in scaled units, keeping each position's sub-lamport
residue. `distribute` rounds the pool's committed amount *up* from the credit it
handed out while each position's claim rounds *down*, so the sum of claims can
never exceed what was set aside. With nothing locked there is nobody to pay, so
the lockers' share goes to the treasury rather than parking in a pot that the
next minimum-size lock could take whole.

### Earnings limits

Pools created after limits shipped (`Pool::capped`) cap every lock:

```
reward_cap = SOL value of the tokens when locked × multiplier
```

The value is read on-chain from pump.fun: the bonding curve's virtual reserves,
or the canonical pump AMM pool's two vaults once the curve is complete.
`increase` adds the new tokens' value at today's price times the repriced
multiplier; `extend` adds the whole bag's value today times any rise in the
multiplier. A claim pays at most `reward_cap − claimed`; the rest of what the
lock accrued is already in the vault and becomes `treasury_claimable`. A lock
paid to within 1,000 lamports of its cap is retired: its weight leaves the
pool, so the locks still earning split what arrives. `harvest` (anyone, pays
the owner) is how the keeper retires locks the moment they are due.

`reward_capacity` is what the open locks can still earn in total. An inflow's
lockers' share only joins the stream up to that room; everything beyond goes
straight to `treasury_claimable`, and a release clamps again in case locks left
mid-stream. So a pool never holds more than its locks can use: surplus is the
treasury's the moment it arrives, not when the last lock ends. Older pools are
grown to the new layout by `migrate` and stay uncapped.

### Exits

- **Matured.** Full principal, full accrued rewards, position closed. Callable
  by anyone: everything lands on the recorded owner, and letting a keeper sweep
  expired positions stops served-out locks from diluting people still committed.
- **Early.** Owner only. Accrued rewards are forfeited and redistributed to the
  remaining weight; a slice of principal is burned, linear in the fraction of
  term left unserved — 5%–50%, default 25% at full remaining term.

Claiming never touches a lock, and a lock never blocks a claim.

## 4. On-chain program

Program: `VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb`

| Account | Seeds | Role |
|---|---|---|
| `Config` | `["config"]` | Platform defaults. Read only by `create_pool` |
| `Pool` | `["pool", mint]` | One vault per coin; terms frozen at creation |
| reward vault | `["vault", pool]` | System-owned PDA holding SOL |
| token vault | `["token-vault", pool]` | Locked principal, pool PDA authority |
| `Position` | `["position", pool, owner, index]` | One lock |

| Instruction | Signer | Notes |
|---|---|---|
| `initialize_config` | upgrade authority | Once; gated on ProgramData |
| `update_config` / `transfer_admin` / `accept_admin` | admin | Bounded; two-step handover |
| `create_pool` | coin creator | Verified against pump's `BondingCurve::creator`; requires a founding lock |
| `lock` / `increase` / `extend` | owner | `increase` reprices on remaining term; all three read the coin's price on a capped pool |
| `claim` | owner | Never pausable; pays up to the cap |
| `harvest` | anyone | `claim` paid to the owner; retires a capped-out lock |
| `renounce` | owner | Gives up the lock's earnings for good: weight leaves the pool, accrued rewards rejoin the stream for the other lockers, tokens stay locked to the same end date. Irreversible; the lock can no longer be grown or extended |
| `unlock` | anyone | Matured only; pays the owner |
| `early_unlock` | owner | Forfeit + burn |
| `deposit_reward` | anyone | App fee leg or donation |
| `sync` / `claim_treasury` | anyone | Permissionless cranks |
| `claim_creator` | pool creator | |
| `migrate` | anyone | Grows a pre-limits pool or position to the current layout; idempotent |

Guarantees, as properties of the bytecode rather than policy: no admin path to
pool funds; terms immutable after creation; claims and unlocks unpausable;
creator locks first; hostile mints (freeze authority, transfer fee, hook,
permanent delegate, non-transferable) rejected.

## 5. Launch ordering

Load-bearing, because each step depends on state the previous one creates:

1. `create_v2` — the mint and bonding curve must exist.
2. Dev buy — the creator holds no coins until this lands, and a pool cannot open
   without their founding lock.
3. `create_pool` — reads `BondingCurve::creator` to prove the signer launched
   the coin.
4. Fee sharing — **must** come after step 3, because it rewrites
   `BondingCurve::creator` to the sharing config PDA. The same transaction seeds
   pump's new creator vault above the rent floor, or the first small trade on
   the coin would be rejected for leaving that account rent-paying.

## 6. Off-chain

```
apps/web        Next.js 15, Tailwind v4, wallet-adapter, canvas hero
apps/api        Fastify: transaction builders, read models, indexer
packages/sdk    PDAs, decoders, instruction builders, math mirror
video/          Remotion promo renders
```

The API builds transactions and never holds a key; the wallet is the only
signer. The chain stays authoritative for every number a user acts on — Postgres
is a read model for lists, charts and leaderboards, rebuilt from program events
with a slow reconciler that re-reads pool accounts so a dropped websocket frame
cannot leave it permanently wrong.

APR is trailing realised fees over locked value. Nothing is projected.

## 7. Defaults

| Parameter | Value | Bound |
|---|---|---|
| App fee | 2% | ≤ 10% |
| Treasury share | 10% of inflow | ≤ 30% |
| Creator share | 0% — platform ceiling is zero | ≤ 30% of post-treasury |
| Lock window | 4 hours – 365 days | 1 hour – 4 years |
| Duration curve | square root (`CURVE_SQRT`) | linear or sqrt |
| Max duration multiplier | 4.0× | 1.0×–10.0× |
| Size tiers | +10% at 0.1% of supply, +25% at 0.5%, +50% at 1% | ≤ +100% each; combined ceiling ≤ 10.0× |
| Early exit penalty | 25% | 5%–50% |
| Reward stream | 1 hour | 1 hour – 7 days |
| Min lock | 1 token | ≥ 1 whole token |
| Pool creation fee | 0.05 SOL | ≤ 5 SOL |
