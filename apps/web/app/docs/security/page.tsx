import { IMAGINE_PROGRAM_ID } from "@imagine/sdk";
import { DocLinks, DocPage, DocSection } from "@/components/doc-page";

export const metadata = {
  title: "Security",
  description: "What the IMAGINE program cannot do, how it treats StonkFun coins, and what can still go wrong.",
};

export default function SecurityPage() {
  const programId = IMAGINE_PROGRAM_ID.toBase58();
  return (
    <DocPage
      eyebrow="Docs · Security"
      title="What the program cannot do"
      lede="The parts that matter are properties of the deployed program, not promises in a pitch. Each one below is something you can check."
    >
      <DocSection title="No admin withdraw path">
        <p>
          There is no instruction that moves a pool&apos;s rewards or locked coins to an admin. Not
          a disabled one, not a timelocked one: it is not in the program.
        </p>
        <p>
          Only program-derived accounts move a pool&apos;s funds. The vault pays the locker, creator
          or treasury that earned a specific amount, in the pair asset. The pool returns locked
          coins to their owner, or burns an early-exit penalty. Neither can be pointed anywhere
          else by a key.
        </p>
      </DocSection>

      <DocSection title="Terms are frozen when a pool is created">
        <p>
          The fee split, multiplier curve, size tiers, lock bounds, exit penalty, stream window and
          treasury address are copied onto the pool when it is created, and nothing rewrites them
          afterwards. Defaults can change for coins launched later; a pool that exists keeps its
          terms.
        </p>
      </DocSection>

      <DocSection title="Claims and unlocks can't be paused">
        <p>
          There is a pause switch, and it stops new pools. Claiming and unlocking do not consult
          it, so no state of the platform can hold a position hostage.
        </p>
      </DocSection>

      <DocSection title="The creator locks first">
        <p>
          A pool opens with the creator&apos;s own lock, and nobody else can lock until it exists.
          The amount and the term are public on the coin&apos;s page from the start.
        </p>
      </DocSection>

      <DocSection title="StonkFun coins, checked on-chain">
        <p>
          Launching goes through the program, which creates the coin on Raydium LaunchLab under
          StonkFun&apos;s platform config and requires that config to be the one it has on file.
          The coin&apos;s creator address on LaunchLab is the pool&apos;s vault.
        </p>
        <p>
          When a lock&apos;s ceiling is priced, the program reads the coin&apos;s own LaunchLab pool,
          pinned when the coin launched, and checks who owns it. After migration it reads the
          coin&apos;s Raydium pool and checks that it is the canonical pool for the coin and its pair.
        </p>
        <p>
          A lock vault holds someone else&apos;s coins for up to a year, so mints that would let a
          third party interfere with them are refused. The check is an allow-list of exactly what
          LaunchLab coins use.
        </p>
      </DocSection>

      <DocSection title="Solvency">
        <p>
          Rounding always favours the pool: the amount set aside when fees are spread across weight
          is rounded up, each position&apos;s claim is rounded down. A randomised test drives a pool
          through long runs of locks, deposits, claims and exits and checks after every step that
          the vault can still pay everyone it owes.
        </p>
      </DocSection>

      <DocSection title="What can still go wrong">
        <ul>
          <li>
            <strong>The coin can go to zero.</strong> Locking makes that worse, because you
            can&apos;t sell into the decline without burning part of your bag.
          </li>
          <li>
            <strong>A coin nobody trades pays nothing.</strong> There is no emission and no subsidy.
          </li>
          <li>
            <strong>The pair asset has its own risks.</strong> Lockers are paid in whatever the coin
            is paired with, and that asset&apos;s price moves on its own.
          </li>
          <li>
            <strong>StonkFun&apos;s forwarding is StonkFun&apos;s.</strong> The creator share is
            forwarded by StonkFun off-chain; the program cannot make it arrive.
          </li>
          <li>
            <strong>The app fee depends on our front-end.</strong> It is attached by the transaction
            our API builds, and it can only ever pay into the coin&apos;s own pool.
          </li>
          <li>
            <strong>Upgrade authority.</strong> Whoever holds a Solana program&apos;s upgrade
            authority can change it. Check this program&apos;s authority on an explorer before you
            trust it with size.
          </li>
          <li>
            <strong>No external audit has been published</strong> for this program. Treat it
            accordingly.
          </li>
        </ul>
      </DocSection>

      <DocSection title="Check it yourself">
        <p>
          Program: <code className="break-all">{programId}</code>
        </p>
        <p>
          <a href={`https://solscan.io/account/${programId}`} target="_blank" rel="noreferrer">
            View it on Solscan
          </a>
        </p>
      </DocSection>

      <DocLinks
        links={[
          { href: "/how-it-works", label: "How it works" },
          { href: "/docs/fees", label: "Fee breakdown" },
        ]}
      />
    </DocPage>
  );
}
