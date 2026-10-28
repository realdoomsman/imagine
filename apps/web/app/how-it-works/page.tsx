import { DocLinks, DocPage, DocSection } from "@/components/doc-page";

export const metadata = {
  title: "How it works",
  description:
    "The mechanics of IMAGINE: StonkFun coins with a lock vault, where the fees come from, how weight is computed, and what the program will not let anyone do.",
};

export default function HowItWorksPage() {
  return (
    <DocPage
      eyebrow="Mechanics"
      title="How IMAGINE works"
      lede="A memecoin has one recurring revenue stream: the fees people pay to trade it. IMAGINE points that stream at the holders who lock, pays them more the longer they commit, and pays them in the asset the coin is paired with."
    >
      <DocSection title="A StonkFun coin with a vault">
        <p>
          Every IMAGINE coin launches on <a href="https://www.stonkfun.xyz" target="_blank" rel="noreferrer">StonkFun</a>{" "}
          through Raydium LaunchLab, paired with an asset: a tokenized stock like NVDAx or SPYx, a
          currency like USDC, or SOL. It is an ordinary StonkFun coin and trades like one.
        </p>
        <p>
          What IMAGINE adds is a pool per coin: a vault that collects the coin&apos;s fees and a
          set of locks that share them. The vault is the coin&apos;s creator address on StonkFun,
          and the creator has to open the first lock before anyone else can join.
        </p>
      </DocSection>

      <DocSection title="Where the money comes from">
        <p>Everything that reaches a vault is in the coin&apos;s pair asset.</p>
        <ol>
          <li>
            <strong>The app fee.</strong> imagine.fun adds a 1% fee to trades it routes, taken
            from the pair-asset side and paid into that coin&apos;s pool in the same transaction as
            the trade.
          </li>
          <li>
            <strong>StonkFun&apos;s creator share.</strong> StonkFun charges 1% on curve trades and
            forwards a creator share to each coin&apos;s creator address. For an IMAGINE coin that
            address is the vault, so the share lands where the lockers are. How much is forwarded
            is StonkFun&apos;s policy, not ours.
          </li>
          <li>
            <strong>Donations.</strong> Anyone can deposit into a vault.
          </li>
        </ol>
        <p>
          The Raydium LaunchLab protocol fee also applies to trades, as on every LaunchLab coin.
          It is not part of what reaches the vault.
        </p>
      </DocSection>

      <DocSection title="How your share is computed">
        <p>
          Your weight is your locked amount multiplied by a term multiplier and a size bonus.
          Both are frozen on the pool when it is created.
        </p>
        <pre className="num">
{`weight     = amount × term multiplier × (1 + size bonus)
term mult. = 1 + 3 × √((t − 4h) / (365d − 4h))
your share = weight / total weight in the pool`}
        </pre>
        <div className="grid gap-3 sm:grid-cols-2">
          <Table
            title="Term multiplier"
            rows={[
              ["4 hours", "1.00×"],
              ["1 day", "1.14×"],
              ["7 days", "1.41×"],
              ["30 days", "1.86×"],
              ["90 days", "2.49×"],
              ["180 days", "3.11×"],
              ["365 days", "4.00×"],
            ]}
          />
          <Table
            title="Size bonus"
            rows={[
              ["≥ 0.1% of supply", "+10%"],
              ["≥ 0.5% of supply", "+25%"],
              ["≥ 1.0% of supply", "+50%"],
            ]}
          />
        </div>
        <p>
          The curve is a square root, so short commitments are worth making and a year still takes
          the top. Size tiers are measured against total supply, never against the pool, so
          nothing anyone else does can move yours.
        </p>
        <p>
          Of everything that arrives, 10% goes to the treasury and 90% streams to lockers by
          weight. Arrivals are released over a short window rather than all at once, so a lock
          opened a moment before a big trade earns a moment&apos;s worth of it, not a slice of the
          whole. A new lock earns from fees that arrive after it and never dilutes what earlier
          lockers already earned.
        </p>
      </DocSection>

      <DocSection title="Every lock has a ceiling">
        <p>
          A lock can earn at most what its tokens were worth when it was opened, measured in the
          pair asset, times its multiplier. The program reads the price itself when you lock: from
          the coin&apos;s LaunchLab bonding curve, or from its Raydium pool once it has migrated.
        </p>
        <p>
          A lock that reaches its ceiling stops earning, and the locks still earning split what
          comes in. Its tokens still unlock on their date.
        </p>
      </DocSection>

      <DocSection title="Leaving early">
        <p>You can always break a lock. It costs two things, and both favour the people who stayed:</p>
        <ul>
          <li>Unclaimed rewards are forfeited and redistributed across the remaining weight.</li>
          <li>
            A slice of principal is burned, scaled by how much of your term is left. Breaking a lock
            near its end costs almost nothing.
          </li>
        </ul>
        <p>Claiming is never penalised and never touches your lock.</p>
      </DocSection>

      <DocSection title="What the program will not do">
        <ul>
          <li>There is no admin withdraw path. Rewards go to whoever earned them; locked coins go back to their owner.</li>
          <li>
            A pool&apos;s terms are frozen when it is created. Changing the defaults later affects
            only coins launched later.
          </li>
          <li>Claiming and unlocking can&apos;t be paused.</li>
          <li>The creator locks first, in public, before anyone else can.</li>
        </ul>
      </DocSection>

      <DocSection title="What can still go wrong">
        <p>
          The coin can go to zero, and locking makes that worse, because you can&apos;t sell into
          the decline without burning part of your bag. IMAGINE changes who receives trading fees;
          it does not make a bad coin good.
        </p>
        <p>
          A coin nobody trades pays nothing. There is no emission and no subsidy: the stream is
          other people trading.
        </p>
      </DocSection>

      <DocLinks
        links={[
          { href: "/launch", label: "Launch a coin" },
          { href: "/docs/fees", label: "Every fee" },
          { href: "/docs/security", label: "Security model" },
        ]}
      />
    </DocPage>
  );
}

function Table({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="well self-start px-4 py-3">
      <p className="eyebrow">{title}</p>
      <dl className="mt-2 divide-y divide-line">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-1.5 text-[14px]">
            <dt className="text-fg-soft">{label}</dt>
            <dd className="num font-semibold text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
