# Runbook

All commands run in WSL from the repo root unless a `cd` says otherwise. Every
script below is idempotent: re-running it after an interruption is safe.

## What is deployed

| Piece | Where | State |
|---|---|---|
| Program | `imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa` (programdata `7VAbM9wR7wNxEBEkhzNqh6PyQPechAiZCSZjURw3Pd5e`) | mainnet-beta, deployed with `--max-len 738688`. Upgrade authority `E1MQZaMhRELUihUffFCUbuARpTy53fJv8hpB98MoYhZc` (`.mainnet/admin.json`, gitignored) |
| Config | `FjjucCXttbwBzNdBkxHS6wtQYqaUpwxtAjNLy2RZorHa` | Initialised before the move to the IMAGINE platform (`trade_fee_bps` 100, old platform). Updated by the upgrade below to the IMAGINE PlatformConfig and `trade_fee_bps` 150 |
| Treasury | `DNGM32EBgSwaG2Cj6NhYubzFHC8FTFopqgvPqp7ESY59` | Config treasury; also the IMAGINE platform's fee wallet and Fee-Key NFT wallet |
| Keeper | `6mgSanvKanCvzMnbyYa5dyWQGZ5wx36rSwybP1WTNh4M` | `KEEPER_KEYPAIR` on `imagine-indexer` |
| Lookup table | `AsBDK8oA88A5AzbRwJFh1dXB4npd2M1veeTFbKc8ve57` | Full (255 of 256) and built for the old platform; replaced by the upgrade below |
| Railway | project `imagine`: `imagine-api` (`ROLE=index`), `imagine-indexer` (`ROLE=indexer`, keeper), `imagine-web`, Postgres | GitHub-linked to `realdoomsman/imagine` `main`, auto-deploy on push |
| DNS | Porkbun | `imagine.fun` ALIAS and `www` CNAME → `imagine-web`; `api.imagine.fun` CNAME → `imagine-api`; certificates valid |

The program keypair is `target/deploy/imagine-keypair.json` (pubkey also in
`target/deploy/imagine-program-id.txt`); the same id is in `declare_id!`,
`Anchor.toml` and the SDK's `IMAGINE_PROGRAM_ID`. Back up the program keypair
and `.mainnet/`.

## Moving to the IMAGINE platform (mainnet upgrade)

Rehearse every step on the mainnet fork first (`scripts/mainnet-fork.sh`, then
the same commands with `localnet` / `RPC_URL=http://127.0.0.1:8999`).

```bash
echo "<keyed mainnet rpc>" > apps/api/.mainnet-rpc.tmp     # gitignored
export RPC_URL=$(cat apps/api/.mainnet-rpc.tmp)
```

### 1. Create the IMAGINE LaunchLab PlatformConfig

```bash
cd apps/api
node scripts/setup-platform.ts --list-cpswap-configs       # read-only: CPMM AmmConfigs with a creator fee, best first
CPSWAP_CONFIG=<chosen AmmConfig> node scripts/setup-platform.ts ../.mainnet/admin.json
cd ..
```

`setup-platform.ts` calls LaunchLab `create_platform_config` signed by the
admin key; the PlatformConfig is the PDA `["platform_config", admin]` under
LaunchLab, so the admin key fixes its address. It sets:

| Parameter | Value |
|---|---|
| `fee_rate` (platform fee) | 0 |
| `creator_fee_rate` | LaunchLab's maximum, 0.5%. Each coin's LaunchLab "creator" is its pool vault, so this is the pool's on-chain trading fee |
| `cpswap_config` | `CPSWAP_CONFIG` — the config with the highest creator fee from `--list-cpswap-configs`. Rehearsed with CPMM index 16, `FMmwToGqT9iwDgsqvzLg65vcKSzKme4szbWqX1kyCBCJ` (trade 0.005%, creator 1.495%, already used by mainnet pools); Raydium's index-0 `D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2` is the fallback |
| `platform_cp_creator` | default, so the CPMM pool creator after graduation is the vault |
| migrated LP | `platform_scale` 100% (locked), `creator_scale` 0, `burn_scale` 0 |
| fee wallet / NFT wallet | `TREASURY_PUBKEY`, default `DNGM32EBgSwaG2Cj6NhYubzFHC8FTFopqgvPqp7ESY59` |
| name / web / img | IMAGINE / https://imagine.fun / https://imagine.fun/brand/imagine-512.png |

It prints the PlatformConfig address and its decoded parameters; with
`.mainnet/admin.json` that address is `DYtCiTPJoqCyDApm45b9C7D3xotkSDecJaAtQHaQNULk`
(the PDA depends only on the admin key; the fork rehearsal produced the same
one). An existing PlatformConfig is printed, never changed. Check that the
image URL resolves on the live site before running it.

### 2. Upgrade the program

```bash
bash scripts/anchor-build.sh                                 # target/deploy/imagine.so + IDL
stat -c %s target/deploy/imagine.so                          # compare with 738688
# only if the binary is larger than the program data:
solana program extend imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa <extra bytes> \
  -k .mainnet/admin.json -u "$RPC_URL"
UPGRADE=1 SKIP_BUILD=1 WALLET=.mainnet/admin.json MAX_LEN=<current program data length> \
  LAUNCHLAB_PLATFORM=<PlatformConfig from step 1> bash scripts/deploy.sh mainnet-beta
```

The current build is 629,376 bytes, under the deployed 738,688, so no extend is
needed for this upgrade; a later build that outgrows it needs `extend` first
(rent for the added bytes, permanent — add headroom).
`deploy.sh` refuses a binary larger than `MAX_LEN` (set it to the program data
length after any extend), writes the binary through the fixed buffer keypair
`target/deploy/imagine-buffer.json` (an interrupted write resumes on re-run;
the buffer's rent is held until the upgrade lands, about 5.3 SOL checked up
front), upgrades, verifies the on-chain bytes against the local binary, and
finally runs `apps/api/scripts/init-config.ts` with the same wallet.

`init-config.ts` (also runnable alone:
`cd apps/api && LAUNCHLAB_PLATFORM=<address> node scripts/init-config.ts ../.mainnet/admin.json`)
creates the config if missing, or sends one `update_config` signed by the admin
when the config differs from the SDK's `ECONOMICS` or `LAUNCHLAB_PLATFORM`,
keeping treasury and pause flag. Live pools are untouched; their terms are
frozen.

Check: `(cd apps/api && cp .env.example .env.mainnet)` with `RPC_URL` and
`CLUSTER=mainnet-beta` set, then `bash scripts/config-show.sh .env.mainnet`:
`launchlabPlatform` is the step-1 address, `tradeFeeBps` 150, `treasury`
`DNGM32…SY59`, `paused` false.

### 3. Replace the lookup table

```bash
cd apps/api
node scripts/create-alt.ts ../.mainnet/admin.json            # creates a NEW table; prints LAUNCH_ALT=<address>
```

The table holds every coin-independent account of a launch or trade: IMAGINE
program, config and treasury; LaunchLab program, authority and event authority;
the IMAGINE PlatformConfig (read from the on-chain config) and its fee vaults;
the CPMM program, authority and the platform's `cpswap_config`; token,
associated-token, system and compute-budget programs; then per quote (SOL
first, stablecoins, funds, stocks) its mint, LaunchLab GlobalConfig and the
platform fee vault `[platform, quote]`, up to 256 addresses (a full table costs
0.05807424 SOL of rent plus about 14 transaction fees). Set the printed
`LAUNCH_ALT` on `imagine-api` and redeploy it. Without a working table the API
splits launches into two transactions and the dev buy can be front-run.

`node scripts/create-alt.ts <payer.json> <table>` appends missing addresses to
a table you own. To recover the old table's rent once nothing uses it:
`node scripts/create-alt.ts ../.mainnet/admin.json --close AsBDK8oA88A5AzbRwJFh1dXB4npd2M1veeTFbKc8ve57`
deactivates it; run the same command again about 512 slots (~4 min) later to
close it and refund the rent.

### 4. Ship the off-chain side

Merge to `main`; Railway rebuilds `imagine-api`, `imagine-indexer` and
`imagine-web`. Then:

- `GET https://api.imagine.fun/health` is green and `GET https://api.imagine.fun/api/quotes`
  lists the launchable pairs.
- The keeper logs `collect_creator_fee` / `sync` sends once pools have volume.
- Launch one throwaway coin per path (SOL-paired and one xStock-paired) with a
  small dev buy. Confirm it on `https://raydium.io/launchpad/token/?mint=<mint>`,
  trade it once on imagine.fun and once elsewhere, wait for the keeper to
  collect, lock, claim (in the pair asset), unlock. Every number must match the
  UI. Unlist the coin afterwards (Incident playbook).

### Mainnet checklist (every upgrade)

Do not skip an item because the previous one passed.

1. `cargo test -p imagine --lib` — reward and price math.
2. `bash scripts/sdk-test.sh` — the full instruction surface, launch under the
   platform, creator-fee collection on the curve and after migration, both
   asset paths, against the real LaunchLab/CPMM/Token-2022 builds.
3. On a fresh fork (`(cd apps/api && node scripts/fork-fixtures.ts)`,
   `bash scripts/mainnet-fork.sh`, platform + `deploy.sh localnet`, API running):
   `(cd apps/api && node scripts/e2e.ts sol && node scripts/e2e.ts spyx)`.
   Or `bash scripts/verify.sh` for everything.
4. An independent audit of `programs/imagine/src/`. `docs/AUDIT.md` is the
   internal pass.
5. Build reproducibly and publish the verification
   (`solana-verify build && solana-verify verify-from-repo`).
6. Upgrade (steps 2–3 above); confirm with `config-show.sh`.
7. Services green; the throwaway-coin round trip of step 4.
8. Set `NEXT_PUBLIC_OFFICIAL_MINT` only when $IMAGINE exists.
9. Only then announce.

### Keys and authority

```bash
bash scripts/keeper.sh 0.5      # creates (once) and funds .mainnet/keeper.json (KEY=<path> overrides)
```

Put the keeper key in `KEEPER_KEYPAIR` on `imagine-indexer`. It is deliberately
not the admin key, so a leaked indexer environment cannot upgrade anything.

The upgrade authority, the config admin and the LaunchLab platform admin are
all `.mainnet/admin.json` today, a hot key. Move them to a multisig when one
exists and say publicly which it is:

```bash
solana program set-upgrade-authority imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa \
  --new-upgrade-authority <SQUADS_VAULT> -k .mainnet/admin.json -u "$RPC_URL"
```

The config admin moves with `transfer_admin` / `accept_admin`. The platform
admin may be able to change the platform's fee rates within LaunchLab's bounds (see
`docs/AUDIT.md` N-06). The treasury is frozen per pool; never rotate it to an
address you cannot hold for years.

## Services (Railway)

| Service | Dockerfile | `ROLE` | Runs | Health |
|---|---|---|---|---|
| `imagine-api` | `apps/api/Dockerfile` | `index` (default) | HTTP and the RPC proxy; safe to scale out | `GET /health` |
| `imagine-indexer` | `apps/api/Dockerfile` | `indexer` | Read model, reconciler, **keeper**. Exactly one replica | logs advancing; `keeper_runs` growing with volume |
| `imagine-web` | `apps/web/Dockerfile` | — | `next start` | `GET /` |
| Postgres | Railway plugin | — | Read model | — |

Services build from `main` on push. `ROLE` is the entrypoint file name (`index`
or `indexer`); every boot runs the idempotent migration first. The indexer is
not optional: without it `pools` never fills and nothing cranks.
`NEXT_PUBLIC_*` values are baked into the web bundle at build time, so changing
one means a rebuild. For a local image build, `scripts/push-api.sh` and
`scripts/push-web.sh` push the same images to GHCR (`push-web.sh` requires
`GOOGLE_CLIENT_ID`; optional `API_URL`, `CLUSTER`, `IMAGE`, `OFFICIAL_MINT`,
`X_URL`, `WEB_RPC_URL` / `WEB_WS_URL`, and refuses an RPC URL containing
`api-key`).

### Environment

**`imagine-api` and `imagine-indexer`** (from `apps/api/.env.example`). The auth
secrets `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `WALLET_MASTER_KEY` belong on
`imagine-api` only.

| Variable | Production value / purpose |
|---|---|
| `ROLE` | `index` or `indexer` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `RPC_URL` | Keyed mainnet RPC. Server-side only: the site reaches it through `POST /rpc` |
| `RPC_WS_URL` | Keyed PubSub endpoint behind `GET /rpc-ws`; unset derives it from `RPC_URL` |
| `RPC_PROXY_LIMIT_PER_MIN` | `imagine-api`: proxied calls / subscriptions per minute per client IP. Default 600 |
| `CLUSTER` | `mainnet-beta` |
| `HOST` / `PORT` | `0.0.0.0` / Railway's port |
| `LOG_LEVEL` | `info` |
| `CORS_ORIGINS` | `https://imagine.fun`. With `CLUSTER=mainnet-beta` the API refuses to start if unset or `*` |
| `SITE_ORIGIN` | `https://imagine.fun` |
| `API_PUBLIC_ORIGIN` | `https://api.imagine.fun`. Coin metadata URIs written on chain point here; never change it |
| `COOKIE_SECURE` | `1` |
| `LAUNCH_ALT` | `imagine-api`: the table from `create-alt.ts` |
| `JUPITER_SWAP_URL` / `JUPITER_PRICE_URL` / `JUPITER_API_KEY` | Pair prices, fund-raising sizing for non-SOL quotes, SOL→quote swaps; key only with an api.jup.ag base |
| `TREASURY_PUBKEY` | Only read by `init-config.ts` (new config) and `setup-platform.ts` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | The imagine.fun OAuth web client |
| `GOOGLE_REDIRECT_URI` | `https://api.imagine.fun/api/auth/google/callback` |
| `WALLET_MASTER_KEY` | 32 random bytes, hex. Encrypts account wallets. **Losing it loses every account wallet**; back it up outside Railway |
| `SESSION_SECRET` | 32 random bytes, hex. Rotating it signs everyone out |
| `IMAGINE_INTERNAL_KEY` | Also on `imagine-web` (runtime). Lets the web server's renders skip the per-IP rate limit. Never `NEXT_PUBLIC_` |
| `KEEPER_KEYPAIR` | `imagine-indexer`: the keeper key (JSON byte array or base58) |
| `KEEPER_INTERVAL_MS` | Default 60000 |
| `SYNC_MIN_USD` | Collect / sync a pool once its uncollected plus unsynced value reaches this many USD. Default 1 |

The auth secrets are checked when `imagine-api` boots; missing, it exits on
`NODE_ENV=production` or `CLUSTER=mainnet-beta`. Treasury, trade fee and
platform are not environment: the API reads them from the on-chain config.

**`imagine-web`** (from `apps/web/.env.example`; build-time)

| Variable | Production value / purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.imagine.fun`. Must be same-site with the web origin or the session cookie is dropped |
| `NEXT_PUBLIC_RPC_URL` | `https://api.imagine.fun/rpc` (the API's method-allowlisted proxy) |
| `NEXT_PUBLIC_WS_URL` | `wss://api.imagine.fun/rpc-ws` |
| `NEXT_PUBLIC_CLUSTER` | `mainnet-beta` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same client as the API |
| `NEXT_PUBLIC_OFFICIAL_MINT` | Empty until $IMAGINE exists; every official-coin surface stays hidden |
| `NEXT_PUBLIC_X_URL` | `https://x.com/LockImagine`; the link is hidden while empty |

## DNS and TLS

Live (Porkbun → Railway). For a new hostname: add the custom domain to the
Railway service, point the record at the target Railway shows (ALIAS for the
apex, CNAME otherwise, plus any verification TXT), and wait for Railway to show
it active. **Certificate issuance can take around an hour after DNS resolves.**
Check with `curl -I https://imagine.fun` and `curl https://api.imagine.fun/health`.
Cookies are `SameSite=Lax`: the site and API must stay same-site
(`imagine.fun` / `api.imagine.fun`); `www` and the Railway hostnames redirect
to `https://imagine.fun`.

## Google OAuth for imagine.fun

1. Google Cloud console → OAuth consent screen: app name IMAGINE, authorised
   domain `imagine.fun`, links to `https://imagine.fun/privacy` and
   `https://imagine.fun/terms`, published (Testing mode only admits test users).
2. OAuth client (Web application): JavaScript origin `https://imagine.fun`
   (plus `http://localhost:3010`); redirect URI
   `https://api.imagine.fun/api/auth/google/callback` (plus
   `http://localhost:8080/api/auth/google/callback`).
3. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on `imagine-api`,
   `GOOGLE_REDIRECT_URI` byte-for-byte equal to the registered URI,
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on `imagine-web` (rebuild).
   `scripts/railway-auth-vars.py` sets the API's auth variables from the
   gitignored `apps/api/.google-oauth.tmp` and `apps/api/.railway-secrets.tmp`.

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

- **Creator fees and syncs.** The 0.5% on-chain trading fee accrues in each
  coin's LaunchLab creator-fee vault (and, after graduation, as CPMM creator
  fees), claimable only through `collect_creator_fee`. Per pool, the keeper
  values the uncollected fees plus any unsynced vault balance; at
  `SYNC_MIN_USD` or more it sends `collect_creator_fee` (which syncs inline),
  or a plain `sync` when only unsynced balance qualifies. At most once per
  10 minutes per pool, with exponential backoff after a send that moved nothing.
- **Matured unlocks.** Closes positions past their end (paying the owner,
  creating their token accounts if missing), so served-out locks stop diluting.
- **Capped locks.** `harvest`s locks that reached their earnings cap.
- **Treasury.** `claim_treasury` moves each pool's treasury share to the
  treasury wallet.

Sends per tick are bounded and the keeper stops below a minimum balance, so it
cannot drain itself. An empty keeper is safe — fees wait in Raydium's vaults,
matured positions wait for their owners — but lockers are paid less promptly.
Anyone can call `collect_creator_fee` or `sync`. "Pending" figures in the UI
are projected with the program's stream arithmetic (`projectSync` in the SDK).

## Media

`scripts/render-video.sh` renders the Promo, Teaser, Explainer and Vertical
films to `video/out/` and publishes `apps/web/public/film/imagine-promo.mp4`,
`poster.jpg` and `apps/web/app/opengraph-image.png`.
`scripts/render-launch-film.sh` renders the X launch film to `video/out/x/film/`.
`scripts/render-cards.sh` renders the X cards to `video/out/cards/`;
`scripts/render-profile.sh` renders avatar, banner and OG card to
`video/out/profile/`.

## Incident playbook

**The indexer is behind.** Read models go stale; every number a user acts on is
read from chain. Restart `imagine-indexer`.

**RPC is failing.** Transaction building fails with a 500 and the site's proxy
errors. Swap `RPC_URL`, restart. No on-chain state is affected.

**Jupiter is down.** Prices and USD figures go blank, launches paired with
non-SOL quotes cannot size their fund raising, SOL→quote swaps fail. SOL-paired
launches, trading in the pair, locking and claiming keep working.

**Creator fees are not arriving.** Check the coin's LaunchLab creator-fee
vault balance and the keeper's `keeper_runs`; call `collect_creator_fee` by hand
through the SDK. A LaunchLab or CPMM upgrade that changes its accounts makes
collection fail until the program is upgraded; the fees stay safe in Raydium's
vault, claimable only by the pool vault.

**An xStock quote is paused or frozen by its issuer.** Payouts in that quote
fail for its pools until the issuer lifts it; other pools are unaffected. See
`docs/AUDIT.md` N-07.

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
