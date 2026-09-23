import { CoinCardSkeleton, Shimmer } from "@/components/skeleton";

export default function CoinsLoading() {
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:py-20">
      <p className="rule-label">Coins</p>
      <Shimmer className="mt-5 h-12 w-[min(560px,80%)]" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <CoinCardSkeleton key={index} />
        ))}
      </div>
      <p className="sr-only">Loading coins…</p>
    </div>
  );
}
