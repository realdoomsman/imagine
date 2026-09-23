import { formatPercent, formatSol, shortAddress } from "@vise/sdk";
import Link from "next/link";
import type { PoolSummary } from "@/lib/api";

export function CoinCard({ pool }: { pool: PoolSummary }) {
  const locked = pool.lockedFraction;
  const paid = BigInt(pool.lifetime_rewards);
  const clamped = Math.min(locked * 100, 100);

  return (
    <Link
      href={`/coins/${pool.mint}`}
      className="surface group relative block overflow-hidden p-5 transition-[border-color,transform] duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-steel-600/50"
    >
      {/* Heat rises from the clamp bar on hover — the card's only flourish. */}
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(70% 100% at 50% 100%, rgba(255,90,31,0.14), transparent 72%)",
        }}
      />

      <div className="relative flex items-start gap-3">
        {pool.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary IPFS hosts
          <img
            src={pool.image_url}
            alt=""
            className="size-11 shrink-0 rounded-machined border border-steel-700 object-cover"
            loading="lazy"
          />
        ) : (
          <div className="size-11 shrink-0 rounded-machined border border-steel-700 bg-steel-860" />
        )}

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[16px] font-semibold tracking-[-0.02em] text-steel-50">
            {pool.symbol ?? shortAddress(pool.mint)}
          </h3>
          <p className="truncate text-[12.5px] text-steel-500">
            {pool.name ?? "unnamed"}
          </p>
        </div>

        {pool.graduated ? (
          <span className="rule-label flex items-center gap-1.5 text-verdi">
            <span className="size-1.5 rounded-full bg-verdi" />
            LIVE
          </span>
        ) : pool.curve_progress !== null ? (
          <span className="num text-[11px] text-steel-500">
            {Math.round(pool.curve_progress * 100)}%
          </span>
        ) : null}
      </div>

      {/*
        Locked supply is the headline. It is the one number that says whether
        the people holding this coin actually believe in it, so it gets the
        large type and the only colour on the card.
      */}
      <div className="relative mt-6">
        <div className="flex items-end justify-between">
          <span className="rule-label">Supply clamped</span>
          <span className="num text-[26px] leading-none text-steel-50">
            {formatPercent(locked, 1)}
          </span>
        </div>
        <div className="mt-2.5 h-[7px] overflow-hidden rounded-[2px] bg-steel-990 shadow-[inset_0_1px_2px_rgba(0,0,0,0.9)]">
          <div
            className="knurl h-full transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              width: `${clamped}%`,
              background:
                "linear-gradient(90deg, var(--color-torch-dim), var(--color-torch))",
            }}
          />
        </div>
      </div>

      <dl className="relative mt-5 grid grid-cols-3 gap-3 border-t border-steel-780 pt-4 text-[12px]">
        <div>
          <dt className="text-steel-600">Paid out</dt>
          <dd className="num mt-1 text-[13px] text-steel-200">
            {formatSol(paid)} SOL
          </dd>
        </div>
        <div>
          <dt className="text-steel-600">Lockers</dt>
          <dd className="num mt-1 text-[13px] text-steel-200">
            {pool.open_positions}
          </dd>
        </div>
        <div>
          <dt className="text-steel-600">Yield</dt>
          <dd className="num mt-1 text-[13px] text-steel-200">
            {pool.apr === null ? "—" : formatPercent(pool.apr, 0)}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
