import Link from "next/link";
import { DocPage, DocSection } from "@/components/doc-page";

export const metadata = {
  title: "Fees",
  description:
    "Every fee VISE charges, who pays it, where it goes, and what it costs to leave early.",
};

export default function FeesPage() {
  return (
    <DocPage
      eyebrow="Fees"
      title="Every fee, and where it lands"
      lede="Four numbers matter. All of them are on this page, and none of them can be changed on a pool once it exists."
    >
      <DocSection title="The app fee: 2% of the SOL leg">
        <p>
          Trades routed through vise.fun pay 2% of the SOL side — what you spend
          on a buy, what you receive on a sell. The instruction that takes it
          rides in the same transaction as the swap, so a failed trade costs you
          nothing and lockers are credited the moment the trade confirms.
        </p>
        <p>
          It is charged by the transaction our API builds, not by the on-chain
          program. Trading the same coin directly on pump.fun pays no app fee and
          the coin&apos;s lockers earn nothing from it. That is honest rather
          than ideal: no front-end can tax a trade it did not build.
        </p>
        <p>
          The rate is a platform setting, adjustable between 0% and a hard
          on-chain ceiling of 10%. Any change applies to future trades; it cannot
          reach into a pool and alter what it already owes.
        </p>
      </DocSection>

      <DocSection title="pump.fun creator fees: all of them">
        <p>
          pump.fun pays every coin&apos;s creator a share of its trading volume.
          At launch, VISE points that entire stream at the coin&apos;s lock pool
          using pump&apos;s own fee-sharing program.
        </p>
        <p>
          The instruction that sets it — <code>update_fee_shares_v2</code> —
          revokes its own admin as it runs. After it lands, the routing is
          permanent. The creator cannot redirect it. Neither can we. Anyone can
          then run the permissionless sweep that pushes accrued fees into the
          vault, and VISE runs it on a schedule so nobody has to think about it.
        </p>
      </DocSection>

      <DocSection title="The split: 90 / 10 / 0">
        <p>Every lamport entering a pool is divided the same way, in this order:</p>
        <ul>
          <li>
            <strong>10% to the treasury.</strong> Taken off the top. This pays
            for indexing, hosting, audits, and the keeper that moves pump.fun
            creator fees into pools every minute.
          </li>
          <li>
            <strong>0% to the creator.</strong> The program supports a creator
            share; the platform sets its ceiling to zero. A creator who wants to
            earn from their coin does what everyone else does: locks it.
          </li>
          <li>
            <strong>90% to lockers</strong>, split by weight.
          </li>
        </ul>
        <p>
          These percentages are written onto the pool when it is created and
          there is no instruction anywhere that rewrites them. Changing the
          platform defaults affects coins launched later and nothing else.
        </p>
      </DocSection>

      <DocSection title="Fees do not land all at once">
        <p>
          Arriving fees stream out to lockers linearly over a release window —
          24 hours by default, frozen per pool like everything else.
        </p>
        <p>
          This is deliberate. If a fee were handed out the instant it arrived,
          your share would be decided by who held weight at one moment, and
          anyone could watch lamports pile up in a vault, lock a large bag, claim
          a slice of a backlog they were never present for, and leave. Streaming
          makes a reward share a function of weight held <em>over time</em>,
          which is the thing the product actually claims to pay for.
        </p>
      </DocSection>

      <DocSection title="Leaving early">
        <p>Breaking a lock before its term costs two things, both to the benefit of the people who stayed:</p>
        <ul>
          <li>
            Unclaimed rewards are forfeited and immediately redistributed across
            the remaining weight.
          </li>
          <li>
            A slice of principal is burned, scaled linearly by how much of your
            term is left unserved. The headline rate is 25%; breaking a 100-day
            lock on day 50 burns half of that, and on day 99 it rounds to
            nothing.
          </li>
        </ul>
        <p>
          Claiming is never penalised and never touches your lock. You can
          harvest every day of a one-year position and the position does not
          move.
        </p>
      </DocSection>

      <DocSection title="What it costs to launch">
        <p>
          A pool creation fee of 0.05 SOL, plus ordinary Solana rent for the
          accounts your coin needs — roughly 0.02 SOL, most of which comes back
          when positions close. Your dev buy is yours; the part you choose to
          lock is locked on the same terms as everyone else&apos;s.
        </p>
      </DocSection>

      <div className="hairline mt-12 flex flex-wrap gap-3 pt-8">
        <Link href="/launch" className="btn btn-primary">
          Launch a coin
        </Link>
        <Link href="/docs/security" className="btn btn-ghost">
          Read the security model
        </Link>
      </div>
    </DocPage>
  );
}
