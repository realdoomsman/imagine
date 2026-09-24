import {
  formatDuration,
  formatMultiplier,
  formatPercent,
  formatSol,
  formatTokenAmount,
  shortAddress,
} from "@vise/sdk";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api, type PoolDetail } from "@/lib/api";
import { LockPanel } from "@/components/lock-panel";
import { SwapPanel } from "@/components/swap-panel";
import { LockerTable } from "@/components/locker-table";
import { RewardChart } from "@/components/reward-chart";
import { ShareButton } from "@/components/share-button";

export const dynamic = "force-dynamic";

/** Coin pages get shared; the card should carry the coin, not the site. */
export async function generateMetadata({ params }: { params: Promise<{ mint: string }> }): Promise<Metadata> {
  const { mint } = await params;
  let detail: PoolDetail;
  try {
    detail = await api.pool(mint);
  } catch {
    return { title: "Coin not found" };
  }
  const symbol = detail.metadata?.symbol ?? shortAddress(mint);
  const name = detail.metadata?.name ?? "a coin";
  const locked = formatPercent(
    detail.tokenSupply && BigInt(detail.tokenSupply) > 0n
      ? Number(BigInt(detail.pool.totalLocked)) / Number(BigInt(detail.tokenSupply))
      : 0,
    1,
  );
  const description = `${name}: ${locked} of supply clamped, ${formatSol(BigInt(detail.pool.lifetimeRewards))} SOL paid to lockers so far. Lock it and earn its fee stream.`;
  return {
    title: `${symbol} · ${name}`,
    description,
    openGraph: {
      title: `${symbol} on VISE`,
      description,
      ...(detail.metadata?.imageUrl ? { images: [{ url: detail.metadata.imageUrl, width: 512, height: 512 }] } : {}),
    },
    twitter: { card: detail.metadata?.imageUrl ? "summary" : "summary_large_image" },
  };
}

export default async function CoinPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;

  let detail: PoolDetail;
  try {
    detail = await api.pool(mint);
  } catch {
    notFound();
  }

  const [lockers, rewards] = await Promise.all([
    api.lockers(mint).catch(() => ({ lockers: [], totalWeight: "0" })),
    api.rewards(mint).catch(() => ({ buckets: [] })),
  ]);

  const { pool, metadata, curve } = detail;
  const supplyLocked = BigInt(pool.totalLocked);
  const decimals = detail.tokenDecimals;
  const tokenSupply = detail.tokenSupply ?? "0";
  const tiers = pool.terms.sizeTierBps
    .map((tier, index) => ({ tier, bonus: pool.terms.sizeBonusBps[index] }))
    .filter((entry) => entry.tier > 0);

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-14 sm:px-8">
      <header className="flex flex-wrap items-start gap-5">
        {metadata?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary IPFS hosts
          <img
            src={metadata.imageUrl}
            alt=""
            className="size-16 rounded-machined border border-steel-700 object-cover"
          />
        ) : (
          <div className="size-16 rounded-machined border border-steel-700 bg-steel-860" />
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-[30px] leading-none">
            {metadata?.symbol ?? shortAddress(mint)}
          </h1>
          <p className="mt-1.5 text-[14px] text-steel-500">
            {metadata?.name ?? "unnamed coin"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="num text-[11px] text-steel-600">{mint}</p>
            <ShareButton
              text={`${metadata?.symbol ?? "This coin"} has a vise on it: ${formatPercent(BigInt(tokenSupply) > 0n ? Number(supplyLocked) / Number(BigInt(tokenSupply)) : 0, 1)} of supply is locked and every trade pays the lockers.`}
              url={`https://vise.fun/coins/${mint}`}
              className="h-7 px-2.5 text-[11.5px]"
            />
          </div>
          {metadata?.description ? (
            <p className="mt-3 max-w-[64ch] text-[13.5px] leading-relaxed text-steel-400">{metadata.description}</p>
          ) : null}
          {metadata?.twitter || metadata?.telegram || metadata?.website ? (
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
              {metadata.website ? <Social href={metadata.website} label="Website" /> : null}
              {metadata.twitter ? <Social href={metadata.twitter} label="X" /> : null}
              {metadata.telegram ? <Social href={metadata.telegram} label="Telegram" /> : null}
            </p>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <Metric label="Clamped" value={formatTokenAmount(supplyLocked, decimals)} />
          <Metric
            label="Paid to lockers"
            value={`${formatSol(BigInt(pool.lifetimeRewards))} SOL`}
          />
          <Metric label="Lockers" value={String(pool.openPositions)} />
          <Metric
            label="Curve"
            value={
              curve?.complete
                ? "Graduated"
                : curve
                  ? formatPercent(curve.progress, 0)
                  : "—"
            }
          />
        </dl>
      </header>

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <RewardChart buckets={rewards.buckets} />

          <section className="panel p-6">
            <h2 className="text-[17px]">Terms, frozen at launch</h2>
            <p className="mt-2 text-[13px] text-steel-500">
              These were written onto the pool when it was created. No one can
              change them — not the creator, not VISE.
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-px border border-steel-700 bg-steel-700 sm:grid-cols-5">
              <Term
                label="To lockers"
                value={formatPercent(
                  ((10_000 - pool.terms.treasuryShareBps) / 10_000) *
                    ((10_000 - pool.terms.creatorShareBps) / 10_000),
                  0,
                )}
              />
              <Term
                label="To treasury"
                value={formatPercent(pool.terms.treasuryShareBps / 10_000, 0)}
              />
              <Term
                label="Max multiplier"
                value={formatMultiplier(pool.terms.maxMultiplierBps)}
              />
              <Term
                label="Fee release"
                value={formatDuration(pool.terms.rewardStreamSecs)}
              />
              <Term
                label="Early exit burn"
                value={formatPercent(pool.terms.earlyUnlockPenaltyBps / 10_000, 0)}
              />
            </dl>
            <p className="mt-4 text-[12px] leading-relaxed text-steel-600">
              Lock window {pool.terms.minLockSecs / 86_400}–
              {pool.terms.maxLockSecs / 86_400} days on a{" "}
              {pool.terms.durationCurve === 1 ? "square-root" : "linear"} curve.
              {tiers.length > 0 ? (
                <>
                  {" "}Size tiers:{" "}
                  {tiers.map((entry, index) => (
                    <span key={entry.tier} className="num">
                      {index > 0 ? ", " : ""}
                      ≥{entry.tier / 100}% of supply +{entry.bonus / 100}%
                    </span>
                  ))}
                  .
                </>
              ) : null}{" "}
              Creator{" "}
              <span className="num">{shortAddress(pool.creator)}</span>. Vault{" "}
              <span className="num">{shortAddress(pool.rewardVault)}</span>.
            </p>
          </section>

          <LockerTable
            lockers={lockers.lockers}
            totalWeight={lockers.totalWeight}
            decimals={decimals}
          />
        </div>

        <aside className="space-y-5">
          <SwapPanel
            mint={mint}
            symbol={metadata?.symbol ?? "coin"}
            priceLamports={curve?.priceLamports ?? 0}
            graduated={curve?.complete ?? false}
          />
          <LockPanel
            mint={mint}
            symbol={metadata?.symbol ?? "coin"}
            decimals={decimals}
            terms={pool.terms}
            totalWeight={pool.totalWeight}
            accRewardPerWeight={pool.accRewardPerWeight}
            supply={tokenSupply}
          />
        </aside>
      </div>
    </div>
  );
}

function Social({ href, label }: { href: string; label: string }) {
  let host: string;
  try {
    host = new URL(href).host.replace(/^www\./, "");
  } catch {
    return null;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer nofollow" className="text-steel-500 hover:text-torch">
      {label} <span className="num text-steel-600">{host}</span>
    </a>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="rule-label">{label}</dt>
      <dd className="num mt-1 text-[18px] text-steel-50">{value}</dd>
    </div>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-steel-900 px-4 py-3 last:col-span-2 sm:last:col-span-1">
      <dt className="rule-label">{label}</dt>
      <dd className="num mt-1 text-[17px] text-steel-50">{value}</dd>
    </div>
  );
}
