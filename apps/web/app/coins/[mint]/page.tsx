import { formatDuration, formatMultiplier, formatPercent, formatTokenAmount, shortAddress } from "@imagine/sdk";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError, type PoolDetail, type RewardHistory } from "@/lib/api";
import { loadFees } from "@/lib/fees";
import { explorerAccount, FOREVER_TOOLTIP, formatBps, formatPrice, formatQuote, formatUsd, quoteToUsd } from "@/lib/format";
import { SITE_NAME, SITE_URL } from "@/lib/seo";
import { X_HANDLE } from "@/components/site-header-links";
import { CopyButton } from "@/components/copy-button";
import { ImagineMark } from "@/components/imagine-mark";
import { LockPanel } from "@/components/lock-panel";
import { LockerTable } from "@/components/locker-table";
import { PairPill } from "@/components/pair-pill";
import { RewardChart } from "@/components/reward-chart";
import { coinShare, ShareButton } from "@/components/share-button";
import { SwapPanel } from "@/components/swap-panel";

export const dynamic = "force-dynamic";

function lockedFraction(detail: PoolDetail): number {
  const supply = detail.tokenSupply ? BigInt(detail.tokenSupply) : 0n;
  return supply > 0n ? Number(BigInt(detail.pool.totalLocked)) / Number(supply) : 0;
}

/** Coin pages get shared; the card should carry the coin, not the site. */
export async function generateMetadata({ params }: { params: Promise<{ mint: string }> }): Promise<Metadata> {
  const { mint } = await params;
  let detail: PoolDetail;
  try {
    detail = await api.pool(mint);
  } catch {
    return { title: "Coin" };
  }
  const symbol = detail.metadata?.symbol ?? shortAddress(mint);
  const name = detail.metadata?.name ?? symbol;
  const description = `${name} launched on Raydium, paired with ${detail.quote.symbol}. ${formatPercent(lockedFraction(detail), 1)} of supply locked, ${formatQuote(detail.pool.lifetimeRewards, detail.quote)} earned by lockers so far. Lock it, earn ${detail.quote.symbol}.`;
  const url = `${SITE_URL}/coins/${mint}`;
  return {
    title: `$${symbol} · ${name}`,
    description,
    alternates: { canonical: url },
    // The card image is this route's opengraph-image, drawn from the coin.
    openGraph: { title: `$${symbol} on Imagine`, description, url, siteName: SITE_NAME, type: "website" },
    twitter: {
      card: "summary_large_image",
      title: `$${symbol} on Imagine`,
      description,
      ...(X_HANDLE ? { site: X_HANDLE, creator: X_HANDLE } : {}),
    },
  };
}

export default async function CoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ mint: string }>;
  /** `launched=1&pct=&term=` when the launch form sends its creator here. */
  searchParams: Promise<{ launched?: string; pct?: string; term?: string }>;
}) {
  const { mint } = await params;
  const launched = await searchParams;

  let detail: PoolDetail;
  try {
    detail = await api.pool(mint);
  } catch (cause) {
    if (cause instanceof ApiError && (cause.status === 404 || cause.status === 400)) notFound();
    return <Unavailable mint={mint} reason={cause instanceof Error ? cause.message : "unknown error"} />;
  }

  const emptyHistory: RewardHistory = {
    since: Math.floor(Date.now() / 1000) - 21_600,
    bucketSecs: 900,
    createdAt: null,
    buckets: [],
  };
  const [lockers, rewards, fees] = await Promise.all([
    api.lockers(mint).catch(() => null),
    api.rewards(mint).catch(() => emptyHistory),
    loadFees(),
  ]);

  const { pool, metadata, curve, rewardRate, quote, links } = detail;
  const decimals = detail.tokenDecimals;
  const tokenSupply = detail.tokenSupply ?? "0";
  const symbol = metadata?.symbol ?? shortAddress(mint);
  const name = metadata?.name ?? symbol;
  const share = coinShare(mint, name, quote.symbol);
  const priceQuote = curve?.priceQuote ?? null;
  const priceUsd = curve?.priceUsd ?? (priceQuote !== null && quote.usdPrice !== null ? priceQuote * quote.usdPrice : null);
  const marketCapQuote = detail.marketCapQuote;
  const marketCapUsd = detail.marketCapUsd;
  const paidUsd = quoteToUsd(pool.lifetimeRewards, quote);
  const now = Math.floor(Date.now() / 1000);
  const streaming = BigInt(pool.undistributed) > 0n && pool.streamEnd > now;
  const tiers = pool.terms.sizeTierBps
    .map((tier, index) => ({ tier, bonus: pool.terms.sizeBonusBps[index] }))
    .filter((entry) => entry.tier > 0);
  const lockersShare =
    ((10_000 - pool.terms.treasuryShareBps) / 10_000) * ((10_000 - pool.terms.creatorShareBps) / 10_000);
  const foreverLocks = lockers?.lockers.filter((locker) => locker.forever) ?? [];
  const foreverAmount = foreverLocks.reduce((sum, locker) => sum + BigInt(locker.amount), 0n);

  return (
    <div className="container-x py-10 lg:py-14">
      {launched.launched === "1" ? (
        <section className="card card-dream mb-8 flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="t-h3">Launched on Raydium. Your lock is in.</h2>
            <p className="mt-1 text-[13.5px] text-fg-soft">
              {launched.pct && launched.term
                ? `You locked ${launched.pct}% of your first buy for ${launched.term}. `
                : ""}
              Every trade now pays this pool in {quote.symbol}: {formatBps(fees.poolFeeBps)} on-chain wherever it
              trades, {formatBps(fees.poolFeeBps + fees.tradeFeeBps)} through Imagine.
            </p>
          </div>
          <ShareButton text={share.text} url={share.url} label="Tell X" />
        </section>
      ) : null}

      <header className="flex flex-col gap-6">
        <div className="flex min-w-0 flex-1 items-start gap-4 sm:gap-5">
          {metadata?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- coin images live on the API's file host
            <img
              src={metadata.imageUrl}
              alt=""
              className="size-16 shrink-0 rounded-[14px] border border-line bg-ink-3 object-cover sm:size-20"
            />
          ) : (
            <div className="flex size-16 shrink-0 items-center justify-center rounded-[14px] border border-line bg-ink-3 text-[24px] font-extrabold text-muted sm:size-20">
              {symbol.slice(0, 1)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="t-h2 break-words">{name}</h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="num text-[15px] text-fg-soft">${symbol}</span>
              <PairPill quote={quote} />
              <StatusPill status={curve?.status ?? null} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="num max-w-full truncate text-[11.5px] text-muted">{mint}</code>
              <CopyButton value={mint} label="Copy CA" className="h-7 px-2.5 text-[11.5px]" />
            </div>
            {metadata?.description ? (
              <p className="mt-3 max-w-[64ch] break-words text-[14px] leading-relaxed text-fg-soft">
                {metadata.description}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <a href={links.raydium} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
                Raydium ↗
              </a>
              {links.raydiumSwap ? (
                <a href={links.raydiumSwap} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                  Raydium swap ↗
                </a>
              ) : null}
              {metadata?.website ? <Social href={metadata.website} label="Website" /> : null}
              {metadata?.twitter ? <Social href={metadata.twitter} label="X" /> : null}
              {metadata?.telegram ? <Social href={metadata.telegram} label="Telegram" /> : null}
              <ShareButton text={share.text} url={share.url} label="Share" />
              <CopyButton value={share.url} label="Copy link" />
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-4">
          <Metric
            label="Price"
            value={priceUsd !== null ? formatUsdPrice(priceUsd) : formatPrice(priceQuote, quote.symbol)}
            sub={priceUsd !== null ? formatPrice(priceQuote, quote.symbol) : null}
          />
          <Metric
            label="Market cap"
            value={
              marketCapUsd !== null
                ? formatUsd(marketCapUsd)
                : marketCapQuote !== null
                  ? formatQuote(marketCapQuote, quote)
                  : "—"
            }
            sub={marketCapUsd !== null && marketCapQuote !== null ? formatQuote(marketCapQuote, quote) : null}
          />
          <Metric
            label="Supply locked"
            value={formatPercent(lockedFraction(detail), 1)}
            sub={`${formatTokenAmount(BigInt(pool.totalLocked), decimals)} · ${pool.openPositions} lock${pool.openPositions === 1 ? "" : "s"}`}
          />
          <Metric
            label="Earned by lockers"
            value={formatQuote(pool.lifetimeRewards, quote)}
            sub={paidUsd !== null ? `≈ ${formatUsd(paidUsd)}` : null}
            accent
          />
        </dl>
        {foreverLocks.length > 0 ? (
          <section className="card flex flex-wrap items-center gap-3 px-5 py-4" title={FOREVER_TOOLTIP}>
            <span className="pill pill-steel h-[22px] px-2.5 text-[11px]">Locked forever</span>
            <p className="min-w-0 flex-1 text-[13px] text-fg-soft">
              {formatTokenAmount(foreverAmount, decimals)} ${symbol}
              {BigInt(tokenSupply) > 0n
                ? ` (${formatPercent(Number((foreverAmount * 1_000_000n) / BigInt(tokenSupply)) / 1_000_000, 1)} of supply)`
                : ""}{" "}
              can never be unlocked or withdrawn; its earnings go to the other lockers.
            </p>
            <span className="flex flex-wrap gap-2 text-[12px]">
              {foreverLocks.map((locker) => (
                <a
                  key={locker.address}
                  href={explorerAccount(locker.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-steel-hi hover:text-fg"
                >
                  On-chain proof · {shortAddress(locker.owner)} ↗
                </a>
              ))}
            </span>
          </section>
        ) : null}
      </header>

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-5">
          {curve ? <CurveCard detail={detail} /> : null}

          <RewardChart history={rewards} quote={quote} />

          <section className="card p-6">
            <h2 className="t-h3">The stream runs on this coin&apos;s volume</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-fg-soft">
              Every trade of ${symbol}, wherever it happens, pays a {formatBps(fees.poolFeeBps)} on-chain trading fee
              that Raydium LaunchLab sends to this pool; trades through Imagine add {formatBps(fees.tradeFeeBps)}, so{" "}
              {formatBps(fees.poolFeeBps + fees.tradeFeeBps)} in all. The creator earns nothing from fees. What lockers
              earn rises and falls with how much ${symbol} trades — realised over the last 24 hours, not projected.
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-4">
              <Term label="Fees, 24h" value={formatQuote(rewardRate.feesPerDay, quote)} />
              <Term label="To lockers, 24h" value={formatQuote(rewardRate.lockersPerDay, quote)} accent />
              <Term label="Earned by lockers, all time" value={formatQuote(pool.lifetimeRewards, quote)} accent />
              <Term
                label="On its way to lockers"
                value={formatQuote((BigInt(rewardRate.uncollected) + BigInt(rewardRate.unsynced)).toString(), quote)}
              />
            </dl>
            <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
              {streaming
                ? `${formatQuote(pool.undistributed, quote)} is streaming to lockers over the next ${formatDuration(pool.streamEnd - now)}. `
                : "Nothing is streaming right now; the next fee starts a new stream. "}
              Fees from trades are collected into the pool automatically every few minutes and then streamed the same
              way.{" "}
              {rewardRate.trades > 0
                ? `${rewardRate.trades} trade${rewardRate.trades === 1 ? "" : "s"} (${formatQuote(rewardRate.siteVolume, quote)}) went through Imagine in this window.`
                : null}
            </p>
          </section>

          <section className="card p-6">
            <h2 className="t-h3">Terms, frozen at launch</h2>
            <p className="mt-2 text-[13.5px] text-fg-soft">
              Written onto the pool when it opened. Nobody can change them — not the creator, not Imagine. Claims and
              unlocks can&apos;t be paused.
            </p>
            {/* Five terms: on two columns the last one spans both, rather than leaving a blank cell. */}
            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
              <Term label="To lockers" value={formatPercent(lockersShare, 0)} accent />
              <Term label="To treasury" value={formatPercent(pool.terms.treasuryShareBps / 10_000, 0)} />
              <Term label="Max multiplier" value={formatMultiplier(pool.terms.maxMultiplierBps)} />
              <Term label="Stream window" value={formatDuration(pool.terms.rewardStreamSecs)} />
              <Term label="Early exit burn" value={formatPercent(pool.terms.earlyUnlockPenaltyBps / 10_000, 0)} />
            </dl>
            <p className="mt-4 break-words text-[12.5px] leading-relaxed text-muted">
              Lock window {formatDuration(pool.terms.minLockSecs)}–{formatDuration(pool.terms.maxLockSecs)} on a{" "}
              {pool.terms.durationCurve === 1 ? "square-root" : "linear"} curve.
              {tiers.length > 0 ? (
                <>
                  {" "}Size tiers:{" "}
                  {tiers.map((entry, index) => (
                    <span key={entry.tier} className="num">
                      {index > 0 ? ", " : ""}≥{entry.tier / 100}% of supply +{entry.bonus / 100}%
                    </span>
                  ))}
                  .
                </>
              ) : null}{" "}
              Rewards are paid in {quote.symbol}. Creator <span className="num">{shortAddress(pool.creator)}</span>,
              vault <span className="num">{shortAddress(pool.rewardVault)}</span>
              {pool.rewardTokenAccount ? (
                <>
                  , {quote.symbol} account <span className="num">{shortAddress(pool.rewardTokenAccount)}</span>
                </>
              ) : null}
              .
            </p>
          </section>

          {lockers ? (
            <LockerTable lockers={lockers.lockers} totalWeight={lockers.totalWeight} decimals={decimals} quote={quote} />
          ) : (
            <section className="card p-6">
              <h2 className="t-h3">Who&apos;s locked in</h2>
              <p className="mt-3 text-[13.5px] text-muted">The lockers list couldn&apos;t be loaded. Refresh to try again.</p>
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-5 lg:sticky lg:top-24 lg:self-start">
          <SwapPanel
            mint={mint}
            symbol={symbol}
            coinDecimals={decimals}
            coinTokenProgram={pool.tokenProgram}
            quote={quote}
            priceQuote={priceQuote}
            tradeFeeBps={fees.tradeFeeBps}
            poolFeeBps={fees.poolFeeBps}
            migrating={curve?.status === "migrating"}
            raydiumUrl={links.raydium}
          />
          <LockPanel
            mint={mint}
            symbol={symbol}
            decimals={decimals}
            tokenProgram={pool.tokenProgram}
            quote={quote}
            terms={pool.terms}
            totalWeight={pool.totalWeight}
            supply={tokenSupply}
            lockersPerDay={rewardRate.lockersPerDay}
            priceQuote={priceQuote}
          />
        </aside>
      </div>
    </div>
  );
}

/** USD per coin: memes trade far below a cent, so keep significant digits. */
function formatUsdPrice(value: number): string {
  return value >= 1 ? formatUsd(value) : `$${value.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;
}

function StatusPill({ status }: { status: "curve" | "migrating" | "graduated" | null }) {
  if (status === "graduated") return <span className="pill pill-up">On Raydium</span>;
  if (status === "migrating") return <span className="pill pill-steel">Migrating</span>;
  if (status === "curve") return <span className="pill">Bonding curve</span>;
  return null;
}

/** Where the coin is on its LaunchLab curve, in the pair asset. */
function CurveCard({ detail }: { detail: PoolDetail }) {
  const curve = detail.curve!;
  const progress = Math.min(Math.max(curve.progress, 0), 1);
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="t-h3">
          {curve.status === "graduated"
            ? "Graduated to Raydium"
            : curve.status === "migrating"
              ? "Migrating to Raydium"
              : "Bonding curve"}
        </h2>
        <span className="num text-[13px] text-fg-soft">{formatPercent(progress, 1)}</span>
      </div>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-ink-4" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: "var(--dream)" }} />
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
        {curve.status === "graduated" ? (
          <>The curve filled and the coin trades on a Raydium pool. Its Imagine pool keeps earning the same way.</>
        ) : (
          <>
            <span className="num text-fg-soft">{formatQuote(curve.realQuote, detail.quote)}</span> raised of{" "}
            <span className="num text-fg-soft">{formatQuote(curve.fundRaising, detail.quote)}</span>. When the curve
            fills, the coin migrates to Raydium and keeps trading there.
          </>
        )}
      </p>
    </section>
  );
}

function Unavailable({ mint, reason }: { mint: string; reason: string }) {
  return (
    <div className="container-x py-16 lg:py-24">
      <div className="card mx-auto flex max-w-[640px] flex-col items-center gap-4 px-8 py-16 text-center">
        <ImagineMark size={44} className="opacity-40" />
        <h1 className="t-h3">This coin can&apos;t be loaded right now</h1>
        <p className="max-w-[48ch] text-[14px] leading-relaxed text-muted">
          The Imagine indexer isn&apos;t answering, so there&apos;s nothing reliable to show. Your locks are on chain
          and unaffected.
        </p>
        <code className="num max-w-full break-all text-[11.5px] text-muted">{mint}</code>
        <p className="max-w-full break-words text-[11.5px] text-muted">{reason}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link href={`/coins/${mint}`} className="btn btn-primary btn-sm">
            Try again
          </Link>
          <Link href="/coins" className="btn btn-ghost btn-sm">
            All coins
          </Link>
        </div>
      </div>
    </div>
  );
}

function Social({ href, label }: { href: string; label: string }) {
  try {
    if (!/^https?:$/.test(new URL(href).protocol)) return null;
  } catch {
    return null;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer nofollow" className="btn btn-ghost btn-sm">
      {label} ↗
    </a>
  );
}

function Metric({ label, value, sub, accent = false }: { label: string; value: string; sub: string | null; accent?: boolean }) {
  return (
    <div className="min-w-0 bg-ink-2 px-4 py-3.5">
      <dt className="eyebrow">{label}</dt>
      <dd className={`num mt-1.5 truncate text-[17px] leading-tight ${accent ? "text-mint" : "text-fg"}`} title={value}>
        {value}
      </dd>
      {sub ? <dd className="num mt-1 truncate text-[11.5px] text-muted">{sub}</dd> : null}
    </div>
  );
}

function Term({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 bg-ink-1 px-4 py-3">
      <dt className="eyebrow">{label}</dt>
      <dd className={`num mt-1 truncate text-[15px] ${accent ? "text-mint" : "text-fg"}`} title={value}>
        {value}
      </dd>
    </div>
  );
}
