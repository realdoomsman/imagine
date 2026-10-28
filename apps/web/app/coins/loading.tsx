import { CoinCardSkeleton, Shimmer } from "@/components/skeleton";

export default function CoinsLoading() {
  return (
    <div className="container-x py-14 lg:py-20">
      <p className="eyebrow">Coins</p>
      <Shimmer className="mt-4 h-12 w-[min(560px,80%)]" />
      <Shimmer className="mt-4 h-5 w-[min(460px,70%)]" />
      <div className="mt-8 flex gap-1.5">
        {Array.from({ length: 6 }, (_, index) => (
          <Shimmer key={index} className="h-[26px] w-20 rounded-full" />
        ))}
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <CoinCardSkeleton key={index} />
        ))}
      </div>
      <p className="sr-only">Loading coins…</p>
    </div>
  );
}
