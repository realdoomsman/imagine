import { RowSkeleton, Shimmer } from "@/components/skeleton";

export default function LeaderboardLoading() {
  return (
    <div className="container-x max-w-[1100px] py-14 lg:py-20">
      <p className="eyebrow">Leaderboard</p>
      <Shimmer className="mt-4 h-12 w-[min(620px,85%)]" />
      <Shimmer className="mt-4 h-5 w-[min(480px,70%)]" />
      <div className="card mt-12 divide-y divide-line overflow-hidden">
        {Array.from({ length: 10 }, (_, index) => (
          <RowSkeleton key={index} />
        ))}
      </div>
      <p className="sr-only">Loading the leaderboard…</p>
    </div>
  );
}
