import Link from "next/link";
import { DocPage, DocSection } from "@/components/doc-page";

export const metadata = {
  title: "Terms",
  description: "The terms on which VISE is offered.",
};

export default function TermsPage() {
  return (
    <DocPage
      eyebrow="Terms"
      title="Plain terms"
      lede="VISE is an interface to a public, permissionless program. Using it means you accept the following."
    >
      <DocSection title="What VISE is">
        <p>
          VISE is a website and an open-source Solana program. The program lets
          holders of a pump.fun coin lock it for a chosen period and share the
          SOL that the coin&apos;s fee stream pays into its pool. The website
          builds transactions for that program and for pump.fun; the chain
          executes them. VISE does not custody pooled funds and has no
          instruction that can move them.
        </p>
      </DocSection>

      <DocSection title="Risk">
        <p>
          Memecoins can go to zero. A lock is a lock: your coins are unavailable
          until the date you chose, and leaving early burns part of them and
          forfeits unclaimed rewards. Rewards are whatever fees actually arrive;
          nothing is promised, projected or guaranteed. Smart contracts can have
          bugs. Nothing on this site is financial advice.
        </p>
      </DocSection>

      <DocSection title="Accounts">
        <p>
          If you sign in with Google, VISE holds an encrypted key for a wallet
          that is yours. You can withdraw or export it at any time. You are
          responsible for the security of your Google account and for anything
          done through it. Keep the exported key private; anyone who has it has
          the wallet.
        </p>
      </DocSection>

      <DocSection title="Fees">
        <p>
          Trades routed through the site carry a 2% fee on the SOL side, paid
          into the traded coin&apos;s lock pool. Pools split what they receive
          90% to lockers and 10% to the VISE treasury. Opening a pool costs a
          flat fee shown before you sign. All of this is visible in the
          transaction before it is signed. See{" "}
          <Link href="/docs/fees">how fees work</Link>.
        </p>
      </DocSection>

      <DocSection title="Availability">
        <p>
          The site may be unavailable, rate-limited or changed at any time.
          The program keeps working without it: positions, claims and unlocks
          are yours through any client that speaks to the chain.
        </p>
      </DocSection>

      <DocSection title="Eligibility">
        <p>
          Do not use VISE where doing so is unlawful. You must be of legal age
          in your jurisdiction. VISE is provided as-is, without warranty, and
          its operators are not liable for losses arising from its use.
        </p>
      </DocSection>
    </DocPage>
  );
}
