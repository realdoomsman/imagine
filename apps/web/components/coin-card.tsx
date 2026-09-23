import { formatPercent, formatSol, shortAddress } from "@vise/sdk";
import Link from "next/link";
import type { PoolSummary } from "@/lib/api";

export function CoinCard({ pool }: { pool: PoolSummary }) {
  const locked = pool.lockedFraction;
  const paid = BigInt(pool.lifetime_rewards);

  return (
    <Link
      href={`/coins/${pool.mint}`}
      className="group relative block bg-steel-900 p-5 transition-colors hover:bg-steel-850"
    >
      <div className="flex items-start gap-3">
        {pool.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary IPFS hosts
          <img
            src={pool.image_url}
            alt=""
            className="size-11 shrink-0 rounded-machined border border-steel-700 object-cover"
            loading="lazy"
          />
        ) : (
          <div className="size-11 shrink-0 rounded-machined border border-steel-700 bg-steel-800" />
        )}

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-steel-50">
            {pool.symbol ?? shortAddress(pool.mint)}
          </h3>
          <p className="truncate text-[12px] text-steel-500">
            {pool.name ?? "unnamed"}
          </p>
        </div>

        {pool.graduated ? (
          <span className="rule-label text-verdi">LIVE</span>
        ) : pool.curve_progress !== null ? (
          <span className="num text-[11px] text-steel-500">
            {Math.round(pool.curve_progress * 100)}%
          </span>
        ) : null}
      </div>

      {/* Locked supply is the headline: it is the number that says whether the
          people holding this coin actually believe in it. */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="rule-label">Supply clamped</span>
          <span className="num text-[15px] text-steel-50">
            {formatPercent(locked, 1)}
          </span>
        </div>
        <div className="mt-1.5 h-2 border border-steel-700 bg-steel-950">
          <div
            className="knurl h-full bg-torch transition-[width] duration-500"
            style={{ width: `${Math.min(locked * 100, 100)}%` }}
          />
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
        <div>
          <dt className="text-steel-600">Paid out</dt>
          <dd className="num mt-0.5 text-steel-200">{formatSol(paid)} SOL</dd>
        </div>
        <div>
          <dt className="text-steel-600">Lockers</dt>
          <dd className="num mt-0.5 text-steel-200">{pool.open_positions}</dd>
        </div>
        <div>
          <dt className="text-steel-600">Yield</dt>
          <dd className="num mt-0.5 text-steel-200">
            {pool.apr === null ? "—" : formatPercent(pool.apr, 0)}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
