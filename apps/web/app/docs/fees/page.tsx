import { DocLinks, DocPage, DocSection } from "@/components/doc-page";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/docs/fees",
  title: "Fees",
  description:
    "Every fee on an IMAGINE coin: who charges it, where it lands, and what it costs to leave a lock early.",
});

export default function FeesPage() {
  return (
    <DocPage
      eyebrow="Docs · Fees"
      title="Every fee, and where it lands"
      lede="On imagine.fun, 2% of every trade goes to the coin's pool. Elsewhere, 0.5% still does, enforced on-chain by Raydium LaunchLab. Here is each fee, who charges it, and the split that applies once money reaches a pool."
    >
      <DocSection title="The 0.5% on-chain trading fee: every trade, anywhere">
        <p>
          IMAGINE coins launch on Raydium LaunchLab under the IMAGINE platform, which sets a 0.5%
          trading fee on every trade on the coin&apos;s bonding curve and names the coin&apos;s pool
          as the one it is paid to. It applies wherever the trade comes from — Raydium, Jupiter, a
          trading bot, imagine.fun — and it is enforced on-chain by Raydium LaunchLab, not by our
          front-end.
        </p>
        <p>
          The fee accrues on LaunchLab and anyone can collect it into the coin&apos;s pool; our
          keeper does so on a schedule. When the coin graduates from its curve to a Raydium pool,
          that pool&apos;s fee share keeps flowing to the coin&apos;s pool the same way.
        </p>
      </DocSection>

      <DocSection title="The 1.5% app fee: trades on imagine.fun">
        <p>
          Trades through imagine.fun add 1.5% of the pair-asset side: what you spend on a buy, what
          you receive on a sell. The deposit that carries it rides in the same transaction as the
          trade and pays straight into the coin&apos;s pool, so a failed trade costs nothing and
          lockers are credited the moment the trade confirms. Together with the 0.5% trading fee,
          2% of every imagine.fun trade reaches the pool.
        </p>
        <p>
          The app fee is applied by the transaction our API builds. Trades elsewhere don&apos;t pay
          it; they still pay the 0.5%.
        </p>
      </DocSection>

      <DocSection title="Raydium's protocol fee">
        <p>
          Raydium charges its own 0.25% LaunchLab protocol fee on curve trades, as it does for every
          LaunchLab coin. That fee is Raydium&apos;s and is not part of what reaches the pool.
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
            <strong>0% to the creator.</strong> The creator earns nothing from fees — they earn
            only by locking, like everyone else.
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
