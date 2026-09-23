import Link from "next/link";
import { DocPage, DocSection } from "@/components/doc-page";

export const metadata = {
  title: "Security",
  description:
    "What the VISE program cannot do, what it was audited for, and what can still go wrong.",
};

const PROGRAM_ID = "VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb";

export default function SecurityPage() {
  return (
    <DocPage
      eyebrow="Security"
      title="What the program cannot do"
      lede="The parts that matter are not promises we make. They are properties of the deployed bytecode, and you can check every one of them."
    >
      <DocSection title="No admin path to your money">
        <p>
          There is no instruction in this program that moves a pool&apos;s SOL or
          tokens to an admin. Not a disabled one, not a timelocked one — it does
          not exist in the bytecode.
        </p>
        <p>
          Only two signers can ever move a pool&apos;s funds. The vault PDA pays
          the locker, creator, or treasury that earned a specific amount. The
          pool PDA returns locked tokens to their owner or burns an early-exit
          penalty. Neither can be directed by an admin key.
        </p>
      </DocSection>

      <DocSection title="Terms are frozen when a pool is created">
        <p>
          The fee split, multiplier curve, lock bounds, exit penalty, release
          window and treasury address are copied onto the pool at creation, and
          nothing rewrites them afterwards. We can change the defaults that apply
          to coins launched later. We cannot reach into a pool that already
          exists.
        </p>
      </DocSection>

      <DocSection title="Claiming and unlocking cannot be paused">
        <p>
          There is a pause switch. It is read by exactly one instruction — the
          one that creates new pools. Claim, unlock, extend and deposit do not
          even load the config account, so there is no code path by which a
          paused platform could hold your position hostage.
        </p>
      </DocSection>

      <DocSection title="The creator is exposed first">
        <p>
          A pool cannot be created without the creator&apos;s own locked
          position, opened in the same instruction. The amount and the term are
          public on the coin&apos;s page from its first block.
        </p>
        <p>
          A pool can also only be created by the person who actually launched the
          coin: the program reads pump.fun&apos;s own{" "}
          <code>BondingCurve.creator</code> record and requires it to match the
          signer. Nobody can squat your coin&apos;s pool and collect its creator
          share.
        </p>
      </DocSection>

      <DocSection title="Hostile mints are refused">
        <p>
          A lock vault holds someone else&apos;s tokens for up to a year. Any
          mint that lets a third party interfere with that is rejected at pool
          creation: freeze authority, transfer fees, transfer hooks, permanent
          delegates, non-transferable tokens, default-frozen accounts.
        </p>
        <p>
          The check is an allow-list, so a token extension invented after this
          program was compiled is rejected rather than waved through.
        </p>
      </DocSection>

      <DocSection title="Solvency is a proven property, not a hope">
        <p>
          Rounding always favours the pool. When fees are spread across weight,
          the amount the pool sets aside is rounded <em>up</em> from the credit it
          hands out, while each position&apos;s claim is rounded <em>down</em>.
          Each position keeps its own sub-lamport residue rather than rounding to
          whole lamports, which is what stops many positions from each rounding
          up until the pool owes more than it holds.
        </p>
        <p>
          A randomised test drives a pool through thousands of locks, deposits,
          claims and exits and asserts, after every single step, that the vault
          can still pay everyone it owes. A second test hammers the same property
          with hundreds of uneven deposits.
        </p>
      </DocSection>

      <DocSection title="What was audited, and what was found">
        <p>
          A full pre-deployment review covered the entire program: every account
          constraint, every arithmetic site, the Sealevel attack checklist, and
          the accounting invariants re-derived by hand.
        </p>
        <p>
          It found fourteen issues — one critical, three high, one medium. All of
          them are fixed, and each fix carries a regression test that fails
          against the old code. The critical one let a matured position mint
          full-multiplier weight with no remaining lock term; the highest-value
          fix was making rewards stream over time rather than land in an instant
          that could be chosen by whoever was watching.
        </p>
        <p>
          That review was internal. An independent external audit has not yet
          happened, and this page will say so until it has.
        </p>
      </DocSection>

      <DocSection title="What can still go wrong">
        <ul>
          <li>
            <strong>The coin can go to zero.</strong> Locking makes that worse,
            because you cannot sell into the decline without burning part of your
            bag. VISE changes who receives trading fees; it does not make a bad
            coin good.
          </li>
          <li>
            <strong>A coin with no volume pays nothing.</strong> There is no
            emission, no inflation and no treasury subsidy. Yield here is other
            people trading.
          </li>
          <li>
            <strong>The upgrade authority is a real authority.</strong> The
            program can be upgraded by whoever holds it. It belongs to a
            multisig, and burning it entirely is the end state — but until that
            happens, saying otherwise would be a lie.
          </li>
          <li>
            <strong>The app fee depends on our front-end.</strong> It is enforced
            by the transaction our API builds. If the API is compromised, the fee
            it attaches could be changed — though it still can only ever pay into
            the coin&apos;s own vault.
          </li>
        </ul>
      </DocSection>

      <DocSection title="Check it yourself">
        <p>
          Program: <code>{PROGRAM_ID}</code>
        </p>
        <p>
          Read the source, or read the tests — they are the shorter route to
          knowing whether the guarantees on this page hold.
        </p>
      </DocSection>

      <div className="hairline mt-12 flex flex-wrap gap-3 pt-8">
        <Link href="/how-it-works" className="btn btn-primary">
          How it works
        </Link>
        <Link href="/docs/fees" className="btn btn-ghost">
          Fee breakdown
        </Link>
      </div>
    </DocPage>
  );
}
