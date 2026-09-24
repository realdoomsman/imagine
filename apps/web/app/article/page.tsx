import Link from "next/link";
import { DocPage, DocSection } from "@/components/doc-page";

export const metadata = {
  title: "Selling is free. Holding is not.",
  description:
    "Why every memecoin pays the people who leave and charges the people who stay, and what VISE does about it.",
  openGraph: {
    title: "Selling is free. Holding is not.",
    description:
      "Why every memecoin pays the people who leave and charges the people who stay, and what VISE does about it.",
    type: "article",
  },
};

const PROGRAM_ID = "VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb";

/**
 * The launch essay. It is the argument for the product in full, written for
 * someone who has held a memecoin to zero and would like to know why that
 * keeps happening. Everything in it is a number or a mechanism the program
 * enforces; nothing is a promise.
 */
export default function ArticlePage() {
  return (
    <DocPage
      eyebrow="Essay"
      title="Selling is free. Holding is not."
      lede="Every platform in this market pays for the first and charges for the second. That is backwards, and it is fixable with about two thousand lines of Rust."
    >
      <DocSection title="The only revenue a memecoin has">
        <p>
          Strip away the chart and the group chat and a memecoin is a very
          simple business. It has one product, which is a token, and one
          recurring revenue stream, which is the fee people pay to trade it.
          On pump.fun that fee is roughly one percent of every buy and sell,
          for the life of the coin, and it is paid in SOL.
        </p>
        <p>
          Follow where it goes. A slice to the launchpad. A slice to the
          creator&apos;s wallet, which on most coins is the same person who is
          selling into you. None of it, ever, to the people whose holding is
          the reason there is a price at all.
        </p>
        <p>
          So the incentives run exactly one way. The moment you buy, the only
          action that pays you is the exit. Everybody knows this, which is why
          everybody sells, which is why the chart looks like that.
        </p>
      </DocSection>

      <DocSection title="What we did about it">
        <p>
          VISE is a lock pool bolted onto an ordinary pump.fun coin. The coin
          is created on pump.fun exactly like any other; it trades on the same
          curve, graduates the same way, shows up in the same places. What
          changes is where its fees land.
        </p>
        <p>Two streams flow into a vault that belongs to the coin, both in SOL:</p>
        <ul>
          <li>
            <strong>2% of the SOL on every trade routed through vise.fun.</strong>{" "}
            The fee instruction sits inside the swap transaction. If the trade
            fails, the fee is never taken. If the trade lands, the fee is
            already in the vault.
          </li>
          <li>
            <strong>The coin&apos;s pump.fun creator fees, in full.</strong> At
            launch, pump&apos;s own fee-sharing program is told to pay the
            creator&apos;s share to the vault instead of the creator. The
            instruction that does it revokes its own admin. Once it lands,
            nobody can redirect that stream — not the creator, not us.
          </li>
        </ul>
        <p>
          The vault splits what it receives one way, forever: <em>90% to the
          people who locked the coin, 10% to VISE</em>, nothing to the creator.
          A creator earns the way everyone else does, by locking, and their
          founding lock is public on the coin&apos;s page from block one.
        </p>
      </DocSection>

      <DocSection title="Locking, and why the curve bends">
        <p>
          To earn from the vault you lock your coins for a term you choose,
          between four hours and a year. Your share of every SOL that arrives
          is your <em>weight</em> divided by the pool&apos;s total weight, and
          weight is amount times a multiplier.
        </p>
        <p>
          The multiplier runs on a square root, not a straight line. Four
          hours counts once — and still earns. A week counts 1.41×, thirty
          days 1.86×, ninety days 2.49×, a year 4×. The bend is deliberate: a short lock should be
          worth making, and the last months of a long one should still be
          worth something more than the first.
        </p>
        <pre className="num">
{`4h    1.00×
1d    1.14×
7d    1.41×
30d   1.86×
90d   2.49×
180d  3.11×
365d  4.00×

lock ≥ 0.1% of supply   +10%
lock ≥ 0.5% of supply   +25%
lock ≥ 1.0% of supply   +50%`}
        </pre>
        <p>
          Size matters too. Lock a tenth of a percent of the supply and your
          weight gets ten percent more; lock a full percent and it gets half
          again. A year-long, one-percent position counts six times over what
          the same coins would earn on the shortest lock.
        </p>
        <p>
          Claiming never touches the lock and the lock never blocks a claim.
          You can harvest a year-long position every day and the position
          does not move.
        </p>
      </DocSection>

      <DocSection title="Leaving early">
        <p>
          You can always break a lock. It costs two things, and both go to the
          people who stayed: your unclaimed rewards are forfeited into the
          pool, and a slice of your principal is burned, scaled by how much of
          your term you did not serve. Leave on day one of a hundred and it
          hurts. Leave on day ninety-nine and it barely registers.
        </p>
        <p>
          That is the whole cost of the product. You cannot sell a locked bag
          for free. If you were never going to hold anyway, do not lock. If
          you were, this pays you for the holding you were already doing.
        </p>
      </DocSection>

      <DocSection title="What the program cannot do">
        <p>
          &ldquo;Trust us&rdquo; is not a security model, so the parts that
          matter are not promises. They are properties of the deployed
          bytecode, and anyone can check them against the source.
        </p>
        <ul>
          <li>
            <strong>There is no admin path to the money.</strong> No
            instruction in the program moves a pool&apos;s SOL or tokens to an
            admin. Not a disabled one, not a timelocked one. It does not exist.
          </li>
          <li>
            <strong>A pool&apos;s terms are frozen at creation.</strong> The
            fee split, the multiplier curve, the size tiers, the lock bounds,
            the exit penalty, the release window and the treasury address are
            copied onto the pool when it opens, and nothing rewrites them. We
            can change the defaults for coins launched later. We cannot reach
            into a pool that already exists.
          </li>
          <li>
            <strong>The pause switch blocks new pools. That is all.</strong>{" "}
            Claiming and unlocking are not pausable. There is no code path
            that would let them be.
          </li>
          <li>
            <strong>Rounding always favours the pool.</strong> A randomised
            test drives thousands of locks, deposits, claims and exits and
            asserts after every step that the vault can still pay everyone it
            owes.
          </li>
          <li>
            <strong>The fee routing revokes its own admin.</strong> pump.fun&apos;s
            fee-sharing config for the coin is set once, to the vault, and the
            update authority is discarded in the same call.
          </li>
        </ul>
        <p>
          Program: <code>{PROGRAM_ID}</code>. The source, the tests and the
          audit notes are in the repository; the{" "}
          <Link href="/docs/security">security page</Link> walks through each
          claim.
        </p>
      </DocSection>

      <DocSection title="No wallet? Sign in.">
        <p>
          Most people who would benefit from this do not have a Solana wallet
          and do not want to learn what a seed phrase is on the day they buy a
          coin. So VISE takes a Google sign-in. You get an ordinary Solana
          address, held for you, that you can send SOL or coins to, lock from,
          and withdraw from whenever. The key is yours: reveal it from the
          wallet page and import it anywhere. There is no step where we get to
          say no.
        </p>
      </DocSection>

      <DocSection title="The honest version">
        <p>
          None of this makes a bad coin good. A coin with no volume pays
          nothing, and a locked bag in a coin going to zero is worse than an
          unlocked one because you cannot sell into the decline for free.
          Every number on the site is trailing, realised fees divided by
          locked value; nothing is projected, nothing is annualised from one
          good hour. If a coin stops trading its number goes to zero, and it
          should.
        </p>
        <p>
          What VISE changes is narrow and, we think, important: for the first
          time, on this launchpad, the person who stays is the person who gets
          paid. The rest is up to the coin.
        </p>
        <p>
          <Link href="/coins">See the coins</Link> ·{" "}
          <Link href="/launch">Launch one</Link> ·{" "}
          <Link href="/how-it-works">The full mechanics</Link>
        </p>
      </DocSection>
    </DocPage>
  );
}
