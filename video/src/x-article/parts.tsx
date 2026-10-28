import { AbsoluteFill, Img, staticFile } from "remotion";
import { Backdrop, Mark } from "../kit";
import { COLORS, FONTS } from "../theme";

/**
 * Shared pieces for the X article images. Rendered with
 * `--public-dir=out/x/raw`, so `staticFile` resolves the real captures.
 */

export const W = 1600;
export const H = 900;
export const PAD = 64;

/** A raw capture and its pixel size. */
export type Src = { file: string; w: number; h: number };

export const HOME_HERO: Src = { file: "home-hero.png", w: 2400, h: 1350 };
export const LAUNCH_NVDAX: Src = { file: "launch-nvdax.png", w: 2400, h: 1350 };
export const COIN_LOCK: Src = { file: "coin-lock.png", w: 2400, h: 1350 };
export const COIN_FULL: Src = { file: "coin-full.png", w: 2400, h: 3189 };
export const EXPLORER_PROGRAM: Src = { file: "explorer-program.png", w: 2000, h: 1250 };
export const EXPLORER_CONFIG: Src = { file: "explorer-config.png", w: 2000, h: 1250 };
export const GITHUB: Src = { file: "github.png", w: 2000, h: 1250 };

/** Ink page with the brand grid and glow. */
export function Page({ children, glowX = 78, glowY = 8, glow = 0.7 }: { children: React.ReactNode; glowX?: number; glowY?: number; glow?: number }) {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Backdrop glow={glow} glowX={glowX} glowY={glowY} />
      {children}
    </AbsoluteFill>
  );
}

export function Eyebrow({ children, color = COLORS.steelHi, size = 20 }: { children: React.ReactNode; color?: string; size?: number }) {
  return (
    <div style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: size, letterSpacing: "0.18em", textTransform: "uppercase", color, lineHeight: 1.2 }}>
      {children}
    </div>
  );
}

export function Title({ children, size = 52, style }: { children: React.ReactNode; size?: number; style?: React.CSSProperties }) {
  return (
    <div style={{ fontWeight: 800, fontSize: size, letterSpacing: "-0.035em", lineHeight: 1.06, color: COLORS.fg, ...style }}>{children}</div>
  );
}

/** Dream-gradient text run. */
export function Dream({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        backgroundImage: "linear-gradient(120deg, #8CC8DC 0%, #5EE9B5 55%, #C7F9E5 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }}
    >
      {children}
    </span>
  );
}

/** Small mark + domain, top-right of every image. */
export function Brand({ top = 54, right = PAD }: { top?: number; right?: number }) {
  return (
    <div style={{ position: "absolute", top, right, display: "flex", alignItems: "center", gap: 12 }}>
      <Mark size={34} id={`brand-${top}-${right}`} />
      <span style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", color: COLORS.fg }}>IMAGINE</span>
    </div>
  );
}

/** Eyebrow + title, top-left. */
export function Header({ eyebrow, children, size, badge, width = W - PAD * 2 - 220 }: { eyebrow: string; children: React.ReactNode; size?: number; badge?: React.ReactNode; width?: number }) {
  return (
    <div style={{ position: "absolute", left: PAD, top: 52, width }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Eyebrow>{eyebrow}</Eyebrow>
        {badge}
      </div>
      <Title size={size} style={{ marginTop: 14 }}>
        {children}
      </Title>
    </div>
  );
}

/** Outlined label chip, e.g. ILLUSTRATIVE or MAINNET-FORK DEMO. */
export function Tag({ children, color = COLORS.steelHi, size = 17 }: { children: React.ReactNode; color?: string; size?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontFamily: FONTS.mono,
        fontWeight: 500,
        fontSize: size,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        lineHeight: 1,
        background: "rgba(7,16,19,0.6)",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      {children}
    </span>
  );
}

/** Ticker chip in the site's pair-pill style. */
export function Chip({ ticker, size = 24 }: { ticker: string; size?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.4,
        padding: `${size * 0.36}px ${size * 0.7}px`,
        borderRadius: 999,
        border: `1px solid ${COLORS.lineStrong}`,
        background: COLORS.ink3,
        fontFamily: FONTS.mono,
        fontWeight: 500,
        fontSize: size,
        color: COLORS.fg,
        lineHeight: 1,
      }}
    >
      <span style={{ width: size * 0.42, height: size * 0.42, borderRadius: 999, background: COLORS.mint, boxShadow: `0 0 ${size * 0.4}px ${COLORS.mint}` }} />
      {ticker}
    </span>
  );
}

/** A crop of a capture, `crop` = [x, y, w, h] in source pixels, scaled to `width`. */
export function Shot({ src, crop, width, style }: { src: Src; crop: [number, number, number, number]; width: number; style?: React.CSSProperties }) {
  const [x, y, w, h] = crop;
  const k = width / w;
  return (
    <div style={{ position: "relative", width, height: Math.round(h * k), overflow: "hidden", ...style }}>
      <Img
        src={staticFile(src.file)}
        style={{ position: "absolute", left: -x * k, top: -y * k, width: src.w * k, height: src.h * k, maxWidth: "none" }}
      />
    </div>
  );
}

export const shotHeight = (crop: [number, number, number, number], width: number) => Math.round(crop[3] * (width / crop[2]));

export const BAR = 44;

/** A clean browser window: traffic dots, centred address pill, optional right slot. */
export function Browser({ url, children, right, style }: { url: string; children: React.ReactNode; right?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: `1px solid ${COLORS.lineStrong}`,
        background: COLORS.ink1,
        overflow: "hidden",
        boxShadow: "0 40px 90px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
        ...style,
      }}
    >
      <div style={{ height: BAR, position: "relative", display: "flex", alignItems: "center", padding: "0 18px", background: "#0D1B20", borderBottom: `1px solid ${COLORS.line}` }}>
        <div style={{ display: "flex", gap: 8 }}>
          {["#2F4F58", "#2F4F58", "#2F4F58"].map((c, i) => (
            <span key={i} style={{ width: 12, height: 12, borderRadius: 999, background: c }} />
          ))}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 17,
              color: COLORS.fgSoft,
              background: COLORS.ink2,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 999,
              padding: "6px 22px",
              lineHeight: 1,
            }}
          >
            {url}
          </span>
        </div>
        <div style={{ marginLeft: "auto" }}>{right}</div>
      </div>
      {children}
    </div>
  );
}

/** Plain framed crop (no browser chrome), for panels lifted out of a page. */
export function Framed({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: `1px solid ${COLORS.lineStrong}`,
        overflow: "hidden",
        boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
        background: COLORS.ink,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Panel({ children, style, tone = "plain" }: { children: React.ReactNode; style?: React.CSSProperties; tone?: "plain" | "dream" }) {
  return (
    <div
      style={{
        background: COLORS.ink2,
        border: `1px solid ${tone === "dream" ? "rgba(94,233,181,0.55)" : COLORS.line}`,
        borderRadius: 14,
        boxShadow: tone === "dream" ? "0 0 60px rgba(94,233,181,0.12), inset 0 1px 0 rgba(255,255,255,0.05)" : "inset 0 1px 0 rgba(255,255,255,0.05)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
