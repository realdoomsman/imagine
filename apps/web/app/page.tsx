import Link from "next/link";
import { Suspense } from "react";
import { api } from "@/lib/api";
import { Hero } from "@/components/hero";
import { ImagineMark } from "@/components/imagine-mark";
import { Reveal } from "@/components/motion";
import { StatMarquee } from "@/components/stat-marquee";
import { FlowDiagram } from "@/components/flow-diagram";
import { Film } from "@/components/film";
import { Faq } from "@/components/faq";
import { OfficialCoinBanner } from "@/components/official-coin";
import { CoinCard } from "@/components/coin-card";
import { CoinCardSkeleton } from "@/components/skeleton";

export default function HomePage() {
  return (
    <>
      <Hero />
      <OfficialCoinBanner />
      <div className="mt-10">
        <StatMarquee />
      </div>
      <LiveCoinsSection />
      <Steps />
      <Pairs />
      <FeeFlow />
      <Guarantees />
      <Film />
      <Faq />
      <Cta />
    </>
  );
}

function LiveCoinsSection() {
  return (
    <section className="container-x pt-16 lg:pt-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow">
            <i className="pill-dot pulse-dot" aria-hidden="true" />
            Live on IMAGINE
          </span>
          <h2 className="t-h2 mt-3">Coins people are locking</h2>
        </div>
        <Link href="/coins" className="btn btn-ghost btn-sm">
          All coins →
        </Link>
      </div>
      <Suspense
        fallback={
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <CoinCardSkeleton key={i} />
            ))}
          </div>
        }
      >
        <LiveCoins />
      </Suspense>
    </section>
  );
}

async function LiveCoins() {
  const result = await api.pools({ sort: "rewards", limit: 6 }).then(
    (value) => ({ pools: value.pools, failed: false }),
    () => ({ pools: [], failed: true }),
  );

  if (result.pools.length === 0) {
    return (
      <div className="card mt-6 flex flex-col items-center gap-4 px-6 py-12 text-center">
        <ImagineMark size={40} className="opacity-50" />
        <p className="t-h3">
          {result.failed ? "Live coins can't be loaded right now." : "No coins yet. Imagine yours first."}
        </p>
        <p className="max-w-[46ch] text-[14px] text-fg-soft">
          {result.failed
            ? "The index didn't answer. Coins and vaults live on-chain either way; try again in a moment."
            : "Launch a coin on StonkFun through IMAGINE, lock first, and it shows up here."}
        </p>
        <Link href={result.failed ? "/coins" : "/launch"} className="btn btn-primary btn-sm">
          {result.failed ? "Open coins" : "Launch a coin"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {result.pools.map((pool) => (
        <CoinCard key={pool.mint} pool={pool} />
      ))}
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Launch on StonkFun",
    body: "Pick what your coin is paired with: a stock like NVDAx, a currency like USDC, or SOL. The coin goes live on StonkFun, and its creator address is the coin's IMAGINE vault. The creator locks first.",
  },
  {
    n: "02",
    title: "Holders lock",
    body: "Choose an amount and a term, from four hours to a year. Weight is amount × time: 1.00× at four hours up to 4.00× at a year, with a bonus for a serious share of supply.",
  },
  {
    n: "03",
    title: "Every trade pays the stream",
    body: "The 1% app fee on trades through imagine.fun and StonkFun's forwarded creator share land in the vault. 90% streams to lockers by weight, in the pair asset.",
  },
];

function Steps() {
  return (
    <section className="container-x py-20 lg:py-28">
      <Reveal>
        <div className="max-w-3xl">
          <span className="eyebrow">How it works</span>
          <h2 className="t-h1 mt-4">
            Lock the meme. <span className="dream-text">Earn its pair.</span>
          </h2>
          <p className="t-lede mt-5">
            No new token, no emissions. Fees that trades already pay go to the people who
            committed, in whatever the coin is paired with.
          </p>
        </div>
      </Reveal>
      <ol className="mt-12 grid gap-3 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.n}>
            <Reveal delay={index * 90} className="h-full">
              <article className="card card-hover h-full p-6">
                <span
                  className="num flex size-10 items-center justify-center rounded-[10px] text-[13px] font-semibold text-ink"
                  style={{ background: "var(--dream)" }}
                >
                  {step.n}
                </span>
                <h3 className="t-h3 mt-6">{step.title}</h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-fg-soft">{step.body}</p>
              </article>
            </Reveal>
          </li>
        ))}
      </ol>
      <Reveal delay={200}>
        <Link
          href="/how-it-works"
          className="group mt-8 inline-flex items-center gap-2 text-[14px] font-semibold text-steel-hi"
        >
          Read the mechanics
          <span className="transition-transform duration-200 group-hover:translate-x-1">→</span>
        </Link>
      </Reveal>
    </section>
  );
}

const PAIRS = [
  { symbol: "NVDAx", kind: "Tokenized stock" },
  { symbol: "SPYx", kind: "Tokenized ETF" },
  { symbol: "TSLAx", kind: "Tokenized stock" },
  { symbol: "USDC", kind: "Currency" },
  { symbol: "SOL", kind: "Solana" },
];

function Pairs() {
  return (
    <section className="border-y border-line bg-ink-1">
      <div className="container-x py-20 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
          <Reveal>
            <span className="eyebrow">Paired with anything</span>
            <h2 className="t-h1 mt-4 max-w-[13ch]">Paid in its pair, not promises.</h2>
            <p className="t-lede mt-5">
              StonkFun prices every coin in a pair asset. Its trades pay in that asset, so its
              lockers do too. A coin paired with NVDAx pays its lockers NVDAx; a SOL-paired coin
              pays SOL; a USDC-paired coin pays USDC.
            </p>
          </Reveal>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PAIRS.map((pair, index) => (
              <Reveal key={pair.symbol} delay={index * 60}>
                <div className="card card-hover h-full p-5">
                  <span className="pill pill-pair h-6 px-2 text-[11px]">
                    <span className="pill-label">Paired with</span>
                    <i className="pill-dot" aria-hidden="true" />
                    <b>{pair.symbol}</b>
                  </span>
                  <p className="mt-6 text-[12.5px] text-muted">{pair.kind}</p>
                  <p className="mt-1 text-[13px] text-fg-soft">Lockers earn</p>
                  <p className="num up text-[24px] font-semibold leading-tight tracking-[-0.03em]">
                    +{pair.symbol}
                  </p>
                </div>
              </Reveal>
            ))}
            <Reveal delay={PAIRS.length * 60}>
              <Link
                href="/launch"
                className="card card-dream flex h-full flex-col justify-between gap-6 p-5"
              >
                <span className="eyebrow">Your pick</span>
                <span className="text-[17px] font-bold leading-snug text-fg">
                  Any pair StonkFun opens for launch →
                </span>
              </Link>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeeFlow() {
  return (
    <section className="container-x py-20 lg:py-28">
      <Reveal>
        <div className="max-w-3xl">
          <span className="eyebrow">Where the fee goes</span>
          <h2 className="t-h1 mt-4">
            Every trade splits <span className="dream-text">ninety–ten.</span>
          </h2>
        </div>
      </Reveal>
      <Reveal delay={120}>
        <FlowDiagram />
      </Reveal>
      <Reveal delay={200}>
        <p className="mt-10 max-w-[68ch] text-[15px] leading-relaxed text-fg-soft">
          The split is frozen when the pool is created. The creator takes 0% by default and earns
          the way everyone else does, by locking. StonkFun&apos;s 1% fee on curve trades and the
          Raydium LaunchLab protocol fee are theirs; what reaches the vault is the app fee on
          trades imagine.fun routes, the creator share StonkFun forwards, and donations.
        </p>
      </Reveal>
    </section>
  );
}

const GUARANTEES = [
  {
    title: "No admin withdraw path",
    body: "There is no instruction that moves a vault's rewards or a locked balance anywhere except to the people who earned or own them.",
  },
  {
    title: "Claims and unlocks can't be paused",
    body: "The pause switch stops new pools. Claiming and unlocking never read it.",
  },
  {
    title: "Terms frozen per pool",
    body: "Multiplier curve, size tiers, the 90/10 split, the early-exit penalty, the stream window: written once when the pool is made.",
  },
  {
    title: "The creator locks first",
    body: "A pool opens with the creator's own lock, public on the coin's page before anyone else can join.",
  },
];

function Guarantees() {
  return (
    <section className="border-t border-line">
      <div className="container-x py-20 lg:py-28">
        <Reveal>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <span className="eyebrow">Written into the program</span>
              <h2 className="t-h1 mt-4 max-w-[15ch]">A dream, with hard edges.</h2>
            </div>
            <Link href="/docs/security" className="btn btn-ghost btn-sm self-start md:self-auto">
              Security model →
            </Link>
          </div>
        </Reveal>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GUARANTEES.map((item, index) => (
            <Reveal key={item.title} delay={index * 70} className="h-full">
              <article className="card card-hover h-full p-6">
                <ImagineMark size={22} />
                <h3 className="mt-5 text-[16.5px] font-bold leading-snug tracking-[-0.02em] text-fg">
                  {item.title}
                </h3>
                <p className="mt-2.5 text-[14px] leading-relaxed text-fg-soft">{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="container-x pb-24 lg:pb-32">
      <div className="card relative isolate overflow-hidden px-6 py-16 text-center sm:px-12 lg:py-24">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -bottom-1/2 -z-10 mx-auto h-full max-w-[900px] rounded-full opacity-[0.22] blur-3xl"
          style={{ background: "var(--dream)" }}
        />
        <ImagineMark size={52} className="mx-auto" />
        <h2 className="t-h1 mx-auto mt-8 max-w-[16ch]">
          Selling is free. It just costs you <span className="dream-text">the stream.</span>
        </h2>
        <p className="t-lede mx-auto mt-5 text-center">
          Launch a coin on StonkFun with its vault already wired, or find one worth locking.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href="/launch" className="btn btn-dream btn-lg">
            Launch a coin
          </Link>
          <Link href="/coins" className="btn btn-ghost btn-lg">
            Browse coins
          </Link>
        </div>
      </div>
    </section>
  );
}
