import { ImageResponse } from "next/og";
import { api, type ProofSummary } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { C, clean, CoinImage, Frame, GenericCard, loadFonts, loadImage, OG_SIZE, png, Stat } from "@/lib/og";

/**
 * The proof page's share card (its og:image): what IMAGINE has paid its
 * lockers, or with `?mint=` what one coin's lockers have been paid. Live
 * numbers, cached for five minutes; anything that goes wrong yields the
 * generic IMAGINE card so a shared link always unfurls.
 */

export const dynamic = "force-dynamic";

const FRESH_SECS = 300;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("mint");
  const mint = raw && MINT_RE.test(raw) ? raw : undefined;
  const fonts = await loadFonts();
  try {
    const summary = await api.proofSummary(mint);
    const coinImage = summary.coin ? await loadImage(summary.coin.imageUrl) : null;
    const body = await new ImageResponse(<ProofCard summary={summary} coinImage={coinImage} />, { ...OG_SIZE, fonts }).arrayBuffer();
    return png(body, `public, max-age=${FRESH_SECS}, s-maxage=${FRESH_SECS}, stale-while-revalidate=3600`);
  } catch (cause) {
    console.error(`proof card${mint ? ` for ${mint}` : ""} failed`, cause);
    const body = await new ImageResponse(<GenericCard />, { ...OG_SIZE, fonts }).arrayBuffer();
    return png(body, "public, max-age=60, s-maxage=60");
  }
}

function ProofCard({ summary, coinImage }: { summary: ProofSummary; coinImage: string | null }) {
  const coin = summary.coin;
  const symbol = coin ? clean(coin.symbol, 12) || `${coin.mint.slice(0, 4)}…${coin.mint.slice(-4)}` : null;
  const { totals } = summary;
  return (
    <Frame>
      <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
        {symbol ? <CoinImage src={coinImage} symbol={symbol} size={132} /> : null}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontWeight: 600, fontSize: 30, letterSpacing: "0.16em", color: C.steelHi }}>
            {symbol ? `PROOF · $${symbol}` : "PROOF"}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 8,
              fontFamily: "Sora",
              fontWeight: 800,
              fontSize: 76,
              lineHeight: 1.04,
              letterSpacing: "-0.045em",
              backgroundImage: C.dream,
              backgroundClip: "text",
              color: "transparent",
              paddingBottom: 6,
            }}
          >
            Every payout, on-chain.
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 20, marginTop: 44 }}>
        <Stat
          label="Paid out to lockers"
          value={formatUsd(totals.paidUsd)}
          sub={`${totals.payouts.toLocaleString("en-US")} payouts`}
          accent
          wide
        />
        <Stat label="Wallets paid" value={totals.walletsPaid.toLocaleString("en-US")} />
        <Stat label="Open locks" value={totals.openPositions.toLocaleString("en-US")} />
      </div>
    </Frame>
  );
}
