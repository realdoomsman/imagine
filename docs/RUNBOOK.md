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

| Service | Start | Health |
|---|---|---|
| `vise-api` | `node src/migrate.ts && node src/index.ts` | `GET /health` → `{ok, slot, cluster}` |
| `vise-web` | `next start` | `GET /` |
| indexer | `node src/indexer.ts` | logs `indexer running`; watch `indexer_cursor.slot` advancing |

The migration is idempotent and runs on every API boot, so a fresh database
self-provisions.

### Environment

**API**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres. On Railway: `${{Postgres.DATABASE_URL}}` |
| `RPC_URL` | Solana RPC. A paid endpoint is required in production — the public one will rate-limit the indexer within minutes |
| `RPC_WS_URL` | Optional websocket override for log subscriptions |
| `TREASURY_PUBKEY` | Destination for the platform share |
| `TRADE_FEE_BPS` | App fee on routed swaps. Must match the on-chain config's advisory value |
| `CORS_ORIGINS` | Comma-separated; set to the web origin in production, not `*` |

**Web** (build args — they are inlined into the client bundle)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | API origin |
| `NEXT_PUBLIC_RPC_URL` | RPC the browser uses for balances and confirmations |

## Cranks

Two permissionless operations should run on a schedule so users never have to:

1. **`POST /api/tx/sweep`** per pool — pulls accrued pump.fun creator fees into
   the vault and syncs. Hourly is plenty; it is idempotent and cheap when there
   is nothing to sweep.
2. **`claim_treasury`** per pool — moves the platform share out. Weekly.

Both are ordinary transactions anyone can send. Neither can move funds anywhere
other than the address recorded on the pool.

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
