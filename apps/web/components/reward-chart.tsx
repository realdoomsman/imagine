import { formatSol } from "@vise/sdk";

/**
 * Seven days of fee inflow, bucketed hourly.
 *
 * Plain SVG rather than a charting library: this is a single-series bar chart,
 * and 40KB of dependency for that is how a site ends up feeling generic.
 *
 * The x axis is always the full window even when only one bucket has data, so
 * a single trade reads as a single trade rather than filling the whole frame.
 */
const WINDOW_HOURS = 168;

export function RewardChart({
  buckets,
}: {
  buckets: Array<{ bucket: string; inflow: string; to_lockers: string }>;
}) {
  const total = buckets.reduce((sum, b) => sum + BigInt(b.to_lockers), 0n);
  const peak = buckets.reduce(
    (max, b) => (BigInt(b.to_lockers) > max ? BigInt(b.to_lockers) : max),
    1n,
  );

  // Place each bucket at its real hour offset from now; gaps stay gaps.
  const now = Date.now();
  const points = buckets.map((bucket) => {
    const hoursAgo = (now - new Date(bucket.bucket).getTime()) / 3_600_000;
    const value = BigInt(bucket.to_lockers);
    return {
      key: bucket.bucket,
      x: Math.min(Math.max(1 - hoursAgo / WINDOW_HOURS, 0), 1),
      height: Number((value * 1000n) / peak) / 1000,
      label: `${new Date(bucket.bucket).toLocaleString()} — ${formatSol(value)} SOL`,
    };
  });

  return (
    <section className="panel p-6">
      <header className="flex items-baseline justify-between">
        <h2 className="text-[17px]">Fees to lockers</h2>
        <span className="num text-[13px] text-verdi">
          {formatSol(total)} SOL / 7d
        </span>
      </header>

      {points.length === 0 ? (
        <p className="mt-6 text-[13px] text-steel-500">
          No trading fees yet. The first trade through VISE starts the stream.
        </p>
      ) : (
        <div className="relative mt-6 h-32">
          {/* Reference lines, so a bar has something to be measured against. */}
          {[0.25, 0.5, 0.75, 1].map((fraction) => (
            <div
              key={fraction}
              className="absolute inset-x-0 border-t border-steel-860"
              style={{ bottom: `${fraction * 100}%` }}
            />
          ))}

          {points.map((point) => (
            <div
              key={point.key}
              className="group absolute bottom-0 w-[3px] -translate-x-1/2 rounded-t-[1px] transition-[filter] duration-200 hover:brightness-150"
              style={{
                left: `${point.x * 100}%`,
                height: `${Math.max(point.height * 100, 3)}%`,
                background:
                  "linear-gradient(180deg, var(--color-torch-bright), var(--color-torch-dim))",
              }}
              title={point.label}
            />
          ))}

          <div className="absolute inset-x-0 bottom-0 border-t border-steel-700" />
        </div>
      )}

      <div className="mt-2 flex justify-between">
        <span className="rule-label">7 days ago</span>
        <span className="rule-label">now</span>
      </div>

      <p className="mt-4 text-[11px] text-steel-600">
        Realised payouts, not projections. Every bar is SOL that actually reached
        a locker&apos;s claimable balance.
      </p>
    </section>
  );
}
