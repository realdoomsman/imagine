# IMAGINE — X launch content

Site: imagine.fun · Long read: imagine.fun/article · Security: imagine.fun/docs/security

Status: not posted. The account's handle is not decided; nothing here names it,
and the site shows the X and Telegram links only once `NEXT_PUBLIC_X_URL` /
`NEXT_PUBLIC_TELEGRAM_URL` are set.

Posting payloads: `scripts/x-thread.json` (the thread, one object per post:
`text`, optional `media`) and `scripts/x-article.json` (the X Article: `title`
and `blocks` of `["h", text]`, `["p", text]`, `["ul", [items]]`). Media paths
point at the renders in `video/out/`.

Do not post before the mainnet checklist in `docs/RUNBOOK.md` is complete: the
copy describes a live product.

## Voice rules

From `docs/BRAND.md`, applied to everything below: confident, plain, a little
dreamy. "Imagine" opens headlines, not every line. No emoji, no "gm", no rocket
metaphors, no price or yield promises, no "guaranteed". Every claim is a
mechanism or one of the allowed facts. Never promise how much StonkFun forwards.
Attach real product screenshots, never mockups. No raw base58 addresses in posts
from a new account (they get silently dropped to drafts); link the security page.

## Assets

| Asset | File | Use |
|---|---|---|
| Promo film, 1920×1080, ~58 s | `video/out/imagine-promo.mp4` | Pinned post, quoting the Article |
| Teaser, ~15 s | `video/out/imagine-teaser.mp4` | Thread post 1 |
| Explainer, ~30 s | `video/out/imagine-explainer.mp4` | Day 2 standalone |
| Vertical, 1080×1920, ~15 s | `video/out/imagine-vertical.mp4` | Day 1 evening standalone |
| Card "Imagine the chart if nobody sold." | `video/out/cards/01-imagine.png` | Standalone |
| Card "Lock the meme. Earn the stock." | `video/out/cards/02-stock.png` | Thread post 2 |
| Card "Every trade pays the people who lock." | `video/out/cards/03-flow.png` | Thread post 3 |
| Card "Lock longer, earn a bigger cut." | `video/out/cards/04-dial.png` | Thread post 4 |
| Card "Paid in NVDAx, not promises." | `video/out/cards/05-promises.png` | Standalone |
| Card "Selling is free. It just costs you the stream." | `video/out/cards/06-stream.png` | Thread post 6 |
| Card "No admin withdraw path. Creator locks first." | `video/out/cards/07-rules.png` | Thread post 7 |
| Avatar / banner | `video/out/profile/avatar.png`, `banner.png` | Profile |

Cards render from `video/src/cards.ts` with `scripts/render-cards.sh`; films with
`scripts/render-video.sh`; profile images with `scripts/render-profile.sh`.

## Profile

- Name: IMAGINE
- Bio: Lock the meme. Earn the stock. Lock-to-earn for StonkFun coins: every
  trade pays the holders who lock, in the asset the coin is paired with.
- Website: imagine.fun

---

## 1. Launch thread (pin until the film post replaces it)

Exact text is in `scripts/x-thread.json`; this is the readable copy.

**1/** *[video/out/imagine-teaser.mp4]*
Imagine everyone locks.

Every trade on a memecoin pays a fee. On most launchpads none of it reaches the
people holding the coin.

On IMAGINE, it goes to the holders who lock — paid in the stock the coin is
paired with.

imagine.fun

**2/** *[cards/02-stock.png]*
Lock the meme. Earn the stock.

IMAGINE coins launch on StonkFun, where every coin is paired with an asset: an
xStock like NVDAx or SPYx, a stablecoin, or SOL.

A coin paired with NVDAx pays its lockers NVDAx. A SOL-paired coin pays SOL.

**3/** *[cards/03-flow.png]*
Two streams, both in the coin's pair asset:

— 1% of each trade routed through imagine.fun, paid into the coin's pool in
the same tx
— the creator share StonkFun forwards to the coin's creator address: its pool
vault

90% streams to lockers by weight. 10% to treasury.

**4/** *[cards/04-dial.png]*
Your weight is your amount times your term, on a square-root curve so short
locks still count:

4h → 1.00×
1d → 1.14×
7d → 1.41×
30d → 1.86×
90d → 2.49×
180d → 3.11×
365d → 4.00×

Lock 0.1% of supply or more and a size tier adds up to 50% on top.

**5/**
Claiming never touches your lock. Your lock never blocks a claim.

Fees stream in over an hour instead of landing at once, so a share is earned by
holding through time, not by showing up at the right second.

**6/** *[cards/06-stream.png]*
Selling is free. It just costs you the stream.

Break a lock early and your unclaimed rewards go back to the people who stayed,
and a slice of your principal is burned, scaled by how much of your term is
left.

**7/** *[cards/07-rules.png]*
What the program cannot do:

— no admin withdraw path. No instruction moves a pool's funds to an admin
— terms are frozen on each pool at launch
— claims and unlocks cannot be paused
— the creator locks first, in the launch transaction

**8/**
Launching takes one transaction: the coin is created on StonkFun, the dev buy
lands, and the creator's founding lock opens — together.

The coin trades on StonkFun's curve and shows up where StonkFun coins do.

**9/**
No wallet? Sign in with Google and get a Solana address held for you. Lock,
claim, withdraw or export the key whenever you want.

**10/**
The honest part: a coin nobody trades pays nothing, and a locked bag can't be
sold for free into a decline. Every rate on the site is trailing, realised fees.
Nothing is projected.

Source, tests and the security review: imagine.fun/docs/security

**11/**
Imagine the chart if nobody sold.

imagine.fun

## 2. Pinned film post

*[video/out/imagine-promo.mp4]*, quoting the Article once it is published:

> Imagine everyone locks.
>
> Launch a coin on StonkFun, paired with any stock. Every trade pays the holders
> who lock it — in the stock it's paired with. Lock longer, earn a bigger cut.
>
> imagine.fun

## 3. Standalone posts (one or two a day after launch)

1. *[video/out/imagine-vertical.mp4]* — Lock the meme. Earn the stock.
   imagine.fun
2. *[video/out/imagine-explainer.mp4]* — Thirty seconds on where the fee goes:
   from the trade, into the coin's pool, out to the people who locked it, in the
   asset it's paired with.
3. *[cards/05-promises.png]* — Paid in NVDAx, not promises. 90% of each pool's
   inflow streams to its lockers by weight. Terms frozen per pool.
4. *[cards/01-imagine.png]* — Imagine the chart if nobody sold. The homepage
   lets you try it: one slider, "How many holders lock?" Illustrative, and
   labelled that way.
5. *[launch form screenshot]* — Pick the pair. Name the coin. Set your founding
   lock. One transaction puts it on StonkFun with its pool already open.
6. *[portfolio screenshot]* — Claim whenever you like. The lock doesn't move.
7. Text only — Selling is free. It just costs you the stream.

## 4. Article

Title: **Lock the meme. Earn the stock.** Full text in `scripts/x-article.json`
(also at imagine.fun/article). Once published an X Article cannot be edited
without changing its URL, so proof it against the live site first.
