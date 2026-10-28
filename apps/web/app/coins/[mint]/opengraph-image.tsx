import { formatPercent, formatTokenAmount } from "@imagine/sdk";
import { ImageResponse } from "next/og";
import { api, type PoolDetail } from "@/lib/api";
import { formatQuote, formatUsd, quoteToUsd } from "@/lib/format";
import { C, clean, CoinImage, Frame, GenericCard, loadFonts, loadImage, OG_CONTENT_TYPE, OG_SIZE, PairPill, png, Stat } from "@/lib/og";

/**
 * The share card for a coin page (og:image; X falls back to it for
 * twitter:image): the coin, its pair, and what locking it has paid so far.
 * Rendered per request from the API with a 5-minute cache. Anything that
 * goes wrong (API down, unknown mint, an image Satori cannot decode) yields
 * the generic IMAGINE card instead of an error, so a shared link always
 * unfurls.
 */

export const alt = "A coin on IMAGINE: what share of its supply is locked and what its lockers have been paid";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
// Live numbers: render on request; freshness comes from the fetch cache and
// the Cache-Control set below.
export const dynamic = "force-dynamic";

const FRESH_SECS = 300;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function lockedFraction(detail: PoolDetail): number {
  const supply = detail.tokenSupply ? BigInt(detail.tokenSupply) : 0n;
  return supply > 0n ? Number(BigInt(detail.pool.totalLocked)) / Number(supply) : 0;
}

export default async function Image({ params }: { params: { mint: string } }) {
  const { mint } = params;
  const fonts = await loadFonts();

  let detail: PoolDetail | null = null;
  if (MINT_RE.test(mint)) {
    detail = await api.pool(mint, { cache: "force-cache", next: { revalidate: FRESH_SECS } }).catch(() => null);
  }

  if (detail) {
    try {
      const [coinImage, quoteLogo] = await Promise.all([
        loadImage(detail.metadata?.imageUrl),
        loadImage(detail.quote.logoUrl),
      ]);
      const body = await new ImageResponse(<CoinCard detail={detail} coinImage={coinImage} quoteLogo={quoteLogo} />, {
        ...size,
        fonts,
      }).arrayBuffer();
      return png(body, `public, max-age=${FRESH_SECS}, s-maxage=${FRESH_SECS}, stale-while-revalidate=3600`);
    } catch (cause) {
      console.error(`og card for ${mint} failed`, cause);
    }
  }

  // Unknown coin, API down, or a render failure: the IMAGINE card, briefly cached.
  try {
    const body = await new ImageResponse(<GenericCard />, { ...size, fonts }).arrayBuffer();
    return png(body, "public, max-age=60, s-maxage=60");
  } catch (cause) {
    console.error("og generic card failed", cause);
    const body = await new ImageResponse(<GenericCard />, size).arrayBuffer();
    return png(body, "public, max-age=60, s-maxage=60");
  }
}

function CoinCard({
  detail,
  coinImage,
  quoteLogo,
}: {
  detail: PoolDetail;
  coinImage: string | null;
  quoteLogo: string | null;
}) {
  const symbol = clean(detail.metadata?.symbol, 12) || `${detail.mint.slice(0, 4)}…${detail.mint.slice(-4)}`;
  const name = clean(detail.metadata?.name, 32) || symbol;
  const quote = detail.quote;
  const quoteSymbol = clean(quote.symbol, 12);
  const paid = formatQuote(detail.pool.lifetimeRewards, { decimals: quote.decimals, symbol: quoteSymbol });
  const paidUsd = quoteToUsd(detail.pool.lifetimeRewards, quote);
  const locks = detail.pool.openPositions;
  // Metaplex names run to 32 characters; step down so a full one still fits the 820px column.
  const nameSize = name.length <= 10 ? 84 : name.length <= 16 ? 68 : name.length <= 22 ? 54 : name.length <= 27 ? 46 : 40;

  return (
    <Frame>
      <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
        <CoinImage src={coinImage} symbol={symbol} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              fontFamily: "Geist Mono",
              fontWeight: 600,
              fontSize: 34,
              letterSpacing: "0.02em",
              color: C.steelHi,
            }}
          >
            ${symbol}
          </div>
          <div
            style={{
              display: "block",
              marginTop: 6,
              fontFamily: "Sora",
              fontWeight: 800,
              fontSize: nameSize,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              color: C.fg,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 820,
            }}
          >
            {name}
          </div>
          <div style={{ display: "flex", marginTop: 22 }}>
            <PairPill symbol={quoteSymbol} logo={quoteLogo} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, marginTop: 44 }}>
        <Stat
          label="Supply locked"
          value={formatPercent(lockedFraction(detail), 1)}
          sub={`${formatTokenAmount(BigInt(detail.pool.totalLocked), detail.tokenDecimals)} $${symbol}`}
        />
        <Stat
          label="Paid to lockers"
          value={paid}
          sub={paidUsd !== null ? `≈ ${formatUsd(paidUsd)}` : null}
          accent
          wide
        />
        <Stat label="Open locks" value={locks.toLocaleString("en-US")} />
      </div>
    </Frame>
  );
}

