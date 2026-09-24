# Runbook

## Program deployment

The program is identical on every cluster: `VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb`.
The keypair lives at `target/deploy/vise-keypair.json` — back it up; losing it
means the program can never be upgraded again under that address.

### Deploying

```bash
bash scripts/anchor-build.sh                  # SBPF v3 binary: target/deploy/vise.so
bash scripts/deploy.sh devnet
bash scripts/deploy.sh mainnet-beta          # RPC from apps/api/.mainnet-rpc.tmp or $RPC_URL
bash scripts/keeper.sh mainnet-beta 0.05     # keeper key + funding; prints KEEPER_KEYPAIR pubkey
```

`deploy.sh` skips the deploy if the program already exists (unless `UPGRADE=1`) and always ends by
running `init-config.ts`, which is idempotent: it creates the config, or, if one
exists and differs from the SDK's `ECONOMICS`, sends one `update_config` (admin
signs; treasury and pause flag kept). It writes through a fixed buffer
keypair (`target/deploy/vise-buffer.json`), so a deploy interrupted by
congestion resumes on re-run instead of stranding rent in a new buffer. Needs
~3 SOL in the deploy wallet for a 560,000-byte program account.

**Upgrading.** `UPGRADE=1 bash scripts/deploy.sh mainnet-beta`. It builds
(unless `SKIP_BUILD=1`), writes the buffer (the binary's rent up front, about
2.7 SOL for ~527 KB, refunded when the upgrade lands), upgrades, then dumps the
program and refuses to continue unless its first `wc -c vise.so` bytes equal
the local binary. Then it runs `init-config.ts` to sync the config. Always
rebuild with `scripts/anchor-build.sh` first: it forces a recompile, because
the cached build has handed back a previous program before.

Before a mainnet deploy, run the end-to-end suite against pump.fun's **mainnet**
state: `CLUSTER_URL=<mainnet rpc> bash scripts/localnet-up.sh`, then
`bash scripts/e2e-loop.sh 3`.

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
| API | https://api.vise.fun (also api-production-885d.up.railway.app) | live on **mainnet-beta**, `/health` green |
| Indexer + keeper | Railway `indexer` service | live on mainnet; keeper `C1RhfARwh4XPoHj9xpubfgSzZs9V7NJcNGAT6RcAbbnW` (key in `apps/api/.keeper-mainnet.json`, gitignored) |
| Web | https://vise.fun (also web-production-3100c.up.railway.app) | live, built for mainnet |
| DNS | Porkbun, account `doomsyy` | `vise.fun` ALIAS, `www`/`api` CNAME → Railway edge |
| Postgres | Railway private network | live, migrated; devnet read models cleared at the mainnet cutover (accounts kept) |
| Program | `VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb` | **mainnet-beta**: sha256 `ab53ae5f…` (adds `renounce`), upgraded in slot 449993179 with `MAX_LEN=580000` (the program data was extended to 580,000 bytes for earnings limits, `8252b985…`, slot 449970607). The 2 pools and 7 positions that existed before limits were grown to the new layout by `scripts/migrate-accounts.ts` and stay uncapped; every pool created since is capped. Config: 4h–365d locks, 1h stream. Devnet still runs `5febae50…`. Upgrade authority, config admin and treasury: `MZRpiuK2Lyc5SKNXaqBitbmNafou66EvuGYMKdQ6DEu`, a hot key on the operator's machine — the owner's decision; move to a multisig with `set-upgrade-authority` / `transfer_admin` when one exists (treasury is frozen per pool) |
| RPC | Helius, key `vise` | API/indexer use the keyed URL (`apps/api/.mainnet-rpc.tmp`); the browser uses the keyless per-IP "secure" URL baked by `push-web.sh` |

### Why the images are pushed, not built on Railway

Railway's Metal builder rejects every build in this project within a second and
emits no log, including a three-line Dockerfile that builds fine locally. Rather
than wait it out, both services deploy from prebuilt images:

```bash
bash scripts/push-api.sh     # api + indexer image
bash scripts/push-web.sh     # web image; mainnet build args by default
railway redeploy --service api -y && railway redeploy --service indexer -y
railway redeploy --service web -y
```

Pushing does **not** redeploy; `railway redeploy` pulls `:latest`. The web
app's `NEXT_PUBLIC_*` values are baked into the client bundle at build time,
so changing the API or RPC URL means rebuilding the image, not editing a
variable. If the builder starts working, the Dockerfiles are unchanged and
`railway up` will use them directly.

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

What the indexer trusts: only events VISE itself emitted. Logs are parsed with
Anchor's `EventParser`, which follows the invoke stack, so a `Program data:`
line from another program or a Memo in the same transaction is ignored. Rows
are stamped with the transaction's time (block time on backfill, receipt time
live, never in the future), not the event's own timestamp; positions and pools
are re-read from their accounts rather than copied out of events. Transactions
are handled four at a time. Coin metadata is fetched only for mints with a
pool, only from IPFS (`ipfs://`, or `/ipfs/<cid>` on ipfs.io, Pinata or
cf-ipfs), always through `pump.mypinata.cloud` (ipfs.io as fallback), with no
redirects and a 64 KiB cap; image URLs are rewritten to that gateway and
social links kept only if they are http(s) URLs.

### Environment

**API and indexer** (both roles read the same set, except the auth secrets —
`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `WALLET_MASTER_KEY` — which only the
`api` service needs: they load on first use, so the indexer and the migration
never read them and should not be given them)

| Variable | Purpose |
|---|---|
| `ROLE` | `index` or `indexer` |
| `DATABASE_URL` | Postgres. On Railway: `${{Postgres.DATABASE_URL}}` |
| `RPC_URL` | Solana RPC. A paid endpoint is required in production — the public one will rate-limit the indexer within minutes |
| `RPC_WS_URL` | Optional websocket override for log subscriptions |
| `CORS_ORIGINS` | Comma-separated; set to the web origin in production. With `CLUSTER=mainnet-beta` the API refuses to start if it is unset or `*` |
| `KEEPER_KEYPAIR` | Indexer only. The CLI's JSON byte array or a base58 secret. Enables the keeper |
| `SWEEP_MIN_LAMPORTS` | Indexer only. Sweep a coin once this much waits at pump. Default 0.005 SOL |
| `KEEPER_INTERVAL_MS` | Indexer only. Default 60s |
| `LAUNCH_ALT` | `api` only. Address lookup table from `apps/api/scripts/create-alt.ts`. With it, `create_v2` and the dev buy go out as one v0 transaction, so nobody can buy between them. Unset (or the table missing/deactivated): launches fall back to the two-step flow, create then a separate dev buy, which bots can front-run |
| `VISE_INTERNAL_KEY` | `api` **and** `web` (runtime, not a build arg). 32 random bytes, hex. The web server's renders send it as `x-vise-internal` and skip the per-IP rate limit, which they would otherwise share across every visitor. Never prefix it `NEXT_PUBLIC_` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | The "VISE web" OAuth client in Google Cloud project `vise-509508` |
| `GOOGLE_REDIRECT_URI` | Must equal an authorised redirect URI on that client, byte for byte. Production: `https://api.vise.fun/api/auth/google/callback` |
| `SITE_ORIGIN` | Where the browser is sent after sign-in. Production: `https://vise.fun` |
| `SESSION_SECRET` | `api` only. 32 random bytes, hex. Signs session cookies and OAuth state. Rotating it signs everyone out |
| `WALLET_MASTER_KEY` | `api` only. 32 random bytes, hex. Encrypts account wallet keys at rest. **Losing it loses every account wallet.** Back it up outside Railway; never rotate without re-encrypting |
| `COOKIE_SECURE` | `1` in production (cookies `Secure`), `0` on plain-http localhost. Cookies are always `SameSite=Lax`: the site and API must be the same site (`vise.fun` / `api.vise.fun`), which is why the Railway and `www` hosts redirect to `vise.fun` |

`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` and `WALLET_MASTER_KEY` are checked
when the `api` role boots. Missing, the process exits when `NODE_ENV=production`
or `CLUSTER=mainnet-beta` (either is enough); elsewhere the two keys fall back
to random per-process keys, so local accounts and sessions do not survive a
restart.

The treasury address and trade fee are **not** environment: the program pins
them in `Config` and the API reads them from chain (`chainConfig()`), so they
cannot drift from what the program will accept.

**Web** (build args — they are inlined into the client bundle)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | API origin. Must be same-site with the web origin (`api.vise.fun` under `vise.fun`) or browsers treat the session cookie as third-party and drop it |
| `NEXT_PUBLIC_RPC_URL` | RPC the browser uses for balances and confirmations. `push-web.sh` fills it from `WEB_RPC_URL` (never `RPC_URL`, which holds the keyed URL for deploy/keeper scripts) and refuses to build if the value contains `api-key` |
| `NEXT_PUBLIC_CLUSTER` | `devnet` or `mainnet-beta`; explorer links |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same client ID as the API |

The web app sends a Content-Security-Policy built in `next.config.ts` from
`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_RPC_URL`: scripts from the site only,
network requests to the API and RPC only, images from the IPFS gateways the
indexer pins metadata to plus Google avatars. A new external host (an image
CDN, an analytics endpoint) has to be added there or the browser blocks it.

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

**Sessions and sign-out.** A session token carries the account's
`session_epoch` as `ep`; a token whose `ep` differs from the row (or has none)
is refused. `POST /api/auth/logout` increments the epoch and clears the
cookie, so signing out anywhere ends every session for that account. To sign
an account out by hand: `UPDATE accounts SET session_epoch = session_epoch + 1 WHERE id = $1`.

**Re-auth for custody moves.** `/me/withdraw` and `/me/export-key` also need
the sign-in itself (the token's `iat`) to be under 15 minutes old. Older, they
answer `401 { reauth: true }` and do nothing; the account page offers "Sign in
again", which goes through Google and comes back to `/account` with a fresh
session. A fresh sign-in always passes, so this never stands between the
owner and their wallet.

**Wallet ciphertext format.** v1 is `0x01 || nonce(12) || ciphertext || tag(16)`
(93 bytes) with AAD `vise-wallet:v1:<google_sub>:<wallet_pubkey>`, so a blob
copied onto another row will not decrypt. Rows written before v1 are v0,
`nonce || ciphertext || tag` (92 bytes, no AAD); the format is told apart by
length. v0 still decrypts, and the first time a v0 wallet signs anything
(after the decrypted key is checked against `wallet_pubkey`) it is re-sealed
as v1 and written back, only if the new blob decrypts to the same key. New
accounts are v1 from the start. Because the AAD names them, **never change
`google_sub` or `wallet_pubkey` on a row**: the wallet would no longer decrypt.
To see what is left on v0: `SELECT id FROM accounts WHERE length(wallet_secret) = 92`.

**Launch transactions.** With `LAUNCH_ALT` set a launch is three
transactions: `create_v2` + dev buy (v0, 2% slippage, signed by the creator
and the mint keypair), `create_pool` with the founding lock, the fee routing.
Without it the dev buy is its own transaction between the first two. Create
the table once per cluster with the operator key, then set the printed address
on the `api` service:

```bash
cd apps/api && RPC_URL=<keyed rpc> node scripts/create-alt.ts ~/.config/solana/id.json
```

Re-running with the table (`LAUNCH_ALT=<address>` or as the second argument)
only appends addresses pump added since — run it after a pump-sdk upgrade.
The API re-reads the table every five minutes and falls back to the two-step
flow, logging why, if the pair ever stops fitting in a packet.

**Launches that stop partway.** If a launch fails after the create landed, the
coin exists and the account owns it; the API answers with `resume: <mint>` and
the form offers to finish that coin. The finish stage is idempotent: it skips
the dev buy once the wallet holds at least 90% of what the dev buy would buy
now (a few units sent by someone else do not count), the pool if it exists,
and the routing if the sharing config exists. It refuses before building
anything when the signer is not the curve's creator (403), the coin is not
SOL-paired (409), fee sharing is already on without a pool (409), or the
founding lock would be under the config's minimum lock (409).
`POST /api/me/launch { resume }` can also be called by hand, only for a mint
that account launched.

**Only coins launched on vise.fun get a pool.** The create stage registers the
mint in `launched_mints` (refusing a mint that already has a pump curve), and
the finish stage refuses any mint not registered there for the same creator.
There is no way to bring a coin launched on pump.fun onto VISE through the
site or the API. The program's `create_pool` itself stays open to a coin's
creator: someone calling it directly with their own code could still open a
pool, which the indexer would list like any other; unlist it with
`UPDATE pools SET hidden = TRUE WHERE mint = '<mint>'`.

**Operational rules**

- Back up `WALLET_MASTER_KEY` the moment it is set. The database alone cannot
  recover a wallet.
- Nothing in the API can refuse a withdrawal or an export: the wallet is the
  user's. Do not add such a path. The 15-minute re-auth asks *who* is asking,
  never *whether*: a fresh sign-in always gets through.
- Deleting an account: have the user withdraw or export first, then
  `DELETE FROM account_actions WHERE account_id = $1; DELETE FROM accounts WHERE id = $1`.
- Google console: `https://console.cloud.google.com/auth/clients?project=vise-509508`.
  Authorised origins and redirect URIs must include every deployed host.

## The keeper

The indexer process runs four permissionless cranks every `KEEPER_INTERVAL_MS`,
signed and paid for by `KEEPER_KEYPAIR`.

**Fee sweeps.** pump.fun pays a coin's creator fees into a vault and leaves them
there until someone calls `distribute_creator_fees_v2`. Nobody else has a reason
to do that promptly, so the keeper does. For each pool it first checks the
coin's pump sharing config: exactly one shareholder, the pool's reward vault, at
10,000 bps, with the admin revoked. A coin that fails is never swept (logged
once; re-checked hourly in case it is routed later); a passing verdict is
cached, since a revoked config cannot change. It then reads the pump vault (and,
once an AMM pool exists, the AMM's WSOL vault) and, if at least
`SWEEP_MIN_LAMPORTS` is waiting, sends one transaction —
`[transfer_creator_fees_to_pump_v2]?, distribute_creator_fees_v2, sync`.
Each send is logged to `keeper_runs` and to the log with the reward vault's
change.

Backoff: a coin is swept at most once per 10 minutes. If a sweep did not raise
the pool's reward vault balance, or failed, that coin waits 20 minutes, then
40, 80… capped at 24 hours; a sweep that does move lamports resets it. At most
10 sweeps go out per tick. Together these stop anyone from turning small
donations into a stream of keeper-paid transactions. Backoff lives in memory
and resets when the indexer restarts.

**Matured unlocks.** A position past its lock end keeps its full weight — and
dilutes every live locker — until someone closes it. `unlock` is permissionless
once matured and pays principal, rewards and rent to the position's owner, so
the keeper closes them: every 10 minutes it scans all positions on chain, and
each tick it re-reads up to 5 matured ones (owner, pool and address re-derived)
and sends `[compute budget, create owner ATA (idempotent), unlock]` with the
keeper as payer. Logged as `unlocked matured position …`. Failures back off
per position like sweeps.

**What it costs.** A sweep is ~25,000 lamports (5,000 fee + 400k CU at 50,000
µlamports/CU), so a coin with steady volume costs at most ~0.0036 SOL a day
(144 sweeps). A matured unlock is ~7,000 lamports, plus ~0.0021 SOL of rent when
the owner's Token-2022 account is missing and the keeper has to create it. That
rent goes to the owner, who could close the account and keep it, so the keeper
pays for at most 10 missing accounts per rolling 24 hours (≤ ~0.021 SOL/day);
positions over that budget wait until it frees.

**Funding.** The keeper refuses to send below 0.02 SOL of its own balance and
logs a warning instead. Keep it at 0.1 SOL or more and top up when it falls
under 0.05 SOL; budget roughly 0.004 SOL per actively traded coin per day plus
up to 0.02 SOL a day for unlocks. An empty keeper is safe — fees wait at pump
and matured positions wait for their owners — but lockers are not paid
promptly and served-out locks keep diluting.

Anyone can run the same sweep without waiting: `POST /api/tx/sweep`. That path
pays whatever the coin's sharing config names; only the keeper checks that the
config routes everything to the pool before spending its own SOL on it.

"Pending" figures in the UI do not depend on the keeper. The API projects every
pool to the current moment with the program's own stream arithmetic
(`projectSync` in the SDK, pinned to the program by a LiteSVM test), so a
locker sees what a claim would pay even if nothing has touched the pool for a
day.

**Capped locks.** On pools with earnings limits, every 5 minutes the keeper
reads each capped pool's positions and `harvest`s any lock whose accrual has
reached its cap (at most 5 per tick): the owner is paid up to the cap, the
excess goes to the treasury share, and the lock's weight stops diluting the
locks still earning.

**Treasury.** Any pool whose projected `treasury_claimable` is at least
0.01 SOL gets a `claim_treasury` at most hourly, so the 10% cut and every
surplus fee land in the treasury wallet on their own.

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

**Unlisting a pool.** `UPDATE pools SET hidden = TRUE WHERE mint = '<mint>'`
(run it through `railway ssh --service indexer`). The pool leaves the coin list,
leaderboards, stats and sitemap, and its page and every `/pools/<mint>` read
answer 404. Its lockers still claim and unlock from their portfolio. Nothing on
chain changes — the pool keeps working.
The mainnet smoke-test coin VTEST (`9Vfo4Gx1EVAPdar6MVytzxjvsMykhDdSThCDF7V7g9rv`)
is unlisted this way.

**Someone reports they cannot claim.** Check `accrued(weight, acc, reward_debt)`
for their position. `NothingToClaim` with a zero result is correct behaviour, not
a failure — it means every lamport owed to them has already been paid.

**Emergency.** There is no emergency withdraw, by design. The strongest available
action is `update_config { paused: true }`, which stops new pools and nothing
else. Existing pools keep paying out.
