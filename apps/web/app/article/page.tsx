import Link from "next/link";
import { IMAGINE_PROGRAM_ID } from "@imagine/sdk";
import { DocPage, DocSection } from "@/components/doc-page";
import { pageMetadata } from "@/lib/seo";
import { RAYDIUM_LAUNCHPAD_URL } from "@/components/site-header-links";

const TITLE = "Imagine everyone locks.";
const DESCRIPTION =
  "Why every memecoin pays the people who leave, and what happens when a coin launched on Raydium pays the people who stay — in whatever it's paired with.";

export const metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/article", type: "article" });

/**
 * The launch essay: the argument for the product in full. Every number in it
 * is a mechanism the program enforces or a fee you can see on-chain.
 */
export default function ArticlePage() {
  return (
    <DocPage
      eyebrow="The idea"
      title={TITLE}
      lede="Imagine the chart if nobody sold. Every platform in this market pays for the exit and charges for staying. IMAGINE turns that around, and pays the holders who stay in whatever their coin is paired with: a stock, SOL, USDC or anything else Raydium LaunchLab supports."
    >
      <DocSection title="The only revenue a memecoin has">
        <p>
          Strip away the chart and the group chat and a memecoin is a simple business. It has one
          product, a token, and one recurring revenue stream: the fees people pay to trade it.
        </p>
        <p>
          Follow where that money usually goes. A slice to the launchpad, a slice to whoever
          launched the coin. None of it to the people whose holding is the reason there is a price
          at all. So the moment you buy, the only action that pays you is the exit. Everybody knows
          it, everybody sells, and the chart looks like that.
        </p>
      </DocSection>

      <DocSection title="Paired with anything">
        <p>
          <a href={RAYDIUM_LAUNCHPAD_URL} target="_blank" rel="noreferrer">
            Raydium LaunchLab
          </a>{" "}
          launches coins paired with something: a tokenized stock like NVDAx, SPYx or TSLAx, a
          currency like USDC, or SOL. The pair is what the coin is priced in, and what every trade
          pays in.
        </p>
        <p>
          That gives a holder something new to be paid in. If the fees from trading a coin are in
          NVDAx, the people who hold it can be paid NVDAx; if they are in SOL, SOL. That is the whole tagline:{" "}
          <strong>lock the meme, earn its pair.</strong>
        </p>
      </DocSection>

      <DocSection title="What IMAGINE adds">
        <p>
          An IMAGINE coin is an ordinary Raydium LaunchLab coin, launched under the IMAGINE
          platform, with one difference: it has a pool, and the coin&apos;s fees are paid into it.
          The creator opens the first lock, in public, before anyone else can join.
        </p>
        <p>What flows into the pool, all in the pair asset:</p>
        <ul>
          <li>
            <strong>A 0.5% on-chain trading fee on every trade, anywhere.</strong> Raydium
            LaunchLab charges it and sends it to the coin&apos;s pool, whether the trade comes from
            Raydium, Jupiter or a bot.
          </li>
          <li>
            <strong>A 1.5% app fee on trades through imagine.fun</strong>, paid into the pool inside
            the same transaction as the trade. On imagine.fun, 2% of every trade reaches the pool.
          </li>
          <li>
            <strong>After graduation</strong>, the Raydium pool&apos;s fee share, and{" "}
            <strong>donations</strong> from anyone.
          </li>
        </ul>
        <p>
          The pool splits what arrives one way for its whole life: <strong>90% to the people who
          locked, 10% to the treasury</strong>. The creator earns nothing from fees — they earn
          only by locking, like everyone else.
        </p>
      </DocSection>

      <DocSection title="Locking, and why the curve bends">
        <p>
          To earn you lock for a term you choose, between four hours and a year. Your share of what
          arrives is your weight over the pool&apos;s total weight, and weight is amount times a
          multiplier that rises on a square root: four hours counts once, a week 1.41×, thirty days
          1.86×, ninety days 2.49×, a year 4×. A serious share of supply adds up to half again.
        </p>
        <p>
          The bend is deliberate. A short lock should be worth making; the last months of a long
          one should still be worth more than the first. Claiming never touches the lock, and the
          lock never blocks a claim.
        </p>
      </DocSection>

      <DocSection title="Leaving early">
        <p>
          You can always break a lock. Your unclaimed rewards go to the people who stayed, and a
          slice of your principal is burned, scaled by how much of the term you didn&apos;t serve.
          Selling is free. It just costs you the stream.
        </p>
      </DocSection>

      <DocSection title="What the program cannot do">
        <ul>
          <li>
            <strong>There is no admin withdraw path.</strong> Rewards go to whoever earned them and
            locked coins go back to their owner.
          </li>
          <li>
            <strong>A pool&apos;s terms are frozen when it is created.</strong> Defaults can change
            for coins launched later; a pool that exists keeps its terms.
          </li>
          <li>
            <strong>Claims and unlocks can&apos;t be paused.</strong>
          </li>
        </ul>
        <p>
          Program: <code className="break-all">{IMAGINE_PROGRAM_ID.toBase58()}</code>. The{" "}
          <Link href="/docs/security">security page</Link> walks through each claim.
        </p>
      </DocSection>

      <DocSection title="The honest version">
        <p>
          None of this makes a bad coin good. A coin nobody trades pays nothing, and a locked bag in
          a coin going to zero is worse than an unlocked one. The pair asset moves on its own, too.
        </p>
        <p>
          What IMAGINE changes is narrow: the person who stays is the person who gets paid, in
          something worth holding. Now imagine everyone locks.
        </p>
        <p>
          <Link href="/coins">See the coins</Link> · <Link href="/launch">Launch one</Link> ·{" "}
          <Link href="/how-it-works">The full mechanics</Link>
        </p>
      </DocSection>
    </DocPage>
  );
}
