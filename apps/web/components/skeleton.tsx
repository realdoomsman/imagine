/**
 * Loading placeholders.
 *
 * A shimmer sweep rather than a pulsing opacity: pulsing reads as "broken and
 * blinking", a sweep reads as "working". The shapes mirror the real content's
 * geometry exactly, so nothing jumps when the data lands.
 */
export function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-[2px] ${className}`} aria-hidden="true" />;
}

export function CoinCardSkeleton() {
  return (
    <div className="surface p-5">
      <div className="flex items-start gap-3">
        <Shimmer className="size-11 shrink-0" />
        <div className="min-w-0 flex-1">
          <Shimmer className="h-4 w-24" />
          <Shimmer className="mt-2 h-3 w-32" />
        </div>
      </div>
      <div className="mt-6">
        <div className="flex items-end justify-between">
          <Shimmer className="h-2.5 w-28" />
          <Shimmer className="h-6 w-16" />
        </div>
        <Shimmer className="mt-2.5 h-[7px] w-full" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-steel-780 pt-4">
        {[0, 1, 2].map((index) => (
          <div key={index}>
            <Shimmer className="h-2.5 w-12" />
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
      <Shimmer className="h-3.5 w-40" />
      <Shimmer className="ml-auto h-3.5 w-24" />
    </div>
  );
}
