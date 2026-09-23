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
| API | https://api.vise.fun (also api-production-885d.up.railway.app) | live, `/health` green |
| Web | https://vise.fun (also web-production-3100c.up.railway.app) | live |
| DNS | Porkbun, account `doomsyy` | `vise.fun` ALIAS, `www`/`api` CNAME → Railway edge |
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
| `CORS_ORIGINS` | Comma-separated; set to the web origin in production, not `*` |
| `KEEPER_KEYPAIR` | Indexer only. The CLI's JSON byte array or a base58 secret. Enables the keeper |
| `SWEEP_MIN_LAMPORTS` | Indexer only. Sweep a coin once this much waits at pump. Default 0.005 SOL |
| `KEEPER_INTERVAL_MS` | Indexer only. Default 60s |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | The "VISE web" OAuth client in Google Cloud project `vise-509508` |
| `GOOGLE_REDIRECT_URI` | Must equal an authorised redirect URI on that client, byte for byte. Production: `https://api.vise.fun/api/auth/google/callback` |
| `SITE_ORIGIN` | Where the browser is sent after sign-in. Production: `https://vise.fun` |
| `SESSION_SECRET` | 32 random bytes, hex. Signs session cookies and OAuth state. Rotating it signs everyone out |
| `WALLET_MASTER_KEY` | 32 random bytes, hex. Encrypts account wallet keys at rest. **Losing it loses every account wallet.** Back it up outside Railway; never rotate without re-encrypting |
| `COOKIE_SECURE` | `1` in production (cookies `Secure; SameSite=None`), `0` on plain-http localhost |

The treasury address and trade fee are **not** environment: the program pins
them in `Config` and the API reads them from chain (`chainConfig()`), so they
cannot drift from what the program will accept.

**Web** (build args — they are inlined into the client bundle)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | API origin. Must be same-site with the web origin (`api.vise.fun` under `vise.fun`) or browsers treat the session cookie as third-party and drop it |
| `NEXT_PUBLIC_RPC_URL` | RPC the browser uses for balances and confirmations |
| `NEXT_PUBLIC_CLUSTER` | `devnet` or `mainnet-beta`; explorer links |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same client ID as the API |

## Accounts (Google sign-in)

A Google sign-in creates a row in `accounts` with a freshly generated Solana
keypair, encrypted with `WALLET_MASTER_KEY` (AES-256-GCM, nonce per row).
The flow is the plain authorization-code redirect: `/api/auth/google/start`
→ Google → `/api/auth/google/callback` (state is a signed JWT, its nonce
echoed in a short-lived cookie) → session cookie `vise_session` (HS256, 7d)
→ back to the site. Google's ID token is verified against Google's JWKS with
the client ID as audience before an account is touched.

Every account action (`/api/me/action`, `/me/launch`, `/me/withdraw`) uses
the same builders as the wallet-adapter path and signs with the account's key
server-side; each is written to `account_actions` with its signature or the
error. `/me/export-key` returns the base58 secret and logs the export.

**Launches that stop partway.** Every launch is three or four transactions.
If one fails after `create_v2` landed, the coin exists and the account owns
it; the API answers with `resume: <mint>` and the form offers to finish
that coin. The finish stage is idempotent: it skips the dev buy if the wallet
already holds the coin, the pool if it exists, the routing if the sharing
config exists. `POST /api/me/launch { resume }` can also be called by hand.

**Operational rules**

- Back up `WALLET_MASTER_KEY` the moment it is set. The database alone cannot
  recover a wallet.
- Nothing in the API can refuse a withdrawal or an export: the wallet is the
  user's. Do not add such a path.
- Deleting an account: have the user withdraw or export first, then
  `DELETE FROM account_actions WHERE account_id = $1; DELETE FROM accounts WHERE id = $1`.
- Google console: `https://console.cloud.google.com/auth/clients?project=vise-509508`.
  Authorised origins and redirect URIs must include every deployed host.

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

## Media

`scripts/render-video.sh` regenerates the score (`video/audio/score.py`,
Windows Python + numpy) and renders the three videos; `render-cards.sh`
renders the twenty feed stills from `video/src/cards.ts`;
`render-profile.sh` renders the X avatar, banner and the site's
`opengraph-image.png` (copy it into `apps/web/app/`). All run under WSL
against a headless shell installed once into `~/.cache/vise-browser`.

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
