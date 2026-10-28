"use client";

import { formatTokenAmount, shortAddress } from "@imagine/sdk";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ProofFeedType, type ProofPage, type ProofPayout } from "@/lib/api";
import { explorerAccount, explorerTx, formatQuote, usdSuffix } from "@/lib/format";

/** How often the newest page is re-read, so payouts appear without a reload. */
const REFRESH_MS = 30_000;

const TYPE_LABEL: Record<ProofPayout["type"], string> = { claim: "Claim", compound: "Compound", burn: "Burn" };

/**
 * The payout feed: newest first, the next page loaded as the end of the list
 * scrolls into view (or on the button), and the newest page re-read every
 * half minute with anything new put on top. Every row links its signature
 * and wallet to Solscan.
 */
export function ProofFeed({ initial, mint, type }: { initial: ProofPage; mint: string | null; type: ProofFeedType }) {
  const [rows, setRows] = useState<ProofPayout[]>(initial.payouts);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const more = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await api.proofPayouts({ mint: mint ?? undefined, type, cursor });
      setRows((previous) => {
        const seen = new Set(previous.map((row) => row.id));
        return [...previous, ...page.payouts.filter((row) => !seen.has(row.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    } catch {
      setError("The index didn't answer. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, mint, type]);

  useEffect(() => {
    const target = end.current;
    if (!target || !cursor) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void more();
    }, { rootMargin: "400px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, more]);

  useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        const page = await api.proofPayouts({ mint: mint ?? undefined, type });
        setRows((previous) => {
          const seen = new Set(previous.map((row) => row.id));
          const fresh = page.payouts.filter((row) => !seen.has(row.id));
          return fresh.length > 0 ? [...fresh, ...previous] : previous;
        });
      } catch {
        // The next tick tries again; the rows already shown stay.
      }
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [mint, type]);

  if (rows.length === 0) {
    return (
      <p className="card mt-4 px-6 py-10 text-center text-[13.5px] text-muted">
        {type === "burns"
          ? "No early exit has burned anything yet."
          : "No payouts yet. They appear here the moment a locker claims or compounds."}
      </p>
    );
  }

  return (
    <div className="card mt-4 overflow-hidden">
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Payouts, scrolls sideways">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="hairline text-left">
              <Th>Time</Th>
              <Th>Type</Th>
              <Th>Coin</Th>
              <Th>Wallet</Th>
              <Th align="right">Amount</Th>
              <Th align="right">Transaction</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line transition-colors duration-200 hover:bg-ink-3/60">
                <td className="num whitespace-nowrap px-5 py-2.5 text-muted" title={new Date(row.at).toISOString()}>
                  {/* UTC on both server and browser, so the first render and hydration agree. */}
                  {new Date(row.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" })}{" "}
                  UTC
                </td>
                <td className="px-5 py-2.5">
                  <span className={`pill h-[20px] px-2 text-[10.5px] ${row.type === "burn" ? "pill-down" : row.type === "compound" ? "pill-steel" : "pill-up"}`}>
                    {TYPE_LABEL[row.type]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 py-2.5">
                  <Link href={`/coins/${row.mint}`} className="inline-flex items-center gap-2 font-semibold text-fg hover:text-steel-hi">
                    {row.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- coin images live on the API's file host
                      <img src={row.imageUrl} alt="" className="size-6 rounded-[6px] border border-line bg-ink-3 object-cover" loading="lazy" />
                    ) : (
                      <span className="flex size-6 items-center justify-center rounded-[6px] border border-line bg-ink-3 text-[11px] text-muted">
                        {(row.symbol ?? "?").slice(0, 1)}
                      </span>
                    )}
                    ${row.symbol ?? shortAddress(row.mint)}
                  </Link>
                </td>
                <td className="num whitespace-nowrap px-5 py-2.5">
                  <a href={explorerAccount(row.owner)} target="_blank" rel="noreferrer" className="text-fg-soft hover:text-steel-hi">
                    {shortAddress(row.owner)}
                  </a>
                </td>
                <td className="num whitespace-nowrap px-5 py-2.5 text-right">
                  <Amount row={row} />
                </td>
                <td className="num whitespace-nowrap px-5 py-2.5 text-right">
                  <a href={explorerTx(row.signature)} target="_blank" rel="noreferrer" className="text-steel-hi hover:text-fg">
                    {row.signature.slice(0, 10)}… ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div ref={end} className="hairline flex items-center justify-center px-5 py-3">
        {cursor ? (
          <button type="button" onClick={() => void more()} disabled={loading} className="btn btn-ghost btn-sm">
            {loading ? "Loading…" : "Load more"}
          </button>
        ) : (
          <span className="text-[12px] text-muted">That&apos;s every one, back to the first.</span>
        )}
        {error ? <span className="ml-3 text-[12px] text-rose">{error}</span> : null}
      </div>
    </div>
  );
}

function Amount({ row }: { row: ProofPayout }) {
  const ticker = `$${row.symbol ?? shortAddress(row.mint)}`;
  if (row.type === "burn") {
    return (
      <span className="text-fg-soft">
        {formatTokenAmount(BigInt(row.tokens ?? "0"), row.decimals)} {ticker}
      </span>
    );
  }
  const amount = row.amount ?? "0";
  const usd = usdSuffix(amount, row.quote);
  return (
    <span className="inline-flex flex-col items-end">
      <span className="text-mint">{formatQuote(amount, row.quote)}</span>
      <span className="text-[11px] text-muted">
        {row.type === "compound" && row.tokens ? `→ ${formatTokenAmount(BigInt(row.tokens), row.decimals)} ${ticker} locked` : usd}
      </span>
    </span>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th scope="col" className={`px-5 py-2.5 font-normal ${align === "right" ? "text-right" : ""}`}>
      <span className="eyebrow">{children}</span>
    </th>
  );
}
