import { formatSol } from "@vise/sdk";

/**
 * Seven days of fee inflow, bucketed hourly.
 *
 * Drawn as bars in plain SVG rather than pulling in a charting library: the
 * shape is a bar chart with one series, and 40KB of library for that is the
 * kind of thing that makes a site feel generic and slow.
 */
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

  return (
    <section className="panel p-6">
      <header className="flex items-baseline justify-between">
        <h2 className="text-[17px]">Fees to lockers</h2>
        <span className="num text-[13px] text-verdi">
          {formatSol(total)} SOL / 7d
        </span>
      </header>

      {buckets.length === 0 ? (
        <p className="mt-6 text-[13px] text-steel-500">
          No trading fees yet. The first trade through VISE starts the stream.
        </p>
      ) : (
        <div className="mt-6 flex h-32 items-end gap-px">
          {buckets.map((bucket) => {
            const value = BigInt(bucket.to_lockers);
            const height = Number((value * 100n) / peak);
            return (
              <div
                key={bucket.bucket}
                className="group relative flex-1 bg-torch/70 transition-colors hover:bg-torch"
                style={{ height: `${Math.max(height, 2)}%` }}
                title={`${new Date(bucket.bucket).toLocaleString()} — ${formatSol(value)} SOL`}
              />
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[11px] text-steel-600">
        Realised payouts, not projections. Every bar is SOL that actually reached
        a locker&apos;s claimable balance.
      </p>
    </section>
  );
}
