# Runbook

## Program deployment

The program is identical on every cluster: `VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb`.
The keypair lives at `target/deploy/vise-keypair.json` — back it up; losing it
means the program can never be upgraded again under that address.

### Devnet

```bash
anchor build                                  # produces target/deploy/vise.so
solana balance -u devnet                      # deploy needs ~4 SOL for a 474KB program
anchor deploy --provider.cluster devnet
node --env-file=apps/api/.env.devnet apps/api/scripts/init-config.ts
```

> **Currently blocked:** the deploy wallet
> `MZRpiuK2Lyc5SKNXaqBitbmNafou66EvuGYMKdQ6DEu` holds 0 SOL and every public
> devnet faucet is rate-limiting this IP. Fund it with ~5 SOL and the deploy is a
> single command. Everything downstream is already verified against the same
> program binary on a local validator carrying the real pump.fun programs.

### Mainnet checklist

Do not skip an item because the previous one passed.

1. `cargo test -p vise --lib` — reward math.
2. `node --test packages/sdk/test/vise.test.ts` — full instruction surface.
3. `node apps/api/scripts/e2e.ts` against `scripts/localnet.sh` — end to end
   with the real pump programs.
4. Independent audit of `programs/vise/src/`. `docs/AUDIT.md` records the
   internal pass; an external one is still required before real money.
5. Build reproducibly and publish the verification:
   `solana-verify build && solana-verify verify-from-repo`.
6. Deploy with the upgrade authority set to a Squads multisig, never a hot key.
7. `initialize_config` with the **multisig** as admin and the treasury set to a
   cold address.
8. Launch one throwaway coin with a small dev buy. Trade it, lock, claim,
   unlock. Confirm every number matches what the UI predicted.
9. Only then announce.

### Upgrade authority

```bash
solana program set-upgrade-authority VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb \
  --new-upgrade-authority <SQUADS_VAULT>
```

Burning the authority entirely (`--final`) is the end state, once the program has
run untouched for a meaningful period. Until then a multisig is the honest
middle ground: say which it is, publicly, and do not claim immutability you do
not have.

## What is deployed

| Piece | Where | State |
|---|---|---|
| API | https://api-production-885d.up.railway.app | live, `/health` green |
| Web | https://web-production-3100c.up.railway.app | live |
| Postgres | Railway private network | live, migrated |
| Program | `VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb` | verified on a local validator carrying the real pump.fun programs; **not yet on devnet** |

### Why the images are pushed, not built on Railway

Railway's Metal builder rejects every build in this project within a second and
emits no log, including a three-line Dockerfile that builds fine locally. Rather
than wait it out, both services deploy from prebuilt images:

```bash
docker build -f apps/api/Dockerfile -t ghcr.io/realdoomsman/vise-api:latest .
docker push ghcr.io/realdoomsman/vise-api:latest

docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api-production-885d.up.railway.app \
  --build-arg NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com \
  -t ghcr.io/realdoomsman/vise-web:latest .
docker push ghcr.io/realdoomsman/vise-web:latest
```

Railway redeploys on push. The web app's `NEXT_PUBLIC_*` values are baked into
the client bundle at build time, so changing the API URL means rebuilding the
image, not editing a variable. If the builder starts working, the Dockerfiles
are unchanged and `railway up` will use them directly.

## Services

One API image, two roles, chosen by `ROLE`:

| Service | `ROLE` | Runs | Health |
|---|---|---|---|
| `api` | `index` (default) | HTTP. Safe to scale out. | `GET /health` → `{ok, slot, cluster}` |
| `indexer` | `indexer` | Read model, reconciler, **keeper**. Must stay at one replica. | logs `indexer running`; `indexer_cursor.slot` advancing; `keeper_runs` growing when there is volume |
| `web` | — | `next start` | `GET /` |

The migration is idempotent and runs on every boot of either role, so a fresh
database self-provisions.

The indexer is not optional. Without it `pools` never populates and nothing
cranks; the API would serve an empty catalogue over a live program.

### Environment

**API and indexer** (both roles read the same set)

| Variable | Purpose |
|---|---|
| `ROLE` | `index` or `indexer` |
| `DATABASE_URL` | Postgres. On Railway: `${{Postgres.DATABASE_URL}}` |
| `RPC_URL` | Solana RPC. A paid endpoint is required in production — the public one will rate-limit the indexer within minutes |
| `RPC_WS_URL` | Optional websocket override for log subscriptions |
| `TREASURY_PUBKEY` | Destination for the platform share |
| `TRADE_FEE_BPS` | App fee on routed swaps. Must match the on-chain config's advisory value |
| `CORS_ORIGINS` | Comma-separated; set to the web origin in production, not `*` |
| `KEEPER_KEYPAIR` | Indexer only. The CLI's JSON byte array or a base58 secret. Enables the keeper |
| `SWEEP_MIN_LAMPORTS` | Indexer only. Sweep a coin once this much waits at pump. Default 0.005 SOL |
| `KEEPER_INTERVAL_MS` | Indexer only. Default 60s |

**Web** (build args — they are inlined into the client bundle)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | API origin |
| `NEXT_PUBLIC_RPC_URL` | RPC the browser uses for balances and confirmations |

## The keeper

pump.fun pays a coin's creator fees into a vault and leaves them there until
someone calls `distribute_creator_fees_v2`. Nobody else has a reason to do that
promptly, so the indexer process does: every `KEEPER_INTERVAL_MS` it reads each
pool's pump vault (and, once an AMM pool exists, the AMM's WSOL vault), and for
any coin holding at least `SWEEP_MIN_LAMPORTS` sends one transaction —
`[transfer_creator_fees_to_pump_v2]?, distribute_creator_fees_v2, sync` —
signed by `KEEPER_KEYPAIR`. Each send is logged to `keeper_runs`.

What it costs: one transaction fee per sweep. The threshold is what keeps that
proportionate — a coin doing volume is swept every minute, a dead coin never.
The keeper refuses to send below 0.02 SOL of its own balance and logs a
warning instead; **keep the keeper wallet topped up** or fees pile up at pump
(safely — they are not lost, just not yet distributed).

Anyone can run the same crank without waiting: `POST /api/tx/sweep`. Neither
path can move funds anywhere other than the vault recorded on pump's sharing
config, which was made immutable at launch.

"Pending" figures in the UI do not depend on the keeper. The API projects every
pool to the current moment with the program's own stream arithmetic
(`projectSync` in the SDK, pinned to the program by a LiteSVM test), so a
locker sees what a claim would pay even if nothing has touched the pool for a
day.

Still manual: **`claim_treasury`** per pool moves the platform share out.
Weekly is fine.

## Incident playbook

**The indexer is behind.** Read models go stale; the app keeps working because
every number a user acts on is read from chain, not the database. Restart the
indexer; `discover()` and `reconcile()` rebuild state from accounts.

**RPC is failing.** Transaction building fails loudly with a 500. Swap `RPC_URL`
and restart. No on-chain state is affected.

**A pool looks wrong in the UI.** Compare against chain:
`node apps/api/scripts/curve-check.ts <mint>` and `vise.fetchPool(mint)`. The
chain wins; if they disagree, the indexer has a bug and the fix belongs there.

**Someone reports they cannot claim.** Check `accrued(weight, acc, reward_debt)`
for their position. `NothingToClaim` with a zero result is correct behaviour, not
a failure — it means every lamport owed to them has already been paid.

**Emergency.** There is no emergency withdraw, by design. The strongest available
action is `update_config { paused: true }`, which stops new pools and nothing
else. Existing pools keep paying out.
