import { Shimmer } from "@/components/skeleton";

export default function CoinLoading() {
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-14 sm:px-8">
      <header className="flex flex-wrap items-start gap-5">
        <Shimmer className="size-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <Shimmer className="h-7 w-44" />
          <Shimmer className="mt-2.5 h-3.5 w-32" />
        </div>
        <div className="flex gap-10">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index}>
              <Shimmer className="h-2.5 w-20" />
              <Shimmer className="mt-2 h-5 w-24" />
            </div>
          ))}
        </div>
      </header>

      <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="space-y-5">
          <div className="panel p-6">
            <Shimmer className="h-4 w-36" />
            <Shimmer className="mt-6 h-32 w-full" />
          </div>
          <div className="panel p-6">
            <Shimmer className="h-4 w-48" />
            <Shimmer className="mt-6 h-20 w-full" />
          </div>
        </div>
        <div className="panel p-6">
          <Shimmer className="h-4 w-28" />
          <Shimmer className="mt-6 h-11 w-full" />
          <Shimmer className="mt-5 h-6 w-full" />
          <Shimmer className="mt-5 h-16 w-full" />
        </div>
      </div>
      <p className="sr-only">Loading this coin…</p>
    </div>
  );
}
