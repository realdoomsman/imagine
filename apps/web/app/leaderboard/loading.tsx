import { RowSkeleton, Shimmer } from "@/components/skeleton";

export default function LeaderboardLoading() {
  return (
    <div className="mx-auto max-w-[1100px] px-5 py-16 sm:px-8 lg:py-20">
      <p className="rule-label">Leaderboard</p>
      <Shimmer className="mt-5 h-12 w-[min(620px,85%)]" />
      <div className="panel mt-12 divide-y divide-steel-860">
        {Array.from({ length: 10 }, (_, index) => (
          <RowSkeleton key={index} />
        ))}
      </div>
      <p className="sr-only">Loading the leaderboard…</p>
    </div>
  );
}
