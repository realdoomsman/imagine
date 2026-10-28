import { formatPercent, formatTokenAmount, shortAddress } from "@imagine/sdk";
import Link from "next/link";
import type { PoolSummary } from "@/lib/api";
import { formatQuote, formatUsd, quoteToUsd } from "@/lib/format";
import { IMAGINE_MINT } from "@/lib/official";
import { PairPill } from "./pair-pill";

/**
 * One coin in the grid, laid out the way launchpads list them — image, name,
 * ticker, the pair it trades against, market cap — with the IMAGINE number on
 * top: how much of the supply is locked, and what the lockers have been paid.
 */
export function CoinCard({ pool }: { pool: PoolSummary }) {
  const locked = Math.min(Math.max(pool.lockedFraction, 0), 1);
  const paidUsd = quoteToUsd(pool.lifetime_rewards, pool.quote);
  const marketCap =
    pool.market_cap_usd !== null
      ? formatUsd(pool.market_cap_usd)
      : pool.market_cap_quote !== null
        ? formatQuote(pool.market_cap_quote, pool.quote)
        : "—";

  return (
    <Link href={`/coins/${pool.mint}`} className="card group block p-4 sm:p-5">
      <div className="flex items-start gap-3.5">
        {pool.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- coin images live on the API's file host
          <img
            src={pool.image_url}
            alt=""
            className="size-14 shrink-0 rounded-[10px] border border-line bg-ink-3 object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-[10px] border border-line bg-ink-3 text-[18px] font-extrabold text-muted">
            {(pool.symbol ?? "?").slice(0, 1)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[16px] font-bold tracking-[-0.02em] text-fg">
              {pool.name ?? shortAddress(pool.mint)}
            </h3>
            {pool.mint === IMAGINE_MINT ? <span className="pill pill-steel h-[20px] px-2 text-[10.5px]">Official</span> : null}
          </div>
          <p className="num mt-0.5 truncate text-[12.5px] text-muted">${pool.symbol ?? shortAddress(pool.mint)}</p>
          <PairPill quote={pool.quote} className="mt-2" />
        </div>

        <CurveBadge pool={pool} />
      </div>

      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Market cap</p>
          <p className="num mt-1 text-[19px] leading-none text-fg">{marketCap}</p>
        </div>
        <div className="text-right">
          <p className="eyebrow">Supply locked</p>
          <p className="num mt-1 text-[19px] leading-none text-fg">{formatPercent(locked, 1)}</p>
        </div>
      </div>
      <div className="mt-2.5 h-[6px] overflow-hidden rounded-full bg-ink-4" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${locked * 100}%`, background: "var(--dream)" }} />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3.5 text-[12px]">
        <div className="min-w-0">
          <dt className="truncate text-muted">Earned</dt>
          <dd className="num mt-1 truncate text-[13px] text-mint" title={formatQuote(pool.lifetime_rewards, pool.quote)}>
            {paidUsd !== null ? formatUsd(paidUsd) : formatQuote(pool.lifetime_rewards, pool.quote)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Lockers</dt>
          <dd className="num mt-1 text-[13px] text-fg">{pool.open_positions}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-muted">{pool.apr !== null ? "Yield" : "Locked"}</dt>
          <dd className="num mt-1 truncate text-[13px] text-fg">
            {pool.apr !== null
              ? formatPercent(pool.apr, 0)
              : formatTokenAmount(BigInt(pool.total_locked), pool.token_decimals)}
          </dd>
        </div>
      </dl>
    </Link>
  );
}

function CurveBadge({ pool }: { pool: PoolSummary }) {
  if (pool.graduated) {
    return <span className="pill pill-up h-[22px] shrink-0 px-2 text-[10.5px]">Raydium</span>;
  }
  if (pool.curve_progress === null) return null;
  return (
    <span className="num shrink-0 text-[11px] text-muted" title="Bonding curve progress toward migration">
      {Math.round(pool.curve_progress * 100)}%
    </span>
  );
}
