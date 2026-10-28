# IMAGINE — X launch

Account: **@LockImagine** (https://x.com/LockImagine) · Site: imagine.fun ·
Long read: imagine.fun/article · Security: imagine.fun/docs/security

## What shipped

Launched 2026-10-28, after the platform upgrade in `docs/RUNBOOK.md` was live
on mainnet.

| Post | Status | Link / time | Copy | Media |
|---|---|---|---|---|
| X Article "Lock the meme. Earn its pair." | Live | share post https://x.com/LockImagine/status/2115306999126638814 · article https://x.com/i/article/2115306523387699200 | `video/out/x/article/article.md` | `video/out/x/article/cover.png`, `a01-hero.png` … `a09-proof.png` (9 captioned figures) |
| Pinned post, quoting the Article | Live, pinned | https://x.com/LockImagine/status/2115307378723717286 | `video/out/x/pinned.md` | `video/out/x/film/imagine-launch.mp4` (~80 s, voice-over) with `imagine-launch.srt` captions |
| p01 — "Imagine the chart if nobody sold." | Live | https://x.com/LockImagine/status/2115307640263700931 | `video/out/x/posts.json` | `video/out/x/posts/p01.mp4` (homepage slider, recorded on live imagine.fun) |
| p02 — fees enforced on-chain | Scheduled | Oct 28, 4:30 AM Toronto | `posts.json` | `video/out/x/posts/p02.png` (fee flow), alt text set |
| p03 — how a lock's weight is set | Scheduled | Oct 28, 8:00 AM Toronto | `posts.json` | `video/out/x/posts/p03.png` (weight curve), alt text set |
| p04 — live on mainnet, code public | Scheduled | Oct 28, 11:30 AM Toronto | `posts.json` | `video/out/x/posts/p04.png` (proof: platform config, program on Explorer), alt text set |
| p05 — launching a coin, step by step | Scheduled | Oct 28, 3:00 PM Toronto | `posts.json` | `video/out/x/posts/p05.mp4` (walkthrough recorded on live imagine.fun/launch) |

The Article's Proof section names the platform config
`DYtCiTPJoqCyDApm45b9C7D3xotkSDecJaAtQHaQNULk` and the test counts (17 Rust
unit tests, 115 integration tests). Scheduled posts are managed in X's
scheduled list (x.com/compose/post/unsent/scheduled).

Profile: name, bio and website from `video/out/x/profile/bio.txt`; avatar and
banner `video/out/x/profile/avatar.png`, `banner.png`.

Also sent: three replies to existing Raydium/launchpad conversations, each
after liking the post, no links; only the one answering "who's building
this?" names IMAGINE:
https://x.com/LockImagine/status/2115308221506134148,
https://x.com/LockImagine/status/2115312077552369854,
https://x.com/LockImagine/status/2115315930083598683.

Housekeeping: an unpublished Article draft from before the platform move is
still in X's Article drafts; delete it.

## Source files

| File | What it is |
|---|---|
| `video/out/x/article/article.md` | Article source; images marked `[[IMG: file \| caption]]` |
| `video/out/x/article/x-article.json` | The same Article as composer segments (`title`, `segments` of `html` / `fig`) |
| `video/out/x/pinned.md` | Pinned post body (below the `---`) |
| `video/out/x/posts.json` | `p01`–`p05`: `text`, media file in `video/out/x/posts/`, purpose, image spec, source facts |
| `video/out/x/film/` | `imagine-launch.mp4`, `imagine-launch-square.mp4` (1080² captioned feed cut), `imagine-launch.srt`, `vo-script.md`; rendered by `scripts/render-launch-film.sh` |
| `video/out/x/facts-todo.md` | Pre-publication confirmations; never published |
| `video/out/x/raw/` | Screen recordings and stills the posts were cut from, plus QA contact sheets (`qa-film.png`, `qa-p01.png`, `qa-p05.png`) |

Mirrors for scripted posting: `scripts/x-thread.json` (pinned post with the
film, then `p01`–`p05`; objects of `text`, optional `media`) and
`scripts/x-article.json` (`title` and `blocks` of `["h", text]`,
`["h3", text]`, `["p", text]`, `["ul", [items]]`, `["img", file, caption]`).
They are generated from the files above; those win.

Older feed media, for replies and follow-ups once checked against the copy
rules below: `video/out/imagine-teaser.mp4`, `imagine-explainer.mp4`,
`imagine-vertical.mp4`, the cards `video/out/cards/01-imagine.png` …
`07-rules.png`, and the square cut `video/out/x/film/imagine-launch-square.mp4`.

## Copy rules for everything that follows

From `docs/BRAND.md`:

- Coins are "Launched on Raydium" — Raydium LaunchLab, under the IMAGINE
  platform. Never mention other launchpads.
- The 0.5% is the coin's **on-chain trading fee** (or "pool fee") that Raydium
  LaunchLab sends to the coin's pool — never "creator fee". Every curve trade
  anywhere pays it; trades on imagine.fun pay 2% into the pool. Raydium's 0.25%
  protocol fee is Raydium's.
- Say it plainly: the creator earns nothing from fees — they earn only by
  locking, like everyone else.
- Pairs: anything LaunchLab supports — SOL, USDC, tokenized stocks like NVDAx
  and SPYx. Lockers are paid in the pair.
- No emoji, no "gm", no rocket metaphors, no price or yield promises, no
  "guaranteed". Every claim is a mechanism or an allowed fact.
- Real product footage only. Replies: like first, no links, mention IMAGINE
  only when it answers the question asked.
