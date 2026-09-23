import Link from "next/link";
import { api, type PoolSummary } from "@/lib/api";
import { CoinCard } from "@/components/coin-card";

export const dynamic = "force-dynamic";

const SORTS = [
  { key: "new", label: "Newest" },
  { key: "rewards", label: "Most paid out" },
  { key: "locked", label: "Most locked" },
  { key: "lockers", label: "Most lockers" },
] as const;

export default async function CoinsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string }>;
}) {
  const params = await searchParams;
  const sort = SORTS.some((s) => s.key === params.sort) ? params.sort! : "new";

  let pools: PoolSummary[] = [];
  let error: string | null = null;
  try {
    ({ pools } = await api.pools({ sort, search: params.q, limit: 60 }));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "could not reach the indexer";
  }

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:py-20">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="rule-label">Coins</p>
          <h1 className="t-section mt-5">
            Every coin with a vise on it
          </h1>
        </div>

        <nav className="flex flex-wrap gap-1.5">
          {SORTS.map((option) => (
            <Link
              key={option.key}
              href={`/coins?sort=${option.key}`}
              className={`rounded-machined border px-3 py-1.5 text-[13px] transition-colors ${
                sort === option.key
                  ? "border-torch bg-torch/10 text-torch"
                  : "border-steel-700 text-steel-400 hover:border-steel-500 hover:text-steel-200"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </header>

      {error ? (
        <EmptyState
          title="The indexer is not answering"
          body={error}
        />
      ) : pools.length === 0 ? (
        <EmptyState
          title="No coins yet"
          body="Nothing has been launched through VISE on this cluster. Be the first."
          action={{ href: "/launch", label: "Launch a coin" }}
        />
      ) : (
        <div className="mt-10 grid gap-px border border-steel-700 bg-steel-700 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pools.map((pool) => (
            <CoinCard key={pool.mint} pool={pool} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="panel mt-10 flex flex-col items-start gap-4 p-12">
      <h2 className="text-[20px]">{title}</h2>
      <p className="max-w-lg text-[14px] text-steel-500">{body}</p>
      {action ? (
        <Link href={action.href} className="btn btn-primary">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
