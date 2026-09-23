"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Stats = {
  pools: number;
  paid_to_lockers: string;
  total_inflow: string;
  open_positions: number;
  lockers_24h: string;
  trades_24h: number;
};

const LAMPORTS = 1_000_000_000;

function sol(lamports: string | undefined): string {
  const value = Number(lamports ?? 0) / LAMPORTS;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K SOL`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;
}

function count(value: number | undefined): string {
  return (value ?? 0).toLocaleString("en-US");
}

/**
 * A slow conveyor of protocol figures under the hero.
 *
 * The track is rendered twice and translated by exactly -50%, so the loop is
 * seamless with no measurement and no JS driving the animation. Constants sit
 * alongside live figures on purpose: a brand-new protocol with four zeroes on
 * the strip looks broken, and the fixed terms are the more interesting numbers
 * anyway.
 */
export function StatMarquee() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .stats()
      .then((value) => {
        if (!cancelled) setStats(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const items = [
    { label: "Coins live", value: count(stats?.pools) },
    { label: "Paid to lockers", value: sol(stats?.paid_to_lockers) },
    { label: "Fee inflow", value: sol(stats?.total_inflow) },
    { label: "Open locks", value: count(stats?.open_positions) },
    { label: "Trades 24h", value: count(stats?.trades_24h) },
    { label: "App fee", value: "2.00%" },
    { label: "Max weight", value: "4.00×" },
    { label: "Locker share", value: "72%" },
    { label: "Reward stream", value: "24h" },
  ];

  return (
    <div className="marquee-host relative overflow-hidden border-y border-steel-780 bg-steel-950/60 py-4">
      {/* Feathered ends, so the strip reads as continuous rather than clipped. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-steel-990 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-steel-990 to-transparent" />

      <div className="marquee" aria-hidden="true">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0">
            {items.map((item) => (
              <span
                key={`${copy}-${item.label}`}
                className="flex items-baseline gap-2.5 whitespace-nowrap px-7"
              >
                <span className="rule-label">{item.label}</span>
                <span className="num text-[14px] text-steel-100">{item.value}</span>
                <span className="ml-5 text-steel-700">/</span>
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
