# IMAGINE — brand system

The one source for name, voice, colour, type, mark and motion. Values here are
the shipped ones: `apps/web/app/globals.css` (web), `video/src/theme.ts`
(films and cards) and the per-coin share card
(`apps/web/app/coins/[mint]/opengraph-image.tsx`) carry the same tokens hex for
hex. Change them together.

## Name

- **IMAGINE** in logos, the wordmark and headings. Wordmark: Sora 800, tracking
  −0.02em.
- **Imagine** in running prose ("Imagine pays lockers in the pair asset").
- **$IMAGINE** for the coin only. It is not launched; every official-coin surface
  stays hidden until `NEXT_PUBLIC_OFFICIAL_MINT` is set. Never imply a date.
- Domain **imagine.fun**, API **api.imagine.fun**. Venue: coins are
  "Launched on Raydium" — Raydium LaunchLab, under the IMAGINE platform.
- X: **@LockImagine** (https://x.com/LockImagine). The site's link comes from
  `NEXT_PUBLIC_X_URL` and is hidden while unset. There is no project Telegram.

## Voice

Confident, plain, a little dreamy. Short declarative sentences; every claim is a
mechanism or a fact on the list below. "Imagine …" opens headlines, not every
line.

- No hype numbers, no price or yield promises, no "guaranteed", no emoji, no
  rocket metaphors.
- Vocabulary: lock, commit, hold, dream, vision, *the stream*.
  Never force or squeeze metaphors, and never fire imagery.
- Name the pair asset ("paid in its pair: NVDAx, SOL, USDC") rather than "rewards" in the abstract.

### Key lines

| Use | Line |
|---|---|
| Hero | **Imagine everyone locks.** |
| Hero sub | Launch a coin on Raydium, paired with anything. Every trade pays the holders who lock it — in whatever it's paired with. Lock longer, earn a bigger cut. |
| Tagline | **Lock the meme. Earn its pair.** |
| Supporting | Imagine the chart if nobody sold. · Paid in its pair, not promises. · Selling is free. It just costs you the stream. |

### Facts copy may state (and nothing beyond)

Coins launch on Raydium LaunchLab under the IMAGINE platform, paired with
anything LaunchLab supports: SOL, USDC, tokenized stocks like NVDAx and SPYx.
Every trade anywhere (Raydium, Jupiter, any terminal or bot) pays the coin's
0.5% on-chain trading fee — the pool fee — which Raydium LaunchLab sends to the
coin's pool; trades on imagine.fun add a 1.5% app fee, so **2% goes into the
pool on imagine.fun trades**. Raydium's 0.25% protocol fee also applies. After
graduation to Raydium CPMM the pool keeps earning the CPMM pool fee; the LP is
locked. The fees are enforced on-chain by Raydium LaunchLab. 90% of pool inflow
streams to lockers by weight, 10% to the treasury. **The creator earns nothing
from fees — they earn only by locking, like everyone else.** No admin withdraw
path. Terms frozen per pool. Claims and unlocks can't be paused. The creator
locks first. Lockers earn in the coin's pair asset.

In user-facing copy never call the 0.5% a "creator fee" (LaunchLab's technical
name; its "creator" account is the pool's vault). Say "0.5% on-chain trading
fee" or "pool fee". Never mention other launchpads.

## Palette

Dark teal for structure, so a coin feels at home next to the trading venues it
lives on; one signature of IMAGINE's own on top, the `--dream` gradient.

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#071013` | Page background; text on steel and dream |
| `--ink-1` | `#0B171B` | Recessed wells |
| `--ink-2` | `#102127` | Cards |
| `--ink-3` | `#18262A` | Pills, raised controls |
| `--ink-4` | `#20363D` | Scrollbars, deepest raise |
| `--line` | `#20363D` | 1px borders |
| `--line-strong` | `#2F4F58` | Hover borders |
| `--fg` | `#F3F8F8` | Headings, primary text |
| `--fg-soft` | `#A4C5CF` | Body text |
| `--muted` | `#768A93` | Labels, eyebrows |
| `--steel` | `#69AAC1` | Primary buttons, text `#071013` |
| `--steel-hi` | `#8CC8DC` | Primary hover |
| `--mint` | `#5EE9B5` | Up, earnings |
| `--mint-deep` | `#39D6A3` | Mint on light fills |
| `--rose` | `#FB7185` | Down |
| `--rose-deep` | `#F23674` | Danger |
| `--dream` | `linear-gradient(120deg, #8CC8DC 0%, #5EE9B5 55%, #C7F9E5 100%)` | The mark, wordmark highlights (`.dream-text`), hero accents, active states, `.btn-dream`, `.card-dream` (anything that is the viewer's own) |

Numbers: up = `--mint` (`.up`), down = `--rose` (`.down`). In the video the
same values live in `COLORS`, `DREAM` and `DREAM_STOPS`.

## Type

- **Sora** 400/600/700/800 for display and UI; headings 800 with tight leading
  and negative tracking: `.t-hero` (fluid 2.9–6.6rem, line-height 0.96,
  −0.045em), `.t-h1` (2.2–3.75rem, −0.04em), `.t-h2` (1.65–2.5rem, −0.035em),
  `.t-h3` (1.2rem, 700, −0.02em). Body 15.5px / 1.6.
- **Geist Mono** for numbers, tickers and addresses: `.num` (tabular, slashed
  zero) and `.eyebrow` (11px, uppercase, 0.16em tracking).
- Loaded with `next/font/google` on the web and `@remotion/google-fonts` in the
  video (`video/src/fonts.ts`).

## Shapes and components

Radii: 8px buttons and inputs (`--radius-btn`), 14px cards (`--radius-card`),
999px pills. Cards (`.card`): `--ink-2` fill, 1px `--line` border, inner top
highlight `inset 0 1px 0 rgba(255,255,255,0.04)`; hover lifts the border to
`--line-strong`. Buttons: `.btn-primary` (steel), `.btn-dream`, `.btn-ghost`.
Stock-ticker texture: mono tickers and the pair pill, `.pill-pair` —
"Paired with ● NVDAx", a mint dot and the ticker in mono.

## Mark

A rounded-square tile, 32×32 viewBox, `rx 9`, filled with `--dream`; inside, a
lowercase "i" in `--ink`:

- stem `rect x 13 y 13 width 6 height 12 rx 3` — a held position;
- dot `circle cx 16 cy 8.5 r 3.2` — the idea.

The 120° gradient is expressed in the tile's box as `x1 0 y1 0 x2 1 y2 0.58`.
Files: `apps/web/components/imagine-mark.tsx` (`size` prop) and
`apps/web/app/icon.svg`; the video redraws the same geometry. Change all three
together. Never recolour the tile, outline it, or set the "i" in anything but
`--ink`.

## Hero: "Imagine the chart"

`apps/web/components/imagine-chart.tsx`. A seeded simulation of a
stock-paired meme with one control, "How many holders lock?" (0–100%). At 0%
the sell-offs land in full and the line bleeds out; as the share rises the same
sell orders shrink (locked coins cannot be sold), the line steadies, and a
sample locker's stream accrues in the pair asset (e.g. "+0.042 NVDAx").
Deterministic, labelled illustrative, and still under
`prefers-reduced-motion`.

## Motion

- Easing: `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)` for everything that
  settles; `--ease-snap` `cubic-bezier(0.7, 0, 0.2, 1)` for decisive moves.
- Reveal on scroll: fade + 16px rise, 700ms opacity / 800ms transform.
- Card borders 180ms; route enter 380ms.
- Loops are slow and quiet: marquee 48s, flow runner 3.2s, pulse dot 2s.
- `prefers-reduced-motion: reduce` collapses animations and transitions,
  shows reveals immediately and stops the marquee.
- Video (`video/src/theme.ts`): 30 fps; `ease` is a cubic ease-out ("quick
  start, long gentle landing"), `easeInOut` a cubic in-out.

## Film and stills

Rendered by Remotion from `video/` (see `docs/RUNBOOK.md` → Media):

| Asset | File |
|---|---|
| Promo, 1920×1080, ~58 s | `video/out/imagine-promo.mp4`; web copy `apps/web/public/film/imagine-promo.mp4` + `poster.jpg` |
| Teaser, 1920×1080, ~15 s | `video/out/imagine-teaser.mp4` |
| Explainer, 1920×1080, ~30 s | `video/out/imagine-explainer.mp4` |
| Vertical, 1080×1920, ~15 s | `video/out/imagine-vertical.mp4` |
| X launch film, 1920×1080 ~80 s with voice-over, plus a 1080² feed cut with burned-in captions | `video/out/x/film/imagine-launch.mp4`, `imagine-launch-square.mp4`, `imagine-launch.srt` (from `video/src/x-film`, `video/audio/vo.py` + `launch.py`; `scripts/render-launch-film.sh`) |
| X cards, 1600×900 | `video/out/cards/01-imagine.png` … `07-rules.png` (from `video/src/cards.ts`) |
| Avatar 400², banner 1500×500, OG card 1200×630 | `video/out/profile/avatar.png`, `banner.png`, `card.png`; OG copy at `apps/web/app/opengraph-image.png` |
| Per-coin share card, 1200×630 (og:image and twitter:image of every coin page) | `apps/web/app/coins/[mint]/opengraph-image.tsx`, drawn on request from the API (5-minute cache) with Sora + Geist Mono TTFs from `apps/web/assets/fonts/`; unknown coin or API down → a generic IMAGINE card |
| X launch package (article images, posts, pinned post, profile) | `video/out/x/article/`, `video/out/x/posts/`, `video/out/x/profile/` (see `docs/LAUNCH-X.md`) |
| Platform logo, 512² (written into the IMAGINE LaunchLab PlatformConfig) | `apps/web/public/brand/imagine-512.png` → https://imagine.fun/brand/imagine-512.png |
