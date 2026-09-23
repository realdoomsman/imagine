import Link from "next/link";

export const metadata = {
  title: "How it works",
  description:
    "The mechanics of VISE: where fees come from, how weight is computed, and what the program will not let anyone do.",
};

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-[820px] px-5 py-12">
      <p className="rule-label">Mechanics</p>
      <h1 className="mt-3 text-[clamp(2.25rem,5vw,3.25rem)] leading-[1.02]">
        How VISE works
      </h1>
      <p className="mt-5 text-[17px] leading-relaxed text-steel-300">
        A memecoin has exactly one recurring revenue stream: the fees people pay
        to trade it. Normally that money goes to a launchpad and a dev wallet.
        VISE points it at the people who are still holding — and pays them more
        the longer they commit.
      </p>

      <Section title="Where the money comes from">
        <p>Two streams, both denominated in SOL, both flowing into one vault per coin.</p>
        <ol>
          <li>
            <strong>The app fee.</strong> Trades routed through the VISE
            front-end pay 2% of the SOL leg. That instruction sits in the same
            transaction as the swap, so it cannot be charged for a trade that did
            not happen, and it cannot be skipped by our own UI.
          </li>
          <li>
            <strong>pump.fun creator fees.</strong> Every pump coin pays its
            creator a share of trading volume. At launch, VISE hands that stream
            to the coin&apos;s lock pool using pump&apos;s own fee-sharing
            program — and the instruction that does it revokes its own admin, so
            the routing is permanent.
          </li>
        </ol>
        <p>
          Anyone can also donate to a vault. The pool detects new lamports by
          balance difference, so it does not care who sent them or why.
        </p>
      </Section>

      <Section title="How your share is computed">
        <p>
          Your weight is your locked amount multiplied by a term multiplier that
          runs linearly from 1.0× at seven days to 4.0× at a year:
        </p>
        <pre className="num">
{`weight      = amount × multiplier
multiplier  = 1.0 + 3.0 × (days − 7) / 358
your share  = weight / total weight in the pool`}
        </pre>
        <p>
          Rewards accrue continuously against a per-pool accumulator, the same
          pattern used by every serious staking contract since MasterChef. There
          is no epoch, no snapshot, and no claim window: a lamport that arrives
          in the vault is claimable by whoever had weight at that moment.
        </p>
        <p>
          Locking later does not dilute what earlier lockers already earned. A
          new position starts with its credit line set to the current
          accumulator, so it earns from fees that arrive after it, and nothing
          before.
        </p>
      </Section>

      <Section title="Leaving early">
        <p>
          You can always break a lock. It costs two things, and both go to the
          people who stayed:
        </p>
        <ul>
          <li>
            Unclaimed rewards are forfeited and immediately redistributed across
            the remaining weight.
          </li>
          <li>
            A slice of principal is burned, scaled linearly by how much of your
            term is left. Breaking a 100-day lock on day 50 burns half of the
            headline penalty; breaking it on day 99 burns almost nothing.
          </li>
        </ul>
        <p>
          Claiming is never penalised. You can harvest every day of a one-year
          lock and it does not touch your position.
        </p>
      </Section>

      <Section title="What the program will not do">
        <ul>
          <li>
            There is no instruction that moves a pool&apos;s SOL or tokens to an
            admin. Not disabled, not timelocked — absent.
          </li>
          <li>
            A pool&apos;s terms — multiplier curve, fee split, penalty, lock
            bounds, treasury address — are copied onto it at creation and are
            immutable. Changing platform defaults later affects only coins
            launched later.
          </li>
          <li>
            The pause switch blocks new pools. It cannot block claiming or
            unlocking.
          </li>
          <li>
            Mints that can freeze accounts, tax transfers, run transfer hooks, or
            name a permanent delegate are rejected outright. Each of those lets a
            third party strand locked principal.
          </li>
          <li>
            Rounding always favours the pool. A randomised test drives thousands
            of locks, deposits, claims and exits and asserts after every single
            step that the vault can still pay everyone it owes.
          </li>
        </ul>
      </Section>

      <Section title="What can still go wrong">
        <p>
          The coin can go to zero. That is the whole risk, and locking makes it
          worse, because you cannot sell into the decline without burning part of
          your bag. VISE changes who receives trading fees; it does not make a
          bad coin good.
        </p>
        <p>
          A coin with no volume pays nothing. Yield here is a function of other
          people trading — there is no emission, no inflation, and no treasury
          subsidising returns.
        </p>
      </Section>

      <div className="hairline mt-12 flex flex-wrap gap-3 pt-8">
        <Link href="/launch" className="btn btn-primary">
          Launch a coin
        </Link>
        <Link href="/coins" className="btn btn-ghost">
          Browse coins
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-[24px]">{title}</h2>
      <div className="prose-vise mt-4 space-y-4 text-[15px] leading-relaxed text-steel-400 [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-steel-700 [&_pre]:bg-steel-950 [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:text-steel-300 [&_strong]:text-steel-100 [&_ul]:space-y-2 [&_ol]:space-y-2">
        {children}
      </div>
    </section>
  );
}
