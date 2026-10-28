import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatPercent, formatTokenAmount } from "@imagine/sdk";
import { ImageResponse } from "next/og";
import { api, type PoolDetail } from "@/lib/api";
import { formatQuote, formatUsd, quoteToUsd } from "@/lib/format";

/**
 * The share card for a coin page (og:image; X falls back to it for
 * twitter:image): the coin, its pair, and what locking it has paid so far.
 * Rendered per request from the API with a 5-minute cache. Anything that
 * goes wrong (API down, unknown mint, an image Satori cannot decode) yields
 * the generic IMAGINE card instead of an error, so a shared link always
 * unfurls.
 */

export const alt = "A coin on IMAGINE: what share of its supply is locked and what its lockers have been paid";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Live numbers: render on request; freshness comes from the fetch cache and
// the Cache-Control set below.
export const dynamic = "force-dynamic";

const FRESH_SECS = 300;
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const C = {
  ink: "#071013",
  ink2: "#102127",
  ink3: "#18262A",
  line: "#20363D",
  lineStrong: "#2F4F58",
  fg: "#F3F8F8",
  fgSoft: "#A4C5CF",
  muted: "#768A93",
  steelHi: "#8CC8DC",
  mint: "#5EE9B5",
  dream: "linear-gradient(120deg, #8CC8DC 0%, #5EE9B5 55%, #C7F9E5 100%)",
};

type Font = { name: string; data: Buffer; weight: 400 | 600 | 800 | 500; style: "normal" };

let fontsPromise: Promise<Font[]> | null = null;

/** Sora and Geist Mono as static TTFs (Satori reads TTF/OTF/WOFF, not WOFF2). Empty on failure: Satori's built-in face still renders. */
function loadFonts(): Promise<Font[]> {
  fontsPromise ??= (async () => {
    const dir = join(process.cwd(), "assets", "fonts");
    const faces = [
      ["Sora", "Sora-400.ttf", 400],
      ["Sora", "Sora-600.ttf", 600],
      ["Sora", "Sora-800.ttf", 800],
      ["Geist Mono", "GeistMono-500.ttf", 500],
      ["Geist Mono", "GeistMono-600.ttf", 600],
    ] as const;
    return Promise.all(
      faces.map(async ([name, file, weight]) => ({
        name,
        data: await readFile(join(dir, file)),
        weight,
        style: "normal" as const,
      })),
    );
  })().catch((cause) => {
    console.error("og fonts unavailable", cause);
    fontsPromise = null;
    return [];
  });
  return fontsPromise;
}

/**
 * A remote image as a data URI Satori can draw, or null. Only the API's own
 * file host or a public https host, a bounded size, and only formats the
 * renderer decodes (PNG, JPEG, GIF): anything else falls back to a monogram.
 */
async function loadImage(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const apiOrigin = new URL(API_BASE).origin;
  const publicHttps =
    parsed.protocol === "https:" &&
    parsed.hostname !== "localhost" &&
    !/^[\d.]+$/.test(parsed.hostname) &&
    !parsed.hostname.includes(":");
  if (parsed.origin !== apiOrigin && !publicHttps) return null;
  try {
    const response = await fetch(parsed, { cache: "no-store", signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return null;
    if (Number(response.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    const type = sniffImage(bytes);
    return type ? `data:${type};base64,${Buffer.from(bytes).toString("base64")}` : null;
  } catch {
    return null;
  }
}

function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  return null;
}

/** Creator-chosen text: no control characters, bounded length. */
function clean(text: string | null | undefined, max: number): string {
  const plain = (text ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

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

function png(body: ArrayBuffer, cacheControl: string): Response {
  return new Response(body, { headers: { "Content-Type": contentType, "Cache-Control": cacheControl } });
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

function GenericCard() {
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
        <div
          style={{
            display: "flex",
            fontFamily: "Sora",
            fontWeight: 800,
            fontSize: 104,
            lineHeight: 0.98,
            letterSpacing: "-0.045em",
            color: C.fg,
          }}
        >
          Imagine
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "Sora",
            fontWeight: 800,
            fontSize: 104,
            lineHeight: 1.08,
            letterSpacing: "-0.045em",
            backgroundImage: C.dream,
            backgroundClip: "text",
            color: "transparent",
            paddingBottom: 8,
          }}
        >
          everyone locks.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 30,
            maxWidth: 820,
            fontFamily: "Sora",
            fontWeight: 400,
            fontSize: 30,
            lineHeight: 1.4,
            color: C.fgSoft,
          }}
        >
          Lock the meme. Earn its pair. Every trade pays the holders who lock, in whatever the coin is paired with.
        </div>
      </div>
    </Frame>
  );
}

/** Background, padding and the IMAGINE footer shared by both cards. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "60px 72px 52px",
        backgroundColor: C.ink,
        backgroundImage:
          "radial-gradient(circle at 88% 0%, rgba(94,233,181,0.16), rgba(7,16,19,0) 46%), radial-gradient(circle at 0% 100%, rgba(140,200,220,0.10), rgba(7,16,19,0) 42%)",
        fontFamily: "Sora",
        color: C.fg,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Mark size={46} />
          <div style={{ display: "flex", fontFamily: "Sora", fontWeight: 800, fontSize: 34, letterSpacing: "-0.02em" }}>
            IMAGINE
          </div>
        </div>
        <div style={{ display: "flex", fontFamily: "Geist Mono", fontWeight: 500, fontSize: 28, color: C.steelHi }}>
          imagine.fun
        </div>
      </div>
    </div>
  );
}

/** The mark: shares its geometry with components/imagine-mark.tsx and app/icon.svg. */
function Mark({ size: px }: { size: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 32 32">
      <defs>
        <linearGradient id="dream" x1="0" y1="0" x2="1" y2="0.58" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#8CC8DC" />
          <stop offset="0.55" stopColor="#5EE9B5" />
          <stop offset="1" stopColor="#C7F9E5" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#dream)" />
      <rect x="13" y="13" width="6" height="12" rx="3" fill="#071013" />
      <circle cx="16" cy="8.5" r="3.2" fill="#071013" />
    </svg>
  );
}

function CoinImage({ src, symbol }: { src: string | null; symbol: string }) {
  const box = {
    width: 208,
    height: 208,
    borderRadius: 36,
    border: `2px solid ${C.lineStrong}`,
    flexShrink: 0,
  } as const;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img>
    return <img src={src} alt="" width={208} height={208} style={{ ...box, objectFit: "cover" }} />;
  }
  return (
    <div
      style={{
        ...box,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: C.ink3,
        fontFamily: "Sora",
        fontWeight: 800,
        fontSize: 96,
        color: C.steelHi,
      }}
    >
      {symbol.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** "Paired with ● SOL", as `.pill-pair` on the site. */
function PairPill({ symbol, logo }: { symbol: string; logo: string | null }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 22px 10px 20px",
        borderRadius: 999,
        backgroundColor: C.ink3,
        border: `1.5px solid ${C.line}`,
      }}
    >
      <div style={{ display: "flex", fontFamily: "Sora", fontWeight: 600, fontSize: 24, color: C.fgSoft }}>
        Paired with
      </div>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img>
        <img src={logo} alt="" width={28} height={28} style={{ width: 28, height: 28, borderRadius: 999 }} />
      ) : (
        <div style={{ display: "flex", width: 12, height: 12, borderRadius: 999, backgroundColor: C.mint }} />
      )}
      <div style={{ display: "flex", fontFamily: "Geist Mono", fontWeight: 600, fontSize: 26, color: C.fg }}>
        {symbol}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub = null,
  accent = false,
  wide = false,
}: {
  label: string;
  value: string;
  sub?: string | null;
  accent?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: wide ? 1.6 : 1,
        flexBasis: 0,
        minWidth: 0,
        padding: "20px 26px 22px",
        borderRadius: 18,
        backgroundColor: C.ink2,
        border: `1.5px solid ${accent ? C.lineStrong : C.line}`,
      }}
    >
      <div
        style={{
          display: "flex",
          fontFamily: "Geist Mono",
          fontWeight: 500,
          fontSize: 17,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: C.muted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "block",
          marginTop: 10,
          fontFamily: "Geist Mono",
          fontWeight: 600,
          fontSize: value.length > 14 ? 34 : 40,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          color: accent ? C.mint : C.fg,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
      {sub ? (
        <div
          style={{
            display: "block",
            marginTop: 6,
            fontFamily: "Geist Mono",
            fontWeight: 500,
            fontSize: 22,
            color: C.fgSoft,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}
