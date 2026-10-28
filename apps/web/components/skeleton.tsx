/**
 * Loading placeholders.
 *
 * A shimmer sweep rather than a pulsing opacity: pulsing reads as "broken and
 * blinking", a sweep reads as "working". The shapes mirror the real content's
 * geometry, so nothing jumps when the data lands.
 */
export function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-[6px] ${className}`} aria-hidden="true" />;
}

export function CoinCardSkeleton() {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start gap-3.5">
        <Shimmer className="size-14 shrink-0 rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <Shimmer className="h-4 w-28" />
          <Shimmer className="mt-2 h-3 w-16" />
          <Shimmer className="mt-2.5 h-[26px] w-36 rounded-full" />
        </div>
      </div>
      <div className="mt-5 flex items-end justify-between">
        <div>
          <Shimmer className="h-2.5 w-20" />
          <Shimmer className="mt-2 h-5 w-24" />
        </div>
        <div className="flex flex-col items-end">
          <Shimmer className="h-2.5 w-24" />
          <Shimmer className="mt-2 h-5 w-16" />
        </div>
      </div>
      <Shimmer className="mt-2.5 h-[6px] w-full rounded-full" />
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3.5">
        {[0, 1, 2].map((index) => (
          <div key={index}>
            <Shimmer className="h-2.5 w-14" />
            <Shimmer className="mt-2 h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-6 py-3.5">
      <Shimmer className="h-3 w-6" />
      <Shimmer className="size-8 rounded-full" />
      <Shimmer className="h-3.5 w-40" />
      <Shimmer className="ml-auto h-3.5 w-24" />
    </div>
  );
}
