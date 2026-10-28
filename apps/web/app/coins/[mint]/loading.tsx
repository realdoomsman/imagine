import { Shimmer } from "@/components/skeleton";

export default function CoinLoading() {
  return (
    <div className="container-x py-10 lg:py-14">
      <header className="flex flex-col gap-6">
        <div className="flex min-w-0 flex-1 items-start gap-5">
          <Shimmer className="size-16 shrink-0 rounded-[14px] sm:size-20" />
          <div className="min-w-0 flex-1">
            <Shimmer className="h-8 w-56" />
            <div className="mt-3 flex gap-2">
              <Shimmer className="h-[26px] w-16 rounded-full" />
              <Shimmer className="h-[26px] w-36 rounded-full" />
            </div>
            <Shimmer className="mt-4 h-3 w-72 max-w-full" />
            <div className="mt-4 flex gap-2">
              <Shimmer className="h-9 w-28" />
              <Shimmer className="h-9 w-24" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="bg-ink-2 px-4 py-3.5">
              <Shimmer className="h-2.5 w-16" />
              <Shimmer className="mt-2 h-5 w-24" />
            </div>
          ))}
        </div>
      </header>

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <div className="card p-6">
            <Shimmer className="h-5 w-40" />
            <Shimmer className="mt-6 h-40 w-full" />
          </div>
          <div className="card p-6">
            <Shimmer className="h-5 w-56" />
            <Shimmer className="mt-6 h-20 w-full" />
          </div>
        </div>
        <div className="space-y-5">
          <div className="card p-6">
            <Shimmer className="h-10 w-full" />
            <Shimmer className="mt-5 h-12 w-full" />
            <Shimmer className="mt-5 h-11 w-full" />
          </div>
          <div className="card p-6">
            <Shimmer className="h-5 w-32" />
            <Shimmer className="mt-5 h-12 w-full" />
            <Shimmer className="mt-5 h-24 w-full" />
          </div>
        </div>
      </div>
      <p className="sr-only">Loading this coin…</p>
    </div>
  );
}
