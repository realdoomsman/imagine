import { formatDuration } from "@imagine/sdk";
import type { QuoteInfo, RewardHistory } from "@/lib/api";
import { formatAmount, formatQuote, usdSuffix } from "@/lib/format";

/**
 * The lockers' share of fee inflow since the pool opened (up to 7 days), in
 * the coin's pair asset.
 *
 * The API picks the window and bucket width so there are at most 48 slots;
 * every slot gets a column, empty or not, so gaps in trading stay visible. A
 * running total is drawn over the bars: the bars say when fees came in, the
 * line says how much has come in all told.
 *
 * Plain SVG rather than a charting library: one series and one line.
 */
export function RewardChart({ history, quote }: { history: RewardHistory; quote: QuoteInfo }) {
  const { since, bucketSecs, createdAt, buckets } = history;
  const now = Math.floor(Date.now() / 1000);
  const slots = Math.max(Math.ceil((now - since) / bucketSecs), 1);

  const perSlot = new Array<bigint>(slots).fill(0n);
  for (const bucket of buckets) {
    const at = Math.floor(new Date(bucket.bucket).getTime() / 1000);
    const slot = Math.min(Math.max(Math.floor((at - since) / bucketSecs), 0), slots - 1);
    perSlot[slot] += BigInt(bucket.to_lockers ?? "0");
  }
  const total = perSlot.reduce((sum, value) => sum + value, 0n);
  const peak = perSlot.reduce((max, value) => (value > max ? value : max), 1n);

  let running = 0n;
  const cumulative = perSlot.map((value) => (running += value));
  const scale = (value: bigint, of: bigint) => (of > 0n ? Number((value * 10_000n) / of) / 10_000 : 0);

  // Chart space: x in slots, y in [0, 100] with 100 at the bottom.
  const HEIGHT = 100;
  const BAR = 0.62;
  const line = cumulative
    .map((value, i) => `${i + 1},${(HEIGHT - scale(value, total) * HEIGHT * 0.96).toFixed(2)}`)
    .join(" ");
  const area = `0,${HEIGHT} ${line} ${slots},${HEIGHT}`;

  const windowSecs = now - since;
  const young = createdAt !== null && createdAt > since;
  const startLabel = young ? `launched ${formatDuration(now - createdAt)} ago` : `${formatDuration(windowSecs)} ago`;
  const bucketLabel = formatDuration(bucketSecs);
  const windowLabel = young ? "since launch" : `/ ${formatDuration(windowSecs)}`;
  const usd = usdSuffix(total, quote);

  return (
    <section className="card p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="t-h3">The stream, paid in {quote.symbol}</h2>
        <span className="num text-[13px] text-mint">
          {formatQuote(total, quote)} {windowLabel}
          {usd ? <span className="ml-2 text-muted">{usd}</span> : null}
        </span>
      </header>

      {total === 0n ? (
        <div className="well mt-5 flex h-40 flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-[13.5px] text-fg-soft">No fees to lockers yet.</p>
          <p className="text-[12.5px] text-muted">The first trade through Imagine starts the stream.</p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-4 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-[2px] bg-steel" />
              per {bucketLabel}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[2px] w-3 bg-mint" />
              running total
            </span>
          </div>

          <div className="relative mt-5 h-48">
            {[0.25, 0.5, 0.75, 1].map((fraction) => (
              <div
                key={fraction}
                className="absolute inset-x-0 border-t border-dashed border-line"
                style={{ bottom: `${fraction * 100}%` }}
              />
            ))}
            <span className="num absolute right-0 top-0 -translate-y-full pb-0.5 text-[10px] text-muted">
              peak {formatAmount(peak, quote.decimals)} {quote.symbol} / {bucketLabel}
            </span>

            <svg
              viewBox={`0 0 ${slots} ${HEIGHT}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
              role="img"
              aria-label={`${formatQuote(total, quote)} to lockers ${windowLabel}`}
            >
              <defs>
                <linearGradient id="reward-bar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--steel-hi)" />
                  <stop offset="100%" stopColor="var(--steel)" stopOpacity="0.55" />
                </linearGradient>
                <linearGradient id="reward-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--mint)" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="var(--mint)" stopOpacity="0" />
                </linearGradient>
              </defs>

              <polygon points={area} fill="url(#reward-area)" />

              {perSlot.map((value, i) => {
                if (value === 0n) return null;
                const h = Math.max(scale(value, peak) * HEIGHT, 1.5);
                const start = new Date((since + i * bucketSecs) * 1000);
                return (
                  <rect
                    key={i}
                    x={i + (1 - BAR) / 2}
                    y={HEIGHT - h}
                    width={BAR}
                    height={h}
                    rx={0.12}
                    fill="url(#reward-bar)"
                    className="transition-[filter] duration-200 hover:brightness-125"
                  >
                    <title>
                      {`${start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}: ${formatQuote(value, quote)}`}
                    </title>
                  </rect>
                );
              })}

              <polyline
                points={`0,${HEIGHT} ${line}`}
                fill="none"
                stroke="var(--mint)"
                strokeWidth="2"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            <div className="absolute inset-x-0 bottom-0 border-t border-line-strong" />
          </div>

          <div className="mt-2 flex justify-between">
            <span className="eyebrow">{startLabel}</span>
            <span className="eyebrow">now</span>
          </div>
        </>
      )}

      <p className="mt-4 text-[11.5px] text-muted">
        Realised, not projected: the lockers&apos; share of every fee that actually arrived, streamed out to them over
        the pool&apos;s stream window.
      </p>
    </section>
  );
}
