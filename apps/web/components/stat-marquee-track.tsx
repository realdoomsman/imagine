"use client";

import { useEffect, useState } from "react";
import { api, type Stats } from "@/lib/api";
import { formatBps, formatUsd } from "@/lib/format";

/**
 * The marquee's moving part. The track is rendered twice and translated by
 * exactly -50%, so the loop is seamless with no measurement and no JS driving
 * the animation. Live figures appear only once the API has answered with
 * them; until then (or if it never does) the strip carries just the fixed
 * terms, never zeros dressed as facts.
 */
export function StatMarqueeTrack({
  terms,
  defaultTradeFeeBps,
  defaultPoolFeeBps,
}: {
  terms: Array<{ label: string; value: string }>;
  defaultTradeFeeBps: number;
  defaultPoolFeeBps: number;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [fees, setFees] = useState({ tradeFeeBps: defaultTradeFeeBps, poolFeeBps: defaultPoolFeeBps });

  useEffect(() => {
    let cancelled = false;
    api.stats().then(
      (value) => {
        if (!cancelled) setStats(value);
      },
      () => undefined,
    );
    api.config().then(
      (config) => {
        if (!cancelled) setFees({ tradeFeeBps: config.tradeFeeBps, poolFeeBps: config.poolFeeBps });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const live =
    stats && stats.pools > 0
      ? [
          { label: "Coins live", value: stats.pools.toLocaleString("en-US") },
          ...(stats.earned_by_lockers_usd != null ? [{ label: "Earned by lockers", value: formatUsd(stats.earned_by_lockers_usd) }] : []),
          ...(stats.paid_out_to_lockers_usd != null ? [{ label: "Paid out to lockers", value: formatUsd(stats.paid_out_to_lockers_usd) }] : []),
          ...(stats.lockers_24h_usd !== null ? [{ label: "To lockers, 24h", value: formatUsd(stats.lockers_24h_usd) }] : []),
          { label: "Open locks", value: stats.open_positions.toLocaleString("en-US") },
          { label: "Trades 24h", value: stats.trades_24h.toLocaleString("en-US") },
        ]
      : [];
  const items = [
    ...live,
    { label: "Every trade, on-chain, to the pool", value: formatBps(fees.poolFeeBps) },
    { label: "Trades on imagine.fun, to the pool", value: formatBps(fees.poolFeeBps + fees.tradeFeeBps) },
    ...terms,
  ];

  return (
    <div className="marquee-host relative overflow-hidden border-y border-line bg-ink-1 py-4">
      {/* Feathered ends, so the strip reads as continuous rather than clipped. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink to-transparent" />

      <div className="marquee" aria-hidden="true">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0">
            {items.map((item) => (
              <span key={`${copy}-${item.label}`} className="flex items-baseline gap-2.5 whitespace-nowrap px-7">
                <span className="eyebrow">{item.label}</span>
                <span className="num text-[14px] text-fg">{item.value}</span>
                <span className="ml-5 text-line-strong">/</span>
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* Screen readers get the figures once, without the duplicated track. */}
      <ul className="sr-only">
        {items.map((item) => (
          <li key={item.label}>
            {item.label}: {item.value}
          </li>
        ))}
      </ul>
    </div>
  );
}
