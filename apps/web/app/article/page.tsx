import Link from "next/link";
import { IMAGINE_PROGRAM_ID } from "@imagine/sdk";
import { DocPage, DocSection } from "@/components/doc-page";

const TITLE = "Imagine everyone locks.";
const DESCRIPTION =
  "Why every memecoin pays the people who leave, and what happens when a StonkFun coin pays the people who stay — in the stock it's paired with.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
};

/**
 * The launch essay: the argument for the product in full. Every number in it
 * is a mechanism the program enforces or a fee you can see on-chain.
 */
export default function ArticlePage() {
  return (
    <DocPage
      eyebrow="The idea"
      title={TITLE}
      lede="Imagine the chart if nobody sold. Every platform in this market pays for the exit and charges for staying. IMAGINE turns that around, and pays the holders who stay in the stock their coin is paired with."
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

      <DocSection title="Paired with a stock">
        <p>
          <a href="https://www.stonkfun.xyz" target="_blank" rel="noreferrer">StonkFun</a> launches
          coins paired with something: a tokenized stock like NVDAx, SPYx or TSLAx, a currency like
          USDC, or SOL. The pair is what the coin is priced in, and what every trade pays in.
        </p>
        <p>
          That gives a holder something new to be paid in. If the fees from trading a coin are in
          NVDAx, the people who hold it can be paid NVDAx. That is the whole tagline:{" "}
          <strong>lock the meme, earn the stock.</strong>
        </p>
      </DocSection>

      <DocSection title="What IMAGINE adds">
        <p>
          An IMAGINE coin is an ordinary StonkFun coin, launched through Raydium LaunchLab, with one
          difference: it has a vault, and its creator address on StonkFun is that vault. The creator
          opens the first lock, in public, before anyone else can join.
        </p>
        <p>Three things flow into the vault, all in the pair asset:</p>
        <ul>
          <li>
            <strong>A 1% app fee on trades routed through imagine.fun</strong>, paid into that
            coin&apos;s pool inside the same transaction as the trade.
          </li>
          <li>
            <strong>StonkFun&apos;s creator share.</strong> StonkFun charges 1% on curve trades and
            forwards a creator share to the coin&apos;s creator address, which for an IMAGINE coin is
            the vault. How much it forwards is StonkFun&apos;s call.
          </li>
          <li>
            <strong>Donations</strong> from anyone.
          </li>
        </ul>
        <p>
          The vault splits what arrives one way for the life of the pool: <strong>90% to the
          people who locked, 10% to the treasury</strong>, nothing to the creator by default. A
          creator earns the way everyone else does, by locking.
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
