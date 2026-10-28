# IMAGINE — X launch content

Account: **@LockImagine** (https://x.com/LockImagine) · Site: imagine.fun ·
Long read: imagine.fun/article · Security: imagine.fun/docs/security

Status: not posted. Do not post until the platform upgrade in
`docs/RUNBOOK.md` is live and its throwaway-coin round trip has passed: the copy
describes the live product, and `video/out/x/facts-todo.md` lists every fact
that must be confirmed (or filled) first.

## The package

The publishable copy lives with its media in `video/out/x/`:

| File | What it is |
|---|---|
| `video/out/x/article/article.md` | The X Article "Lock the meme. Earn its pair." Images are marked `[[IMG: file \| caption]]` and live beside it (`cover.png`, `a01-hero.png` … `a09-proof.png`) |
| `video/out/x/pinned.md` | The pinned post: quotes the published Article, with the launch film attached |
| `video/out/x/posts.json` | Five standalone posts `p01`–`p05`: `text`, media file in `video/out/x/posts/`, purpose and image spec |
| `video/out/x/film/imagine-launch.mp4`, `imagine-launch-square.mp4`, `imagine-launch.srt` | The launch film (1920×1080 with voice-over) and its 1080² captioned feed cut; script in `film/vo-script.md`; rendered by `scripts/render-launch-film.sh` |
| `video/out/x/profile/bio.txt`, `avatar.png`, `banner.png` | Profile fields and images |
| `video/out/x/facts-todo.md` | Confirmations for the operator; never published |

Composer payloads mirroring the package: `scripts/x-thread.json` (the pinned
post with the launch film, then `p01`–`p05`; one object per post: `text`,
optional `media`) and `scripts/x-article.json` (`title` and `blocks` of
`["h", text]`, `["h3", text]`, `["p", text]`, `["ul", [items]]`,
`["img", file, caption]`; inline `**bold**` kept as in the source). Regenerate
them whenever the package changes; the package wins.

Older feed media, for replies and follow-ups once checked against the current
copy rules: `video/out/imagine-teaser.mp4`, `imagine-explainer.mp4`,
`imagine-vertical.mp4` and the cards `video/out/cards/01-imagine.png` …
`07-rules.png`.

## Order

1. Profile: name, bio, website from `profile/bio.txt`; avatar and banner.
2. Publish the Article. Once published it cannot be edited without changing its
   URL, so proof it against the live site first.
3. Pinned post: `pinned.md`, quoting the Article, film attached. Pin it.
4. `p01`–`p05`, one or two a day.

## Copy rules

From `docs/BRAND.md`, applied to everything:

- Coins are "Launched on Raydium" — Raydium LaunchLab, under the IMAGINE
  platform. Never mention other launchpads.
- The 0.5% is the coin's **on-chain trading fee** (or "pool fee") that Raydium
  LaunchLab sends to the coin's pool — never "creator fee". Every trade anywhere
  pays it; trades on imagine.fun pay 2% into the pool.
- Say it plainly: the creator earns nothing from fees — they earn only by
  locking, like everyone else.
- Pairs: anything LaunchLab supports — SOL, USDC, tokenized stocks like NVDAx
  and SPYx. Lockers are paid in the pair.
- No emoji, no "gm", no rocket metaphors, no price or yield promises, no
  "guaranteed". Every claim is a mechanism or an allowed fact.
- Real product screenshots only. No raw base58 addresses in early posts from
  a new account (they get silently dropped to drafts); link the security page.
