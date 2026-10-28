import { ECONOMICS, formatMultiplier, formatPercent } from "@imagine/sdk";
import { StatMarqueeTrack } from "./stat-marquee-track";

/**
 * A slow conveyor of protocol figures under the hero.
 *
 * The fixed terms are worked out here, on the server, so the SDK never ships
 * in the home page's client bundle; the track fetches the live figures.
 */
export function StatMarquee() {
  return (
    <StatMarqueeTrack
      defaultTradeFeeBps={ECONOMICS.tradeFeeBps}
      terms={[
        { label: "Paid in", value: "the pair asset" },
        { label: "Locker share", value: formatPercent((10_000 - ECONOMICS.treasuryShareBps) / 10_000, 0) },
        { label: "Max multiplier", value: formatMultiplier(ECONOMICS.maxMultiplierBps) },
        { label: "Creator cut", value: "0%" },
        { label: "Admin withdraw", value: "none" },
      ]}
    />
  );
}
