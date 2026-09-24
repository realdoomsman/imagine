# VISE — X content

Handle: `@ViseDotFun` · Site: `vise.fun`

## Live (2026-09-23)

- Pinned post (60s film, quoting the Article):
  see "Pinned" below once posted; the thread is no longer pinned.

- Pinned thread (14 posts, teaser video on the first):
  https://x.com/ViseDotFun/status/2102748079682195471
- X Article "Selling is free. Holding is not.":
  https://x.com/ViseDotFun/status/2102756902497071221 (also https://vise.fun/article)
- 16 standalone posts with the stills from `video/out/cards`, one product
  screenshot (launch form). Post 12 shipped without the raw program ID:
  a bare base58 address in a new account's post was silently dropped to
  drafts; it links the security page instead.
- Following: pump.fun, Solana, wallets, aggregators, sister products.
  Replies left on six live fee-routing / holder-reward conversations.
- Profile: avatar and banner from `scripts/render-profile.sh`; the
  checkmark shows "Under review" after the name/photo change, per X.

Posting tooling: `scripts/x-thread.json` and `scripts/x-article.json` are
the exact payloads; they were driven through the real composer in the
logged-in browser (CDP input, `DOM.setFileInputFiles` for media).

Voice rules, applied to everything below: no emoji, no "gm", no "wagmi", no
rocket metaphors, no "revolutionary". Short declarative sentences. Every claim
is a number or a mechanism. Attach the real product screenshot, never a mockup.

---

## 1. Launch thread (pin this)

**1/**
Every memecoin has exactly one real revenue stream: the fees people pay to trade
it.

That money goes to a launchpad and a dev wallet. Never to the people actually
holding the thing.

VISE changes where it lands.

*[attach: video/out/vise-teaser.mp4 — 12s, with score]*

Long version: vise.fun/article

**2/**
Launch a coin on pump.fun through VISE and its fee stream gets pointed at a vault
for its holders.

Not by a promise. By pump's own fee-sharing program, with an instruction that
revokes its own admin.

After it lands, nobody can redirect it. Not the dev. Not us.

**3/**
Two streams flow into that vault, both in SOL:

— 2% of the SOL on every trade routed through vise.fun
— the coin's pump.fun creator fees, in full

90% of it is paid to lockers. 10% runs VISE. The creator's cut is zero: they
earn the way everyone else does, by locking.

No emissions. No printed tokens. No treasury subsidy. Just the fees that were
always being paid, going somewhere else.

**4/**
To earn from it, you lock.

Your weight is your amount times your term, on a square-root curve so short
locks are still worth making:

7d → 1.00×
30d → 1.76×
90d → 2.44×
180d → 3.09×
365d → 4.00×

Lock 0.1% of supply or more and a size tier adds up to 50% on top. Same bag,
up to six times the claim on the same stream.

*[attach: multiplier ladder screenshot]*

**5/**
Claiming never touches your lock. Your lock never blocks a claim.

You can harvest every day of a one-year position and the position does not move.

**6/**
Breaking a lock early costs two things, and both go to the people who stayed:

— unclaimed rewards are forfeited and redistributed
— a slice of principal is burned, scaled by how much of your term is left

Leave on day 1 of 100, it hurts. Leave on day 99, it barely registers.

**7/**
The part that matters is what the program cannot do.

There is no instruction that moves a pool's SOL or tokens to an admin. Not
disabled. Not timelocked. It does not exist in the bytecode.

**8/**
A pool's terms — fee split, multiplier curve, penalty, lock bounds — are copied
onto it at creation and are immutable.

We can change the defaults for future coins. We cannot touch yours.

**9/**
The pause switch blocks new pools. That is all it can do.

Claiming and unlocking are not pausable. There is no code path that would let
them be.

**10/**
Creators cannot open a pool without locking their own bag in the same
instruction.

They are exposed before anyone else is, and the amount and term are public on
the coin's page from block one.

**11/**
Rounding always favours the pool.

A randomised test drives thousands of locks, deposits, claims and exits and
asserts, after every single step, that the vault can still pay everyone it owes.

**12/**
What this does not do: make a bad coin good.

The coin can still go to zero, and locking makes that worse because you cannot
sell into the decline for free. A coin with no volume pays nothing.

That is the honest version.

**13/**
vise.fun

Hold under pressure.

---

## 2. Twenty posts, with their visuals

Visuals render from `video/src/cards.ts` via `scripts/render-cards.sh` into
`video/out/cards/NN-*.png`. Post in this order, roughly two a day, the thread
pinned above them. Each post stands alone; none needs the one before it.

01 · `01-thesis.png`
> Selling is free. Holding is not.
> Every platform in this market pays for the first and charges for the second.
> That is backwards and it is fixable. vise.fun

02 · `02-revenue.png`
> A memecoin has exactly one revenue stream: the fee people pay to trade it.
> On pump.fun that is about 1% of every buy and sell, in SOL, for the life of
> the coin. Follow where it goes. None of it reaches the people holding.

03 · `03-flow.png`
> Trade a VISE coin: 2% of the SOL goes into that coin's vault, inside the same
> transaction as the swap. If the trade fails, the fee is never taken.
> Lock the coin: you own a slice of the vault. Claim whenever.

04 · `04-split.png`
> One split, frozen on the pool at creation: 90% to lockers, 10% to VISE, 0% to
> the creator. A creator earns the way everyone does, by locking, and their
> founding lock is public from block one.

05 · `05-ladder.png`
> Longer locks take more. A square-root curve from 1× at seven days to 4× at
> a year: 30d already counts 1.76×, 90d counts 2.44×. Short locks are still
> worth making. Long ones are worth more.

06 · `06-tiers.png`
> Size counts too. Lock 0.1% of supply and your weight gets +10%. Half a
> percent, +25%. A full percent, +50%. Tiers are a share of total supply, so
> everyone is measured on the same scale.

07 · `07-vise-30.png`
> Thirty days. Already 1.76×.

08 · `08-vise-365.png`
> A year. Four times the claim on the same stream. Six times, if it is a
> percent of the supply.

09 · `09-claim.png`
> Claiming never touches the lock. The lock never blocks a claim.
> Harvest a year-long position every day; the position does not move.

10 · `10-penalty.png`
> You can always break a lock. Your unclaimed rewards go to the people who
> stayed. Part of your principal burns, scaled by the time you did not serve.
> Exits should cost something. Here they pay the people who didn't take one.

11 · `11-cannot.png`
> What the program cannot do: move a pool's money to an admin, change a pool's
> terms, pause a claim, or redirect the fee stream. None of those are disabled.
> None are timelocked. The instructions do not exist.

12 · `12-program.png`
> "Trust us" is not a security model. Zero admin withdraw instructions in the
> bytecode. Read it: VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb

13 · `13-creator.png`
> To creators: launch through VISE and your fee stream pays the people who did
> not sell your coin. You take 0% by default and earn by locking your own bag.
> That is the pitch to your holders, and it is true.

14 · `14-google.png`
> No wallet? Sign in with Google. You get an ordinary Solana address, held for
> you. Send coins to it, lock from it, withdraw whenever. Export the key any
> time. There is no step where we get to say no.

15 · `15-apr.png`
> Every APR on the site is trailing realised fees divided by locked value.
> Nothing is projected. Nothing is annualised from one good hour. If a coin
> stops trading its number goes to zero, and it should.

16 · `16-honest.png`
> This does not make a bad coin good. A coin with no volume pays nothing.
> A locked bag in a coin going to zero is worse than an unlocked one.
> If you were not going to hold, do not lock. That is the honest version.

17 · `17-rounding.png`
> Rounding always favours the pool. A randomised test drives thousands of
> locks, deposits, claims and exits and asserts, after every single step, that
> the vault can still pay everyone it owes.

18 · `18-launch.png`
> Launching takes one form: name, ticker, an image from your disk, a dev buy,
> and how much of it you lock. Create on pump.fun, open the pool, route the
> fees. The routing call is the last signature and it revokes its own admin.

19 · `19-staking.png`
> "So it is staking?" Staking pays you in newly printed tokens and dilutes
> everyone else. This pays you in SOL that traders already spent. Nothing is
> minted. The APR is realised fees, trailing.

20 · `20-close.png`
> Hold under pressure. vise.fun

## 3. Standalone replies and older post drafts

**The thesis**
> Selling is free. Holding is not.
> Every platform in this market pays for the first and charges for the second.
> That is backwards and it is fixable.

**The mechanism, in one post**
> Trade a VISE coin: 2% of the SOL goes into that coin's vault.
> Lock the coin: you own a slice of the vault, sized by how long and how much
> you committed.
> Claim whenever. The lock never blocks it.
> That is the entire product.

**No wallet needed**
> Sign in with Google. You get a Solana wallet held for you: send SOL or a
> coin to it, lock from it, withdraw whenever, export the key any time.
> No extension. No seed phrase to lose on day one.

**On trust**
> "Trust us" is not a security model.
> The fee routing revokes its own admin. The pool terms are immutable after
> creation. There is no admin withdraw instruction in the program.
> Read it: VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb

**On the penalty**
> You can always break a lock.
> Your unclaimed rewards go to the people who stayed. Part of your principal
> burns, scaled by the time you did not serve.
> Exits should cost something. Here they pay the people who didn't take one.

**On APR**
> Every APR on this site is trailing realised fees divided by locked value.
> Nothing is projected. Nothing is annualised from one good hour.
> If a coin stops trading, its number goes to zero, and it should.

**Creator-facing**
> Launch through VISE and your fee stream pays the people who did not sell
> your coin. 90% to lockers, 10% to VISE, 0% to you by default.
> You earn by locking your own bag, same as everyone. Your founding lock is
> public from block one. That is the pitch to your holders, and it is true.

**The comparison**
> pump.fun pays holders a share of creator fees.
> VISE pays them by time committed, on any coin, with the split frozen at launch
> and the routing unable to be revoked.
> Same stream. Different question: who actually stayed?

---

## 4. Launch-week sequence

**Day 0 — 14:00 UTC**
Pin the thread. Post the teaser. Reply to the pin with the program ID and a link
to the tests.

**Day 1**
Post the explainer video. One reply with the multiplier table as a screenshot
from the live app.

**Day 2**
"First coin clamped" — screenshot of a real coin page showing supply clamped and
SOL paid out. Numbers only, no adjectives.

**Day 3**
The security post: what the program cannot do, five bullets, link to the source.

**Day 4**
Creator thread: how to launch, what you keep, what you give up. Direct link to
/launch.

**Day 5**
Leaderboard screenshot. Top earners, real SOL claimed.

**Day 7**
One-week numbers: total fees routed, SOL paid to lockers, percentage of supply
clamped across all pools, longest live lock.

---

## 5. Replies worth having ready

**"So it's just staking?"**
> Staking usually pays you in newly printed tokens, which dilutes you. This pays
> you in SOL that traders already spent. Nothing is minted.

**"What stops you rugging the vault?"**
> The absence of an instruction that could. There is no admin transfer path in
> the program. Pause only blocks new pools; it cannot touch claims or unlocks.

**"Why would I lock in a memecoin?"**
> Mostly you shouldn't. If you were going to hold anyway, this pays you for the
> holding you were already doing. If you weren't, don't lock.

**"What's the catch?"**
> Illiquidity. You cannot sell a locked bag without burning part of it. That is
> the entire cost, and it is the point.
