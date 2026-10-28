import { formatDuration, formatMultiplier, formatPercent, formatTokenAmount, shortAddress } from "@imagine/sdk";
import type { Locker, QuoteInfo } from "@/lib/api";
import { formatAmount } from "@/lib/format";

export function LockerTable({
  lockers,
  totalWeight,
  decimals,
  quote,
}: {
  lockers: Locker[];
  totalWeight: string;
  decimals: number;
  quote: QuoteInfo;
}) {
  const now = Math.floor(Date.now() / 1000);

  return (
    <section className="card overflow-hidden">
      <header className="flex items-baseline justify-between px-6 py-4">
        <h2 className="t-h3">Who&apos;s locked in</h2>
        <span className="num text-[12px] text-muted">
          {lockers.length} position{lockers.length === 1 ? "" : "s"}
        </span>
      </header>

      {lockers.length === 0 ? (
        <p className="px-6 pb-6 text-[13.5px] text-muted">Nobody has locked yet. The first lock takes the whole stream.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="hairline text-left">
                <Th>Wallet</Th>
                <Th align="right">Locked</Th>
                <Th align="right">Multiplier</Th>
                <Th align="right">Share</Th>
                <Th align="right">Unclaimed ({quote.symbol})</Th>
                <Th align="right">Unlocks</Th>
              </tr>
            </thead>
            <tbody>
              {lockers.map((locker) => (
                <tr
                  key={`${locker.owner}-${locker.index}`}
                  className="border-t border-line transition-colors duration-200 hover:bg-ink-3/60"
                >
                  <td className="num whitespace-nowrap px-6 py-2.5 text-fg-soft">
                    {shortAddress(locker.owner)}
                    {locker.renounced ? (
                      <span
                        className="pill ml-2 h-[20px] px-2 text-[10.5px]"
                        title="This lock gave up its earnings for good. Its tokens stay locked; everything it would have earned goes to the other lockers."
                      >
                        Earns nothing
                      </span>
                    ) : null}
                  </td>
                  <td className="num px-6 py-2.5 text-right text-fg">
                    {formatTokenAmount(BigInt(locker.amount), decimals)}
                  </td>
                  <td className="num px-6 py-2.5 text-right text-steel-hi">
                    {locker.renounced ? <span className="text-muted">—</span> : formatMultiplier(locker.multiplierBps)}
                  </td>
                  <td className="num px-6 py-2.5 text-right text-fg">{formatPercent(locker.share, 2)}</td>
                  <td className="num px-6 py-2.5 text-right text-mint">
                    {locker.renounced ? <span className="text-muted">—</span> : formatAmount(locker.pending, quote.decimals)}
                  </td>
                  <td className="num px-6 py-2.5 text-right text-fg-soft">{formatDuration(locker.lockEnd - now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="hairline px-6 py-3 text-[11.5px] text-muted">
        Total weight <span className="num">{totalWeight}</span> — the divisor for every payout in this pool.
      </footer>
    </section>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th scope="col" className={`px-6 py-2.5 font-normal ${align === "right" ? "text-right" : ""}`}>
      <span className="eyebrow">{children}</span>
    </th>
  );
}
