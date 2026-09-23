import {
  formatDuration,
  formatMultiplier,
  formatPercent,
  formatSol,
  formatTokenAmount,
  shortAddress,
} from "@vise/sdk";
import type { Locker } from "@/lib/api";

export function LockerTable({
  lockers,
  totalWeight,
  decimals,
}: {
  lockers: Locker[];
  totalWeight: string;
  decimals: number;
}) {
  const now = Math.floor(Date.now() / 1000);

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-baseline justify-between px-6 py-4">
        <h2 className="text-[17px]">Who is clamped in</h2>
        <span className="num text-[12px] text-steel-500">
          {lockers.length} position{lockers.length === 1 ? "" : "s"}
        </span>
      </header>

      {lockers.length === 0 ? (
        <p className="px-6 pb-6 text-[13px] text-steel-500">
          Nobody has locked yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="hairline text-left">
                <Th>Wallet</Th>
                <Th align="right">Locked</Th>
                <Th align="right">Multiplier</Th>
                <Th align="right">Share</Th>
                <Th align="right">Unclaimed</Th>
                <Th align="right">Unlocks</Th>
              </tr>
            </thead>
            <tbody>
              {lockers.map((locker) => (
                <tr
                  key={`${locker.owner}-${locker.index}`}
                  className="border-t border-steel-800"
                >
                  <td className="num px-6 py-2.5 text-steel-300">
                    {shortAddress(locker.owner)}
                  </td>
                  <td className="num px-6 py-2.5 text-right text-steel-200">
                    {formatTokenAmount(BigInt(locker.amount), decimals)}
                  </td>
                  <td className="num px-6 py-2.5 text-right text-torch">
                    {formatMultiplier(locker.multiplierBps)}
                  </td>
                  <td className="num px-6 py-2.5 text-right text-steel-200">
                    {formatPercent(locker.share, 2)}
                  </td>
                  <td className="num px-6 py-2.5 text-right text-verdi">
                    {formatSol(BigInt(locker.pending))}
                  </td>
                  <td className="num px-6 py-2.5 text-right text-steel-400">
                    {formatDuration(locker.lockEnd - now)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="hairline px-6 py-3 text-[11px] text-steel-600">
        Total weight <span className="num">{totalWeight}</span> — the divisor for
        every payout in this pool.
      </footer>
    </section>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`rule-label px-6 py-2.5 font-normal ${align === "right" ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}
