import Link from "next/link";
import { Hero } from "@/components/hero";
import { ViseMark } from "@/components/vise-mark";
import { Reveal, Magnetic } from "@/components/motion";
import { StatMarquee } from "@/components/stat-marquee";
import { FlowDiagram } from "@/components/flow-diagram";
import { Film } from "@/components/film";
import { Faq } from "@/components/faq";
import { OfficialCoinBanner } from "@/components/official-coin";

export default function HomePage() {
  return (
    <>
      <Hero />
      <OfficialCoinBanner />
      <StatMarquee />
      <Film />
      <HowItWorks />
      <Split />
      <Guarantees />
      <Faq />
      <Cta />
    </>
  );
}

const STEPS = [
  {
    n: "01",
    title: "A coin launches on pump.fun",
    body: "Through VISE, so the creator-fee stream points at its lock pool from the first block. Nothing custom, nothing new to trust — an ordinary coin on an ordinary bonding curve.",
  },
  {
    n: "02",
    title: "Holders clamp their bags",
    body: "Pick an amount and a term from 4 hours to a year. Even the shortest lock earns: weight is amount × term on a front-loaded curve — 1.0× at 4 hours, 1.41× at a week, 1.86× at a month, 4.0× at a year — and up to +50% more for a serious share of supply. The tokens sit in a vault only you can open.",
  },
  {
    n: "03",
    title: "Every trade feeds the vault",
    body: "A 2% app fee on trades routed through VISE, plus the coin's entire pump.fun creator-fee stream, land in that vault as SOL. 90% of it is for lockers. No emissions, no printed tokens, no new supply.",
  },
  {
    n: "04",
    title: "Claim whenever you like",
    body: "Rewards accrue continuously by weight. Claiming never touches your lock, and a lock never blocks a claim. When the term ends, take your coins back.",
  },
];

function HowItWorks() {
  return (
    <section className="relative mx-auto max-w-[1440px] px-5 py-32 sm:px-8 lg:py-44">
      <div className="grid gap-16 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] lg:gap-24">
        {/* Left rail stays put while the steps scroll past it. */}
        <div className="lg:sticky lg:top-32 lg:self-start">
          <Reveal>
            <span className="rule-label">How it works</span>
            <h2 className="t-section mt-5">
              Four moves.
              <br />
              <span className="text-steel-600">No new tokens.</span>
            </h2>
            <p className="t-lede mt-7">
              VISE does not mint anything, does not promise a yield, and does not
              hold your coins. It routes fees that already exist to the people who
              stayed.
            </p>
            <Link
              href="/how-it-works"
              className="group mt-8 inline-flex items-center gap-2 text-[14px] font-medium text-torch"
            >
              Read the mechanics
              <span className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1">
                →
              </span>
            </Link>
          </Reveal>
        </div>

        <ol className="space-y-px">
          {STEPS.map((step, index) => (
            <li
              key={step.n}
              className="group/step relative border-t border-steel-780 first:border-t-0"
            >
              <Reveal delay={index * 80}>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-6 py-9 sm:gap-10">
                  <span className="num pt-1 text-[13px] text-steel-600 transition-colors duration-500 group-hover/step:text-torch">
                    {step.n}
                  </span>
                  <div>
                    <h3 className="t-sub text-steel-50">{step.title}</h3>
                    <p className="mt-3 max-w-[54ch] text-[15.5px] leading-[1.65] text-steel-400">
                      {step.body}
                    </p>
                  </div>
                </div>
              </Reveal>
              {/* A filament that lights along the divider on hover. */}
              <span
                className="pointer-events-none absolute inset-x-0 -top-px h-px origin-left scale-x-0 transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/step:scale-x-100"
                style={{
                  background:
                    "linear-gradient(90deg, var(--color-torch), transparent)",
                }}
              />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Split() {
  return (
    <section className="relative overflow-hidden border-y border-steel-780">
      <div className="grid-lines pointer-events-none absolute inset-0 opacity-60" />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-px w-[60%] -translate-x-1/2"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,90,31,0.5), transparent)",
        }}
      />

      <div className="relative mx-auto max-w-[1440px] px-5 py-32 sm:px-8 lg:py-44">
        <Reveal>
          <div className="max-w-3xl">
            <span className="rule-label">Where the fee goes</span>
            <h2 className="t-section mt-5">
              Every trade splits
              <br />
              <span className="text-torch">ninety–ten.</span>
            </h2>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <FlowDiagram />
        </Reveal>

        <Reveal delay={200}>
          <p className="mt-14 max-w-[62ch] text-[15.5px] leading-[1.7] text-steel-400">
            The split is fixed when the pool is created and can never be changed —
            not by us, not by the coin's creator, who takes nothing from it. The
            lockers' 90% is paid out by weight, streamed over an hour while every
            lock runs at least four, so nobody can front-run a distribution by locking one block before it lands.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

const GUARANTEES = [
  {
    title: "No admin key over your coins",
    body: "There is no instruction in the program that moves a locked balance anywhere except back to its owner. Not a disabled one — it does not exist in the bytecode.",
  },
  {
    title: "Claims can never be paused",
    body: "Claiming and unlocking have no authority check and no pause flag. If our servers vanish tomorrow, the program keeps paying and anyone can call it.",
  },
  {
    title: "Terms are frozen at creation",
    body: "Multiplier curve, size tiers, the 90/10 split, penalty, stream length: written once when the pool is made, then immutable. Changing them would require a new pool.",
  },
  {
    title: "Rewards stream, never dump",
    body: "Incoming SOL is released linearly over an hour, and the shortest lock is four. Locking a second before a big trade earns a second of rewards, not a slice of the whole thing.",
  },
];

function Guarantees() {
  return (
    <section className="mx-auto max-w-[1440px] px-5 py-32 sm:px-8 lg:py-44">
      <Reveal>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="rule-label">What is guaranteed</span>
            <h2 className="t-section mt-5 max-w-[16ch]">
              Written into the program, not the pitch.
            </h2>
          </div>
          <Link
            href="/docs/security"
            className="group inline-flex shrink-0 items-center gap-2 text-[14px] font-medium text-steel-300 transition-colors hover:text-steel-50"
          >
            Security model
            <span className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1">
              →
            </span>
          </Link>
        </div>
      </Reveal>

      <div className="mt-16 grid gap-px sm:grid-cols-2 lg:grid-cols-4">
        {GUARANTEES.map((item, index) => (
          <Reveal key={item.title} delay={index * 70}>
            <article className="surface group/card relative h-full overflow-hidden p-7 transition-colors duration-500 hover:border-steel-600/50">
              <span
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/card:opacity-100"
                style={{
                  background:
                    "radial-gradient(90% 60% at 50% 0%, rgba(255,90,31,0.10), transparent 70%)",
                }}
              />
              <span className="num relative text-[11px] text-torch">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="relative mt-5 text-[17px] font-semibold leading-[1.25] tracking-[-0.02em] text-steel-50">
                {item.title}
              </h3>
              <p className="relative mt-3 text-[14px] leading-[1.6] text-steel-400">
                {item.body}
              </p>
            </article>
          </Reveal>
        ))}
      </div>

      <Reveal delay={260}>
        <p className="mt-10 max-w-[70ch] text-[13px] leading-relaxed text-steel-600">
          VISE has been reviewed internally and every finding is published, fixed
          and regression-tested. It has not yet been through an external audit.
          Treat it accordingly until one is published here.
        </p>
      </Reveal>
    </section>
  );
}

function Cta() {
  return (
    <section className="relative overflow-hidden border-t border-steel-780">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 90% at 50% 120%, rgba(255,90,31,0.20), transparent 68%)",
        }}
      />
      <div className="relative mx-auto flex max-w-[1440px] flex-col items-center px-5 py-32 text-center sm:px-8 lg:py-48">
        <Reveal>
          <span className="inline-flex text-torch">
            <ViseMark size={46} grip={0.85} />
          </span>
          <h2 className="t-section mt-10 max-w-[14ch]">
            Stop asking people to hold. Pay them for it.
          </h2>
          <p className="t-lede mx-auto mt-7 text-center">
            Launch in under a minute. The pool, the fee routing and the lock vault
            are set up in the same transaction batch.
          </p>
          <div className="mt-11 flex flex-wrap justify-center gap-3">
            <Magnetic>
              <Link href="/launch" className="btn btn-primary h-[52px] px-8">
                Launch a coin
              </Link>
            </Magnetic>
            <Magnetic strength={0.2}>
              <Link href="/how-it-works" className="btn btn-ghost h-[52px] px-8">
                Read the docs
              </Link>
            </Magnetic>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
