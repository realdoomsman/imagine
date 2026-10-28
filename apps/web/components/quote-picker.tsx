"use client";

import { useMemo, useState } from "react";
import type { QuoteInfo } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { groupQuotes } from "@/lib/quotes";
import { QuoteLogo } from "./pair-pill";
import { Shimmer } from "./skeleton";

/**
 * Choose what the coin is paired with: every pair StonkFun can launch against
 * right now, grouped by category, searchable by ticker, name or mint. The
 * pair is what the coin is priced in and what its lockers will be paid in.
 */
export function QuotePicker({
  quotes,
  error,
  onRetry,
  selected,
  onSelect,
}: {
  /** null while loading. */
  quotes: QuoteInfo[] | null;
  error: string | null;
  onRetry: () => void;
  selected: QuoteInfo | null;
  onSelect: (quote: QuoteInfo) => void;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<string | null>(null);
  const allGroups = useMemo(() => groupQuotes(quotes ?? []), [quotes]);
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allGroups
      .filter((group) => tab === null || group.category === tab)
      .map((group) => ({
        ...group,
        quotes: needle
          ? group.quotes.filter(
              (quote) =>
                quote.symbol.toLowerCase().includes(needle) ||
                quote.name.toLowerCase().includes(needle) ||
                quote.mint.toLowerCase() === needle,
            )
          : group.quotes,
      }))
      .filter((group) => group.quotes.length > 0);
  }, [allGroups, query, tab]);

  if (error) {
    return (
      <div className="well flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <p className="text-[13px] text-rose">The pair list couldn&apos;t be loaded: {error}</p>
        <button type="button" onClick={onRetry} className="btn btn-ghost btn-sm">
          Try again
        </button>
      </div>
    );
  }

  if (!quotes) {
    return (
      <div className="well space-y-2 p-3" aria-busy="true">
        <Shimmer className="h-10 w-full" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Shimmer key={index} className="h-14 w-full" />
          ))}
        </div>
        <p className="sr-only">Loading pairs…</p>
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="well px-4 py-5 text-[13px] text-muted">
        StonkFun isn&apos;t offering any launchable pairs right now. Try again shortly.
      </div>
    );
  }

  return (
    <div className="well p-3">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${quotes.length} pairs — NVDAx, SOL, USDC…`}
        aria-label="Search pair assets"
        className="input text-[14px]"
      />
      <div className="mt-2.5 flex flex-wrap gap-1.5" role="tablist" aria-label="Pair category">
        {[{ category: null, label: "All" }, ...allGroups].map((group) => (
          <button
            key={group.category ?? "all"}
            type="button"
            role="tab"
            aria-selected={tab === group.category}
            onClick={() => setTab(group.category)}
            className={`pill cursor-pointer transition-colors ${
              tab === group.category ? "border-transparent bg-steel text-ink" : "hover:border-line-strong hover:text-fg"
            }`}
          >
            {group.label}
          </button>
        ))}
      </div>
      <div className="mt-3 max-h-[360px] space-y-4 overflow-y-auto pr-1" role="listbox" aria-label="Pair asset">
        {groups.length === 0 ? (
          <p className="px-1 py-4 text-[13px] text-muted">
            No pair matches{query.trim() ? ` “${query.trim()}”` : ""}
            {tab ? ` in ${allGroups.find((group) => group.category === tab)?.label ?? tab}` : ""}.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.category}>
              <p className="eyebrow px-1">
                {group.label} <span className="text-muted/70">{group.quotes.length}</span>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.quotes.map((quote) => {
                  const active = selected?.mint === quote.mint;
                  return (
                    <button
                      key={quote.mint}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => onSelect(quote)}
                      className={`flex min-w-0 items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "card-dream"
                          : "border-line bg-ink-2 hover:border-line-strong"
                      }`}
                    >
                      <QuoteLogo quote={quote} size={24} />
                      <span className="min-w-0">
                        <span className="num block truncate text-[13.5px] font-semibold text-fg">{quote.symbol}</span>
                        <span className="block truncate text-[11px] text-muted">
                          {quote.usdPrice !== null ? formatUsd(quote.usdPrice) : quote.name}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
