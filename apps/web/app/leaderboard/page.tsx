import { formatMultiplier, formatSol, shortAddress } from "@vise/sdk";
import Link from "next/link";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

const BOARDS = [
  { key: "earners", label: "Top earners", note: "SOL actually claimed" },
  { key: "coins", label: "Top coins", note: "SOL paid to their lockers" },
  { key: "diamond", label: "Longest clamps", note: "live positions by term" },
] as const;

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const params = await searchParams;
  const board = BOARDS.some((b) => b.key === params.board)
    ? params.board!
    : "earners";

  let rows: Array<Record<string, string | number | null>> = [];
  let error: string | null = null;
  try {
    ({ rows } = await api.leaderboard(board));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "could not load the leaderboard";
  }

  const active = BOARDS.find((b) => b.key === board)!;

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-10">
      <p className="rule-label">Leaderboard</p>
      <h1 className="mt-3 text-[clamp(2rem,4vw,2.75rem)] leading-none">
        Ranked on money, not on promises
      </h1>
      <p className="mt-4 max-w-xl text-[15px] text-steel-400">
        Every board here is built from realised SOL or live on-chain commitments.
        No points, no season, nothing to farm.
      </p>

      <nav className="mt-8 flex flex-wrap gap-1.5">
        {BOARDS.map((option) => (
          <Link
            key={option.key}
            href={`/leaderboard?board=${option.key}`}
            className={`rounded-machined border px-3 py-1.5 text-[13px] transition-colors ${
              board === option.key
                ? "border-torch bg-torch/10 text-torch"
                : "border-steel-700 text-steel-400 hover:border-steel-500 hover:text-steel-200"
            }`}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <p className="mt-3 text-[12px] text-steel-600">{active.note}</p>

      {error ? (
        <p className="panel mt-6 px-6 py-8 text-[13px] text-steel-500">{error}</p>
      ) : rows.length === 0 ? (
        <p className="panel mt-6 px-6 py-8 text-[13px] text-steel-500">
          Nothing to rank yet.
        </p>
      ) : (
        <ol className="panel mt-6 divide-y divide-steel-800">
          {rows.map((row, index) => (
            <li
              key={String(row.owner ?? row.mint ?? index)}
              className="flex items-center gap-4 px-6 py-3.5"
            >
              <span className="num w-8 text-[13px] text-steel-600">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">{renderPrimary(board, row)}</div>
              <span className="num text-[15px] text-steel-50">
                {renderValue(board, row)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function renderPrimary(board: string, row: Record<string, string | number | null>) {
  if (board === "coins") {
    return (
      <Link
        href={`/coins/${String(row.mint)}`}
        className="text-[14px] text-steel-100 hover:text-torch"
      >
        {String(row.symbol ?? shortAddress(String(row.mint)))}
        <span className="ml-2 text-[12px] text-steel-600">
          {row.open_positions} lockers
        </span>
      </Link>
    );
  }
  if (board === "diamond") {
    return (
      <span className="text-[14px] text-steel-100">
        <span className="num">{shortAddress(String(row.owner))}</span>
        <span className="ml-2 text-[12px] text-steel-600">
          {String(row.symbol ?? "")} ·{" "}
          {formatMultiplier(Number(row.multiplier_bps ?? 10_000))}
        </span>
      </span>
    );
  }
  return (
    <span className="num text-[14px] text-steel-100">
      {shortAddress(String(row.owner))}
      <span className="ml-2 font-sans text-[12px] text-steel-600">
        {row.coins} coin{Number(row.coins) === 1 ? "" : "s"}
      </span>
    </span>
  );
}

function renderValue(board: string, row: Record<string, string | number | null>) {
  if (board === "coins") return `${formatSol(BigInt(String(row.lifetime_rewards ?? "0")))} SOL`;
  if (board === "diamond") {
    return `${Math.round(Number(row.term_secs ?? 0) / 86_400)}d`;
  }
  return `${formatSol(BigInt(String(row.earned ?? "0")))} SOL`;
}
