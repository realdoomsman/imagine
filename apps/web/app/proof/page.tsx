import { formatTokenAmount, IMAGINE_PROGRAM_ID, shortAddress } from "@imagine/sdk";
import type { Metadata } from "next";
import Link from "next/link";
import { api, type ProofFeedType, type ProofPage, type ProofSummary } from "@/lib/api";
import { explorerAccount, formatQuote, formatUsd } from "@/lib/format";
import { isPlatformTicker } from "@/lib/official";
import { pageMetadata } from "@/lib/seo";
import { ImagineMark } from "@/components/imagine-mark";
import { PairPill } from "@/components/pair-pill";
import { ProofCoinFilter } from "@/components/proof-coin-filter";
import { ProofFeed } from "@/components/proof-feed";

export const dynamic = "force-dynamic";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PROGRAM = IMAGINE_PROGRAM_ID.toBase58();
const GITHUB_URL = "https://github.com/realdoomsman/imagine";
const OTTERSEC_URL = `https://verify.osec.io/status/${PROGRAM}`;

const TYPES: Array<{ key: ProofFeedType; label: string }> = [
  { key: "payouts", label: "All payouts" },
  { key: "claims", label: "Claims" },
  { key: "compounds", label: "Compounds" },
  { key: "burns", label: "Burns" },
];

type Search = Promise<{ coin?: string; type?: string }>;

function readFilters(params: { coin?: string; type?: string }) {
  const mint = params.coin && MINT_RE.test(params.coin) ? params.coin : null;
  const type = TYPES.find((option) => option.key === params.type)?.key ?? "payouts";
  return { mint, type };
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const { mint } = readFilters(await searchParams);
  const symbol = mint ? ((await api.proofSummary(mint).catch(() => null))?.coin?.symbol ?? null) : null;
  const base = pageMetadata({
    path: mint ? `/proof?coin=${mint}` : "/proof",
    title: symbol ? `Proof · $${symbol} payouts` : "Proof",
    description: symbol
      ? `Every payout to $${symbol} lockers, read from on-chain events, each with the signature that proves it.`
      : "Every payout IMAGINE has made to lockers, read from on-chain events, each with the signature that proves it.",
  });
  const image = {
    url: `/proof/card${mint ? `?mint=${mint}` : ""}`,
    width: 1200,
    height: 630,
    alt: symbol ? `What $${symbol} lockers have been paid on IMAGINE` : "What IMAGINE has paid its lockers",
  };
  return { ...base, openGraph: { ...base.openGraph, images: [image] }, twitter: { ...base.twitter, images: [image.url] } };
}

export default async function ProofPageRoute({ searchParams }: { searchParams: Search }) {
  const { mint, type } = readFilters(await searchParams);

  let summary: ProofSummary | null = null;
  let feed: ProofPage | null = null;
  try {
    [summary, feed] = await Promise.all([api.proofSummary(mint ?? undefined), api.proofPayouts({ mint: mint ?? undefined, type })]);
  } catch (cause) {
    // The reason stays in the server log; visitors get a plain sentence.
    console.error("proof: load failed", cause);
  }
  const coin = summary?.coin ?? null;
  const ticker = coin ? `$${coin.symbol ?? shortAddress(coin.mint)}` : null;
  const filterHref = (next: ProofFeedType) => {
    const query = new URLSearchParams();
    if (mint) query.set("coin", mint);
    if (next !== "payouts") query.set("type", next);
    const search = query.toString();
    return search ? `/proof?${search}` : "/proof";
  };

  return (
    <div className="container-x max-w-[1100px] py-14 lg:py-20">
      <p className="eyebrow">Proof</p>
      <h1 className="t-h1 mt-4">
        Every payout, <span className="dream-text">on-chain.</span>
      </h1>
      <p className="t-lede mt-4">
        What the program has paid its lockers, payout by payout, each with the transaction that proves it. Nothing here
        is typed in by hand.
      </p>

      {coin ? (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {coin.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- coin images live on the API's file host
            <img src={coin.imageUrl} alt="" className="size-10 rounded-[10px] border border-line bg-ink-3 object-cover" />
          ) : null}
          <Link href={`/coins/${coin.mint}`} className="t-h3 hover:text-steel-hi">
            {ticker}
          </Link>
          <Link href={type === "payouts" ? "/proof" : `/proof?type=${type}`} className="pill hover:border-line-strong hover:text-fg">
            Show every coin
          </Link>
        </div>
      ) : null}

      {!summary || !feed ? (
        <div className="card mt-8 flex flex-col items-center gap-3 px-8 py-16 text-center">
          <ImagineMark size={40} className="opacity-40" />
          <h2 className="t-h3">The index isn&apos;t answering</h2>
          <p className="max-w-[52ch] text-[13.5px] text-muted">
            Every payout is on-chain either way; the program&apos;s history is on Solscan below. Try again in a moment.
          </p>
        </div>
      ) : (
        <>
          <dl className="mt-8 grid gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="Paid out to lockers"
              value={formatUsd(summary.totals.paidUsd)}
              sub={`${summary.totals.payouts.toLocaleString("en-US")} payouts · ${summary.totals.claims} claims, ${summary.totals.compounds} compounds`}
              accent
            />
            <Stat
              label="Wallets paid"
              value={summary.totals.walletsPaid.toLocaleString("en-US")}
              sub="distinct lockers that received a payout"
            />
            <Stat label="Fees into the pools" value={formatUsd(summary.totals.feesUsd)} sub="every fee that reached a lock pool" />
            <Stat
              label="Locked now"
              value={formatUsd(summary.totals.lockedUsd)}
              sub={
                coin
                  ? `${formatTokenAmount(BigInt(coin.lockedTokens), coin.decimals)} ${ticker} in ${summary.totals.openPositions} locks`
                  : `${summary.totals.openPositions.toLocaleString("en-US")} open locks, at each coin's last price`
              }
            />
            <Stat
              label="Burned by early exits"
              value={coin ? `${formatTokenAmount(BigInt(coin.burnedTokens), coin.decimals)} ${ticker}` : formatUsd(summary.totals.burnedUsd)}
              sub={`${summary.totals.earlyExits} early exit${summary.totals.earlyExits === 1 ? "" : "s"}${coin ? ` · ≈ ${formatUsd(summary.totals.burnedUsd)}` : ", valued at each coin's last price"}`}
            />
            <Stat
              label="Locked forever"
              value={summary.totals.lockedForever.toLocaleString("en-US")}
              sub="positions that can never be unlocked"
            />
          </dl>

          {summary.byQuote.length > 0 ? (
            <section className="card mt-6 overflow-hidden">
              <header className="px-6 py-4">
                <h2 className="t-h3">By pair asset</h2>
                <p className="mt-1 text-[12.5px] text-muted">
                  Lockers are paid in whatever their coin is paired with. USD at today&apos;s prices.
                </p>
              </header>
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Totals by pair asset, scrolls sideways">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead>
                    <tr className="hairline text-left">
                      <Th>Pair</Th>
                      <Th align="right">Paid out to lockers</Th>
                      <Th align="right">Claimed / compounded</Th>
                      <Th align="right">Fees into pools</Th>
                      <Th align="right">Locked now</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byQuote.map((row) => (
                      <tr key={row.quote.mint} className="border-t border-line">
                        <td className="px-6 py-2.5">
                          <PairPill quote={row.quote} label="" className="h-[22px] px-2 text-[11px]" />
                        </td>
                        <td className="num px-6 py-2.5 text-right text-mint">
                          {formatQuote(row.paid, row.quote)}
                          <span className="block text-[11px] text-muted">{formatUsd(row.paidUsd)}</span>
                        </td>
                        <td className="num px-6 py-2.5 text-right text-fg-soft">
                          {formatQuote(row.claimed, row.quote)}
                          <span className="block text-[11px] text-muted">{formatQuote(row.compounded, row.quote)}</span>
                        </td>
                        <td className="num px-6 py-2.5 text-right text-fg">
                          {formatQuote(row.fees, row.quote)}
                          <span className="block text-[11px] text-muted">{formatUsd(row.feesUsd)}</span>
                        </td>
                        <td className="num px-6 py-2.5 text-right text-fg">
                          {formatQuote(row.locked, row.quote)}
                          <span className="block text-[11px] text-muted">{formatUsd(row.lockedUsd)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="t-h3">Every payout</h2>
                <p className="mt-1 text-[12.5px] text-muted">Newest first, live. Burns are the coin early exits destroyed.</p>
              </div>
              <ProofCoinFilter coins={summary.coins.filter((entry) => !isPlatformTicker(entry.symbol))} selected={mint} type={type} />
            </div>
            <nav className="mt-4 flex flex-wrap gap-1.5" aria-label="Type">
              {TYPES.map((option) => (
                <Link
                  key={option.key}
                  href={filterHref(option.key)}
                  scroll={false}
                  aria-current={type === option.key ? "page" : undefined}
                  className={`pill transition-colors ${
                    type === option.key ? "border-transparent bg-steel text-ink" : "hover:border-line-strong hover:text-fg"
                  }`}
                >
                  {option.label}
                </Link>
              ))}
            </nav>
            <ProofFeed key={`${mint ?? "all"}-${type}`} initial={feed} mint={mint} type={type} />
          </section>
        </>
      )}

      <section className="card mt-10 p-6 sm:p-8">
        <h2 className="t-h3">Verify it yourself</h2>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-fg-soft">
          Every number here is read from on-chain events. Click any signature to check it on Solscan.
        </p>
        <dl className="mt-6 grid gap-x-8 gap-y-5 text-[13px] sm:grid-cols-2">
          <Fact label="Program">
            <a href={explorerAccount(PROGRAM)} target="_blank" rel="noreferrer" className="num break-all text-steel-hi hover:text-fg">
              {PROGRAM} ↗
            </a>
          </Fact>
          <Fact label="Verified build">
            <a href={OTTERSEC_URL} target="_blank" rel="noreferrer" className="text-steel-hi hover:text-fg">
              OtterSec verification status ↗
            </a>
            <span className="mt-1 block text-[12px] text-muted">
              OtterSec&apos;s record of whether the deployed program matches the public source.
            </span>
          </Fact>
          <Fact label="Source">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="text-steel-hi hover:text-fg">
              github.com/realdoomsman/imagine ↗
            </a>
          </Fact>
        </dl>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, accent = false }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="bg-ink-1 px-5 py-4">
      <dt className="eyebrow">{label}</dt>
      <dd className={`num mt-1.5 text-[24px] leading-tight ${accent ? "text-mint" : "text-fg"}`}>{value}</dd>
      <dd className="mt-1 text-[11.5px] leading-relaxed text-muted">{sub}</dd>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th scope="col" className={`px-6 py-2.5 font-normal ${align === "right" ? "text-right" : ""}`}>
      <span className="eyebrow">{children}</span>
    </th>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
  );
}
