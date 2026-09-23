# VISE — X content

Handle: `@visedotfun` · Site: `vise.fun`

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

*[attach: vise-teaser.mp4]*

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

No emissions. No printed tokens. No treasury subsidy. Just the fees that were
always being paid, going somewhere else.

**4/**
To earn from it, you lock.

Your weight is your amount times your term:

7d → 1.00×
30d → 1.19×
90d → 1.70×
180d → 2.45×
365d → 4.00×

Same bag. Four times the claim on the same stream.

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

## 2. Standalone posts

**The thesis**
> Selling is free. Holding is not.
> Every platform in this market pays for the first and charges for the second.
> That is backwards and it is fixable.

**The mechanism, in one post**
> Trade a VISE coin: 2% of the SOL goes into that coin's vault.
> Lock the coin: you own a slice of the vault, sized by how long you committed.
> Claim whenever. The lock never blocks it.
> That is the entire product.

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
> You keep up to 30% of your coin's fee stream, forever, permissionlessly
> claimable.
> The other 70% pays the people who didn't sell yours.
> That is a better deal than 100% of a chart nobody holds.

**The comparison**
> pump.fun pays holders a share of creator fees.
> VISE pays them by time committed, on any coin, with the split frozen at launch
> and the routing unable to be revoked.
> Same stream. Different question: who actually stayed?

---

## 3. Launch-week sequence

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

## 4. Replies worth having ready

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
