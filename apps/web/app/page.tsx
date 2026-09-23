import Link from "next/link";
import { Hero } from "@/components/hero";
import { ViseMark } from "@/components/vise-mark";

export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Mechanics />
      <Guarantees />
      <Cta />
    </>
  );
}

const STEPS = [
  {
    n: "01",
    title: "A coin launches on pump.fun",
    body: "Through VISE, so the coin's creator-fee stream is pointed at its lock pool from the first block. Nothing custom, nothing new to trust: it is an ordinary pump.fun coin on an ordinary bonding curve.",
  },
  {
    n: "02",
    title: "Holders clamp their bags",
    body: "Pick an amount and a term from 7 to 365 days. Your weight is the amount multiplied by your term — 1.0× at a week, 4.0× at a year. The tokens sit in a vault you alone can open.",
  },
  {
    n: "03",
    title: "Every trade feeds the vault",
    body: "A 2% app fee on trades routed through VISE, plus the coin's pump.fun creator fees, land in that coin's vault as SOL. No emissions, no printed tokens, no new supply.",
  },
  {
    n: "04",
    title: "Claim whenever you like",
    body: "Rewards accrue continuously by weight. Claiming does not touch your lock and your lock never blocks a claim. When the term ends, take your coins back.",
  },
];

function HowItWorks() {
  return (
    <section className="mx-auto max-w-[1400px] px-5 py-24">
      <header className="max-w-2xl">
        <p className="rule-label">How it works</p>
        <h2 className="mt-4 text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
          Conviction, priced.
        </h2>
        <p className="mt-4 text-[16px] text-steel-400">
          Selling is free everywhere else. Here, not selling pays — and the
          longer you commit, the larger your cut of the same stream.
        </p>
      </header>

      <ol className="mt-14 grid gap-px border border-steel-700 bg-steel-700 md:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((step) => (
          <li key={step.n} className="bg-steel-900 p-7">
            <span className="num text-[12px] text-torch">{step.n}</span>
            <h3 className="mt-4 text-[17px] leading-snug">{step.title}</h3>
            <p className="mt-2.5 text-[14px] leading-relaxed text-steel-500">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const SPLIT = [
  { label: "Lockers", value: 72, tone: "bg-torch" },
  { label: "Treasury", value: 20, tone: "bg-steel-500" },
  { label: "Creator", value: 8, tone: "bg-steel-600" },
];

function Mechanics() {
  return (
    <section className="border-y border-steel-700 bg-steel-900/40">
      <div className="mx-auto grid max-w-[1400px] gap-14 px-5 py-24 lg:grid-cols-2">
        <div>
          <p className="rule-label">The split</p>
          <h2 className="mt-4 text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1]">
            Where a fee actually goes
          </h2>
          <p className="mt-4 max-w-lg text-[15px] text-steel-400">
            Take a 2% fee on a 10 SOL buy: 0.2 SOL enters the coin's vault. The
            platform's cut comes off the top, the creator's cut comes out of
            what is left, and every remaining lamport is split across locked
            weight.
          </p>

          <div className="mt-8 flex h-10 overflow-hidden border border-steel-700">
            {SPLIT.map((part) => (
              <div
                key={part.label}
                className={`${part.tone} flex items-center justify-center`}
                style={{ width: `${part.value}%` }}
                title={`${part.label} ${part.value}%`}
              >
                <span className="num text-[11px] text-steel-950">
                  {part.value}%
                </span>
              </div>
            ))}
          </div>
          <dl className="mt-3 flex gap-6">
            {SPLIT.map((part) => (
              <div key={part.label} className="flex items-center gap-2">
                <span className={`size-2 ${part.tone}`} />
                <dt className="text-[13px] text-steel-400">{part.label}</dt>
              </div>
            ))}
          </dl>

          <p className="mt-6 text-[13px] leading-relaxed text-steel-600">
            A pool's split is stamped in when the coin launches and can never be
            edited — not by the creator, not by us. The creator picks their own
            share up front, capped at 30%, and lives with it.
          </p>
        </div>

        <div>
          <p className="rule-label">The curve</p>
          <h2 className="mt-4 text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1]">
            Weight is amount × time
          </h2>
          <p className="mt-4 max-w-lg text-[15px] text-steel-400">
            Two wallets lock the same 10,000 coins. One commits a week, one
            commits a year. They do not earn the same.
          </p>

          <div className="panel mt-8 divide-y divide-steel-800">
            {[
              { days: 7, mult: "1.00×", share: 20 },
              { days: 30, mult: "1.19×", share: 24 },
              { days: 90, mult: "1.70×", share: 34 },
              { days: 180, mult: "2.45×", share: 49 },
              { days: 365, mult: "4.00×", share: 100 },
            ].map((row) => (
              <div key={row.days} className="flex items-center gap-4 px-5 py-3">
                <span className="num w-14 text-[13px] text-steel-400">
                  {row.days}d
                </span>
                <span className="num w-16 text-[15px] text-steel-50">
                  {row.mult}
                </span>
                <div className="h-2.5 flex-1 border border-steel-700 bg-steel-950">
                  <div
                    className="knurl h-full bg-torch"
                    style={{ width: `${row.share}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const GUARANTEES = [
  {
    title: "No admin withdrawal path",
    body: "There is no instruction in the program that moves a pool's SOL or tokens to an admin. Not a disabled one, not a timelocked one. It does not exist.",
  },
  {
    title: "Terms are frozen at launch",
    body: "Multiplier curve, fee split, penalty, lock bounds — copied onto the pool at creation. Changing platform defaults later only affects coins launched later.",
  },
  {
    title: "Claims can never be paused",
    body: "The pause switch blocks new pools. It cannot touch claiming, unlocking, or an existing pool's accounting.",
  },
  {
    title: "The creator locks first",
    body: "A pool cannot exist without the creator's own locked position, created in the same instruction. They are exposed before anyone else is.",
  },
  {
    title: "Hostile mints are rejected",
    body: "Any mint with a freeze authority, transfer fee, transfer hook, or permanent delegate is refused at pool creation — those let a third party strand your principal.",
  },
  {
    title: "Solvency is an invariant",
    body: "Rounding is always in the pool's favour, proven by a randomised test that hammers a pool with locks, claims, deposits and exits and asserts it can always pay everyone.",
  },
];

function Guarantees() {
  return (
    <section className="mx-auto max-w-[1400px] px-5 py-24">
      <header className="max-w-2xl">
        <p className="rule-label">What we cannot do to you</p>
        <h2 className="mt-4 text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
          The parts that matter are not promises.
        </h2>
        <p className="mt-4 text-[16px] text-steel-400">
          They are properties of the program. Read it, or read the tests that
          hold it to them.
        </p>
      </header>

      <div className="mt-14 grid gap-px border border-steel-700 bg-steel-700 md:grid-cols-2 lg:grid-cols-3">
        {GUARANTEES.map((item) => (
          <article key={item.title} className="bg-steel-900 p-7">
            <h3 className="text-[16px] leading-snug">{item.title}</h3>
            <p className="mt-2.5 text-[14px] leading-relaxed text-steel-500">
              {item.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="mx-auto max-w-[1400px] px-5 pb-8">
      <div className="panel knurl flex flex-col items-start gap-6 p-10 md:flex-row md:items-center md:justify-between md:p-14">
        <div>
          <span className="text-torch">
            <ViseMark size={30} grip={0.85} />
          </span>
          <h2 className="mt-5 max-w-lg text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.05]">
            Stop rewarding the people who leave.
          </h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/launch" className="btn btn-primary">
            Launch a coin
          </Link>
          <Link href="/how-it-works" className="btn btn-ghost">
            Read the mechanics
          </Link>
        </div>
      </div>
    </section>
  );
}
