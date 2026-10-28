import { DocLinks, DocPage, DocSection } from "@/components/doc-page";

export const metadata = {
  title: "Fees",
  description:
    "Every fee on an IMAGINE coin: who charges it, where it lands, and what it costs to leave a lock early.",
};

export default function FeesPage() {
  return (
    <DocPage
      eyebrow="Docs · Fees"
      title="Every fee, and where it lands"
      lede="Some fees are StonkFun's and Raydium's, some are ours, and one stream is forwarded to the vault. Here is each of them, and the split that applies once money reaches a pool."
    >
      <DocSection title="The app fee: 1% on trades imagine.fun routes">
        <p>
          Trades routed through imagine.fun pay 1% of the pair-asset side: what you spend on a buy,
          what you receive on a sell. The deposit that carries it rides in the same transaction as
          the trade and pays straight into that coin&apos;s pool, so a failed trade costs nothing
          and lockers are credited the moment the trade confirms.
        </p>
        <p>
          It is applied by the transaction our API builds, not enforced by the on-chain program.
          Trading the same coin elsewhere does not pay it. No front-end can charge for a trade it
          did not build.
        </p>
      </DocSection>

      <DocSection title="StonkFun and Raydium LaunchLab fees">
        <p>
          IMAGINE coins are StonkFun coins, so StonkFun&apos;s own fees apply to them as to any
          other: StonkFun charges 1% on curve trades, and the Raydium LaunchLab protocol fee
          applies. Those fees are theirs.
        </p>
        <p>
          StonkFun forwards a creator share to each coin&apos;s creator address. For an IMAGINE coin
          that address is the pool&apos;s vault, so whatever StonkFun forwards lands where the
          lockers are and is credited to the pool. Forwarding is StonkFun&apos;s policy; we
          don&apos;t promise an amount.
        </p>
      </DocSection>

      <DocSection title="The split: 90 / 10 / 0">
        <p>Everything that reaches a pool, whatever the source, is divided the same way:</p>
        <ul>
          <li>
            <strong>90% to lockers</strong>, streamed by weight.
          </li>
          <li>
            <strong>10% to the treasury</strong>, taken off the top.
          </li>
          <li>
            <strong>0% to the creator</strong> by default. A creator earns the way everyone else
            does: by locking.
          </li>
        </ul>
        <p>
          The split is frozen on the pool when it is created. Changing the platform defaults
          affects coins launched later and nothing else. All of it is paid in the coin&apos;s pair
          asset: NVDAx for an NVDAx-paired coin, SOL for a SOL-paired one.
        </p>
      </DocSection>

      <DocSection title="Fees stream, they don't land all at once">
        <p>
          Arrivals are released to lockers over a window, one hour by default and frozen per pool
          like everything else. If a fee were handed out the instant it arrived, anyone could
          watch a vault fill, lock a large bag a moment before, take a slice they were never
          present for, and leave. Streaming makes a share a function of weight held over time.
        </p>
      </DocSection>

      <DocSection title="Every lock has a ceiling">
        <p>
          A lock can earn at most what its tokens were worth when it was opened, measured in the
          pair asset, times its multiplier. The price is read by the program from the coin&apos;s
          LaunchLab curve, or from its Raydium pool once it has migrated. A lock that reaches its
          ceiling stops earning and the locks still earning split what arrives.
        </p>
      </DocSection>

      <DocSection title="Leaving early">
        <p>Breaking a lock before its term costs two things:</p>
        <ul>
          <li>Unclaimed rewards are forfeited and redistributed across the remaining weight.</li>
          <li>
            A slice of principal is burned, scaled linearly by how much of the term is left. The
            headline rate is 25%; leaving a 100-day lock on day 50 burns half of that, and on day
            99 almost nothing.
          </li>
        </ul>
        <p>Claiming is never penalised and never touches your lock.</p>
      </DocSection>

      <DocSection title="What it costs to launch">
        <p>
          A pool creation fee of 0.05 SOL to the treasury, plus Solana rent for the new accounts,
          shown in your wallet before you sign. Your dev buy is yours; the part you lock is locked
          on the same terms as everyone else&apos;s.
        </p>
      </DocSection>

      <DocLinks
        links={[
          { href: "/launch", label: "Launch a coin" },
          { href: "/docs/security", label: "Security model" },
        ]}
      />
    </DocPage>
  );
}
