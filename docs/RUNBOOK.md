# Runbook

Nothing below has been run against mainnet yet. Every step is written so it can
be run once, in order, and re-run safely.

## Program

Program id: `imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa`, from the keypair
`target/deploy/imagine-keypair.json` (pubkey also in
`target/deploy/imagine-program-id.txt`). Back the keypair up; losing it means
the program can never be deployed again at that address. The same id is in
`declare_id!`, `Anchor.toml` and the SDK's `IMAGINE_PROGRAM_ID`.

StonkFun is mainnet-only, so there is no devnet deployment. Rehearse on the
mainnet fork (`scripts/mainnet-fork.sh`, then `scripts/deploy.sh localnet`),
which runs exactly the mainnet path.

All commands run in WSL from the repo root.

### Deploying to mainnet

```bash
echo "<keyed mainnet rpc>" > apps/api/.mainnet-rpc.tmp      # gitignored; or export RPC_URL
bash scripts/anchor-build.sh                                # target/deploy/imagine.so (SBPF v3) + IDL
TREASURY_PUBKEY=<treasury> bash scripts/deploy.sh mainnet-beta
(cd apps/api && cp .env.example .env.mainnet)               # set RPC_URL=<mainnet rpc>, CLUSTER=mainnet-beta
bash scripts/config-show.sh .env.mainnet                    # prints the on-chain config
```

`deploy.sh` deploys `target/deploy/imagine.so` through a fixed buffer keypair
(`target/deploy/imagine-buffer.json`), so a deploy interrupted by congestion is
resumed by re-running it. The deploying wallet (`WALLET`, default
`~/.config/solana/id.json`) becomes the upgrade authority. A first deploy needs
about 6.5 SOL (rent for `MAX_LEN`, default 900,000 bytes, plus the temporary
buffer). It skips the deploy if the program exists unless `UPGRADE=1`.

It always ends with `apps/api/scripts/init-config.ts`, which is idempotent:

- No config: `initialize_config` signed by the upgrade authority (the only key
  that can), with `ECONOMICS` from the SDK, treasury `TREASURY_PUBKEY` (defaults
  to the admin — do not accept that on mainnet), and
  `launchlab_platform = 4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7`
  (StonkFun's LaunchLab PlatformConfig). `launch` only creates coins under that
  platform, which is what puts every IMAGINE coin on stonkfun.xyz.
- A config that differs from `ECONOMICS` or the platform: one `update_config`
  signed by the admin, keeping treasury and pause flag. Live pools are
  untouched; their terms are frozen.

Check the printed config: `launchlabPlatform` is StonkFun's, `tradeFeeBps` is
100, `treasury` is the cold address, `paused` false.

**Upgrading.** `UPGRADE=1 bash scripts/deploy.sh mainnet-beta` rebuilds (unless
`SKIP_BUILD=1`), writes the buffer, upgrades, verifies the deployed bytes against
the local binary, then re-runs `init-config.ts`. Always rebuild with
`scripts/anchor-build.sh` first; it forces a recompile.

### Address lookup table

A launch — `imagine.launch` (LaunchLab CPI) + the LaunchLab dev buy +
`imagine.found` — fits in one transaction only with the lookup table. Without
it the API splits the launch and the dev buy can be front-run.

```bash
cd apps/api && RPC_URL=<keyed rpc> node scripts/create-alt.ts ~/.config/solana/id.json
```

It prints the table address: set it as `LAUNCH_ALT` on the API service. The
table holds the coin-independent accounts (programs, IMAGINE config and
treasury, StonkFun's platform config, LaunchLab/CPMM authorities, and per
launchable quote its mint, GlobalConfig, StonkFun allow-config and curve-rule
PDAs and fee vault), up to 256 addresses. Re-run with the table
(`LAUNCH_ALT=<address>` or as the second argument) to append quotes StonkFun
adds later; it only appends.

### Keeper key

```bash
bash scripts/keeper.sh 0.5      # creates apps/api/.keeper-mainnet.json (gitignored) and funds it
```

Put the key file's contents in `KEEPER_KEYPAIR` on the indexer service. It is
deliberately not the deploy/admin key.

### Upgrade authority

```bash
solana program set-upgrade-authority imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa \
  --new-upgrade-authority <SQUADS_VAULT>
```

Move the config admin with `transfer_admin` / `accept_admin`. Burning the
upgrade authority (`--final`) is the end state once the program has run
untouched for a meaningful period. Until then say publicly which it is.

### Mainnet checklist

Do not skip an item because the previous one passed.

1. `cargo test -p imagine --lib` — reward and price math.
2. `bash scripts/sdk-test.sh` — the full instruction surface, StonkFun launch,
   both asset paths, against the real LaunchLab/CPMM/Token-2022 builds.
3. On a fresh fork (`(cd apps/api && node scripts/fork-fixtures.ts)` to refresh
   the snapshot, `bash scripts/mainnet-fork.sh`, `bash scripts/deploy.sh localnet`,
   API running): `(cd apps/api && node scripts/e2e.ts sol && node scripts/e2e.ts spyx)`.
   Or `bash scripts/verify.sh` for everything.
4. Independent audit of `programs/imagine/src/`. `docs/AUDIT.md` is the
   internal pass; an external one is required before real money.
5. Build reproducibly and publish the verification
   (`solana-verify build && solana-verify verify-from-repo`).
6. Deploy; move the upgrade authority to a multisig.
7. Config: admin = the multisig, treasury = a cold address,
   `launchlab_platform` = StonkFun's. Confirm with `config-show.sh`.
8. Create the lookup table; set `LAUNCH_ALT`.
9. Services, DNS and OAuth below; `GET https://api.imagine.fun/health` green,
   `GET /api/quotes` lists StonkFun's launchable pairs.
10. Launch one throwaway coin per path (SOL-paired and one xStock-paired) with a
    small dev buy. Confirm it appears on stonkfun.xyz. Trade it, lock, wait for
    a sync, claim (in the pair asset), unlock. Every number must match the UI.
    Unlist it afterwards (Incident playbook).
11. Set `NEXT_PUBLIC_OFFICIAL_MINT` only when $IMAGINE exists.
12. Only then announce.

## Services (Railway)

One API image, two roles chosen by `ROLE`, plus the web image. Railway's
builder has been unreliable for this repository, so images are built locally,
pushed to GHCR and deployed from `:latest`:

```bash
bash scripts/push-api.sh                                        # ghcr.io/realdoomsman/imagine-api:latest
GOOGLE_CLIENT_ID=<client id> WEB_RPC_URL=<keyless rpc> bash scripts/push-web.sh   # ghcr.io/realdoomsman/imagine-web:latest
railway redeploy --service imagine-api -y && railway redeploy --service imagine-indexer -y
railway redeploy --service imagine-web -y
```

Pushing does not redeploy; `railway redeploy` pulls `:latest`. `NEXT_PUBLIC_*`
values are baked into the client bundle, so changing one means rebuilding the
web image. `push-web.sh` refuses a `WEB_RPC_URL` containing `api-key`: the
browser bundle is public.

| Service | Image | `ROLE` | Runs | Health |
|---|---|---|---|---|
| `imagine-api` | imagine-api | `index` (default) | HTTP; safe to scale out | `GET /health` |
| `imagine-indexer` | imagine-api | `indexer` | Read model, reconciler, **keeper**. Exactly one replica | logs advancing; `keeper_runs` growing with volume |
| `imagine-web` | imagine-web | — | `next start` | `GET /` |
| Postgres | Railway plugin | — | Read model | — |

`ROLE` is the entrypoint file name: `index` or `indexer`. Every boot runs the
idempotent migration first, so a fresh database self-provisions. The indexer is
not optional: without it `pools` never fills and nothing cranks.

### Environment

**`imagine-api` and `imagine-indexer`** (from `apps/api/.env.example`). The auth
secrets `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `WALLET_MASTER_KEY` belong on
`imagine-api` only.

| Variable | Production value / purpose |
|---|---|
| `ROLE` | `index` or `indexer` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `RPC_URL` | Keyed mainnet RPC (the public one rate-limits the indexer) |
| `RPC_WS_URL` | Optional websocket override |
| `CLUSTER` | `mainnet-beta` |
| `HOST` / `PORT` | `0.0.0.0` / Railway's port |
| `LOG_LEVEL` | `info` |
| `CORS_ORIGINS` | `https://imagine.fun`. With `CLUSTER=mainnet-beta` the API refuses to start if unset or `*` |
| `SITE_ORIGIN` | `https://imagine.fun` (post-sign-in redirect; coin pages) |
| `API_PUBLIC_ORIGIN` | `https://api.imagine.fun`. Coin metadata and images are served from it and their URIs are written on chain at launch, so it must never change; must be https on mainnet |
| `COOKIE_SECURE` | `1` |
| `LAUNCH_ALT` | `imagine-api`: the table from `create-alt.ts` |
| `STONKFUN_API` | Default `https://www.stonkfun.xyz` (pricing and launchable pairs) |
| `JUPITER_SWAP_URL` / `JUPITER_PRICE_URL` / `JUPITER_API_KEY` | SOL→quote swaps and USD prices; key only with an api.jup.ag base |
| `TREASURY_PUBKEY` | Only read by `init-config.ts` for a new config |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | The imagine.fun OAuth web client |
| `GOOGLE_REDIRECT_URI` | `https://api.imagine.fun/api/auth/google/callback` |
| `WALLET_MASTER_KEY` | 32 random bytes, hex. Encrypts account wallets. **Losing it loses every account wallet**; back it up outside Railway |
| `SESSION_SECRET` | 32 random bytes, hex. Rotating it signs everyone out |
| `IMAGINE_INTERNAL_KEY` | Also on `imagine-web` (runtime). Lets the web server's renders skip the per-IP rate limit. Never `NEXT_PUBLIC_` |
| `KEEPER_KEYPAIR` | `imagine-indexer`: the keeper key (JSON byte array or base58) |
| `KEEPER_INTERVAL_MS` | Default 60000 |
| `SYNC_MIN_USD` | Sync a pool once its vault holds this much more (USD) than at its last sync. Default 1 |

The auth secrets are checked when `imagine-api` boots; missing, it exits on
`NODE_ENV=production` or `CLUSTER=mainnet-beta`. Treasury and trade fee are not
environment: the API reads them from the on-chain config.

**`imagine-web`** (from `apps/web/.env.example`; build args inlined into the
bundle, set by `push-web.sh` or `docker build --build-arg`)

| Variable | Production value / purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.imagine.fun` (`push-web.sh` default). Must be same-site with the web origin or the session cookie is dropped |
| `NEXT_PUBLIC_RPC_URL` | A keyless, per-visitor rate-limited mainnet endpoint (`WEB_RPC_URL`) |
| `NEXT_PUBLIC_CLUSTER` | `mainnet-beta` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same client as the API (`GOOGLE_CLIENT_ID`) |
| `NEXT_PUBLIC_OFFICIAL_MINT` | Empty until $IMAGINE exists; every official-coin surface stays hidden |
| `NEXT_PUBLIC_X_URL` / `NEXT_PUBLIC_TELEGRAM_URL` | Social links; each hidden while empty |

`push-web.sh` requires `GOOGLE_CLIENT_ID` and `WEB_RPC_URL`, and takes optional
`API_URL`, `CLUSTER`, `IMAGE`, `OFFICIAL_MINT`, `X_URL` and `TELEGRAM_URL`
(passed as the matching `NEXT_PUBLIC_*` build args, empty when unset).

## DNS: imagine.fun and api.imagine.fun

1. In Railway, add custom domains: `imagine.fun` and `www.imagine.fun` on
   `imagine-web`, `api.imagine.fun` on `imagine-api`. Railway shows a target
   hostname for each.
2. At the registrar: `imagine.fun` → ALIAS/ANAME (or flattened CNAME) to the
   web target; `www` → CNAME to the web target; `api` → CNAME to the API target.
   Add any verification TXT records Railway asks for.
3. Wait for Railway to show each domain as active. **Certificate issuance can
   take around an hour after DNS resolves** — do this a day before launch, not
   the morning of. Check with `curl -I https://imagine.fun` and
   `curl https://api.imagine.fun/health`.
4. Cookies are `SameSite=Lax`: the site and API must stay same-site
   (`imagine.fun` / `api.imagine.fun`). Send `www` and the Railway hostnames to
   `https://imagine.fun` rather than serving the app there.

## Google OAuth for imagine.fun

1. Google Cloud console → a project for IMAGINE → OAuth consent screen:
   app name IMAGINE, authorised domain `imagine.fun`, links to
   `https://imagine.fun/privacy` and `https://imagine.fun/terms`. Publish it
   (Testing mode only admits listed test users).
2. Credentials → OAuth client ID → Web application:
   - Authorised JavaScript origins: `https://imagine.fun` (plus
     `http://localhost:3010` for development).
   - Authorised redirect URIs: `https://api.imagine.fun/api/auth/google/callback`
     (plus `http://localhost:8080/api/auth/google/callback`).
3. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on `imagine-api`,
   `GOOGLE_REDIRECT_URI` byte-for-byte equal to the registered URI, and rebuild
   the web image with the same client id.

Flow: `/api/auth/google/start` → Google → `/api/auth/google/callback` →
session cookie `imagine_session` → back to `SITE_ORIGIN`. Each account gets a
server-held Solana keypair encrypted with `WALLET_MASTER_KEY` (AAD binds it to
the row's Google subject and wallet pubkey — never edit those columns).
`/api/me/withdraw` and `/api/me/export-key` require a sign-in under 15 minutes
old; nothing in the API may refuse a withdrawal or export. Sign an account out
everywhere: `UPDATE accounts SET session_epoch = session_epoch + 1 WHERE id = $1`.

## The keeper

The indexer runs permissionless cranks every `KEEPER_INTERVAL_MS`, paid by
`KEEPER_KEYPAIR`:

- **Syncs.** StonkFun's forwarded creator shares arrive in a pool's vault as
  plain transfers and join the lockers' stream only on `sync`. The keeper syncs
  a pool once its vault holds at least `SYNC_MIN_USD` more than at the last
  sync, spaced per pool, backing off a pool whose sync folded in nothing.
- **Matured unlocks.** Closes positions past their end (paying the owner,
  creating their token accounts if missing), so served-out locks stop diluting.
- **Capped locks.** `harvest`s locks that reached their earnings cap.
- **Treasury.** `claim_treasury` moves each pool's treasury share to the
  treasury wallet.

Sends per tick are bounded and the keeper stops below a minimum balance, so it
cannot drain itself. An empty keeper is safe — funds wait in vaults, matured
positions wait for their owners — but lockers are paid less promptly. Anyone
can sync. "Pending" figures in the UI are projected with the program's stream
arithmetic (`projectSync` in the SDK) and do not depend on the keeper.

## Media

`scripts/render-video.sh` regenerates the score (`video/audio/score.py`) and
renders the Promo, Teaser, Explainer and Vertical films to `video/out/`, then
publishes `apps/web/public/film/imagine-promo.mp4`, `poster.jpg` and
`apps/web/app/opengraph-image.png`. `scripts/render-cards.sh` renders the X
cards from `video/src/cards.ts` to `video/out/cards/`;
`scripts/render-profile.sh` renders avatar, banner and OG card to
`video/out/profile/`.

## Incident playbook

**The indexer is behind.** Read models go stale; every number a user acts on is
read from chain. Restart `imagine-indexer`.

**RPC is failing.** Transaction building fails with a 500. Swap `RPC_URL`,
restart. No on-chain state is affected.

**StonkFun's API is down.** Launches fail (curve parameters and launchable
pairs come from it); trading, locking and claiming keep working.

**An xStock quote is paused or frozen by its issuer.** Payouts in that quote
fail for its pools until the issuer lifts it; other pools are unaffected. See
`docs/AUDIT.md` N-05.

**A pool looks wrong in the UI.** Compare with chain (`ImagineClient.fetchPool`).
The chain wins; the fix belongs in the indexer.

**Unlisting a pool.** `UPDATE pools SET hidden = TRUE WHERE mint = '<mint>'`
(`railway ssh --service imagine-indexer`). It leaves lists, leaderboards, stats
and the sitemap; lockers still claim and unlock from their portfolio. Nothing on
chain changes.

**Someone cannot claim.** `NothingToClaim` with zero accrued is correct: every
unit owed has been paid.

**Emergency.** There is no emergency withdraw, by design. The strongest action
is `update_config { paused: true }`, which stops new launches and nothing else.
