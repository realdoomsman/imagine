import Link from "next/link";
import { DocPage, DocSection } from "@/components/doc-page";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Terms",
  description: "The terms on which imagine.fun is offered.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <DocPage
      eyebrow="Terms"
      title="Plain terms"
      lede="imagine.fun is an interface to a public, permissionless Solana program and to Raydium. Using it means you accept the following."
    >
      <DocSection title="What IMAGINE is">
        <p>
          IMAGINE is a website and a Solana program. The program launches coins on Raydium
          LaunchLab under the IMAGINE platform and lets holders lock them for a chosen period and
          share the fees paid into each coin&apos;s pool, in the asset the coin is paired with. The
          website builds transactions for that program, for Raydium LaunchLab and for Raydium pools;
          the chain executes them. The program has no admin withdraw path for pooled funds.
        </p>
        <p>
          Raydium is an independent service with its own terms and fees. IMAGINE does not operate
          it.
        </p>
      </DocSection>

      <DocSection title="Risk">
        <p>
          Memecoins can go to zero. A lock is a lock: your coins are unavailable until the date you
          chose, and leaving early burns part of them and forfeits unclaimed rewards. Rewards are
          whatever fees actually arrive, paid in the coin&apos;s pair asset, whose price moves on its
          own. Nothing is promised, projected or guaranteed. Smart contracts can have bugs. Nothing
          on this site is financial advice.
        </p>
      </DocSection>

      <DocSection title="Accounts">
        <p>
          If you sign in with Google, IMAGINE holds an encrypted key for a wallet that is yours. You
          can withdraw or export it at any time. You are responsible for the security of your Google
          account and for anything done through it. Keep an exported key private; anyone who has it
          has the wallet.
        </p>
      </DocSection>

      <DocSection title="Fees">
        <p>
          Every trade on an IMAGINE coin&apos;s bonding curve, wherever it is made, pays a 0.5%
          on-chain trading fee into the coin&apos;s pool, charged by Raydium LaunchLab. Trades routed
          through the site add a 1.5% app fee on the pair-asset side, also paid into the pool.
          Raydium&apos;s 0.25% LaunchLab protocol fee applies. Pools split what they receive 90% to
          lockers and 10% to the treasury; the creator earns nothing from fees. Launching a coin
          costs a pool creation fee shown before you sign. All of it is visible in the transaction
          before it is signed. See{" "}
          <Link href="/docs/fees">how fees work</Link>.
        </p>
      </DocSection>

      <DocSection title="Availability">
        <p>
          The site may be unavailable, rate-limited or changed at any time. The program keeps
          working without it: positions, claims and unlocks are yours through any client that
          speaks to the chain.
        </p>
      </DocSection>

      <DocSection title="Eligibility">
        <p>
          Do not use IMAGINE where doing so is unlawful. You must be of legal age in your
          jurisdiction. IMAGINE is provided as-is, without warranty, and its operators are not
          liable for losses arising from its use.
        </p>
      </DocSection>
    </DocPage>
  );
}
