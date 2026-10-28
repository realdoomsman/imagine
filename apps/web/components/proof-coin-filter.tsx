"use client";

import { useRouter } from "next/navigation";
import type { ProofFeedType, ProofSummary } from "@/lib/api";

/** Narrow the proof page to one coin (or back to all), keeping the type filter. */
export function ProofCoinFilter({
  coins,
  selected,
  type,
}: {
  coins: ProofSummary["coins"];
  selected: string | null;
  type: ProofFeedType;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-muted">
      Coin
      <select
        value={selected ?? ""}
        onChange={(event) => {
          const query = new URLSearchParams();
          if (event.target.value) query.set("coin", event.target.value);
          if (type !== "payouts") query.set("type", type);
          const search = query.toString();
          router.push(search ? `/proof?${search}` : "/proof", { scroll: false });
        }}
        className="input h-9 w-auto py-0 pr-8 text-[13px]"
      >
        <option value="">All coins</option>
        {coins.map((coin) => (
          <option key={coin.mint} value={coin.mint}>
            ${coin.symbol ?? `${coin.mint.slice(0, 4)}…`} · {coin.payouts} payout{coin.payouts === 1 ? "" : "s"}
          </option>
        ))}
      </select>
    </label>
  );
}
