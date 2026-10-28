import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Shared pieces of the share cards (og:image) rendered with `next/og`: the
 * palette, fonts, safe remote images, and the frame, mark and stat tiles every
 * card is built from.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const C = {
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
export function loadFonts(): Promise<Font[]> {
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
export async function loadImage(url: string | null | undefined): Promise<string | null> {
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
export function clean(text: string | null | undefined, max: number): string {
  const plain = (text ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

export function png(body: ArrayBuffer, cacheControl: string): Response {
  return new Response(body, { headers: { "Content-Type": OG_CONTENT_TYPE, "Cache-Control": cacheControl } });
}

export function GenericCard() {
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

/** Background, padding and the IMAGINE footer shared by every card. */
export function Frame({ children }: { children: React.ReactNode }) {
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

export function CoinImage({ src, symbol, size = 208 }: { src: string | null; symbol: string; size?: number }) {
  const box = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.17),
    border: `2px solid ${C.lineStrong}`,
    flexShrink: 0,
  } as const;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img>
    return <img src={src} alt="" width={size} height={size} style={{ ...box, objectFit: "cover" }} />;
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
        fontSize: Math.round(size * 0.46),
        color: C.steelHi,
      }}
    >
      {symbol.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** "Paired with ● SOL", as `.pill-pair` on the site. */
export function PairPill({ symbol, logo }: { symbol: string; logo: string | null }) {
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

export function Stat({
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
