import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Backdrop, Dream, Grain, Mark } from "../kit";
import { COLORS, FONTS, FPS, easeInOut } from "../theme";

/**
 * Shared pieces for the X post assets. Raw captures are served from
 * video/out/x/raw via `--public-dir`, so `staticFile("hero-long.mp4")` is the
 * real recording, untouched.
 */

/** A crop window over a 1920×1080 capture, in capture pixels (centre + width; height follows 16:9). */
export type Crop = { x: number; y: number; w: number };

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Interpolate crop keyframes `[[t0, crop0], [t1, crop1], …]` (t in 0..1) with a soft in-out. */
export function cropAt(keys: Array<[number, Crop]>, t: number): Crop {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, c1] = keys[i];
    const [t0, c0] = keys[i - 1];
    if (t <= t1) {
      const k = easeInOut((t - t0) / Math.max(1e-6, t1 - t0));
      return { x: mix(c0.x, c1.x, k), y: mix(c0.y, c1.y, k), w: mix(c0.w, c1.w, k) };
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * One cut of a real screen recording: plays `src` from `from` seconds at
 * `rate`, framed by a moving crop, with an optional fade at both ends. With
 * `url`, the cropped page sits inside a browser window showing that address.
 */
export function Shot({
  src,
  from,
  rate = 1,
  durationInFrames,
  crop,
  fadeIn = 0,
  fadeOut = 0,
  url,
}: {
  src: string;
  from: number;
  rate?: number;
  durationInFrames: number;
  crop: Array<[number, Crop]>;
  fadeIn?: number;
  fadeOut?: number;
  url?: string;
}) {
  const frame = useCurrentFrame();
  const c = cropAt(crop, frame / durationInFrames);
  const k = 1920 / c.w;
  const opacity = Math.min(
    fadeIn > 0 ? Math.min(1, frame / fadeIn) : 1,
    fadeOut > 0 ? Math.min(1, (durationInFrames - frame) / fadeOut) : 1,
  );
  const page = (
    <AbsoluteFill style={{ transformOrigin: "960px 540px", transform: `scale(${k}) translate(${960 - c.x}px, ${540 - c.y}px)` }}>
      <OffthreadVideo src={staticFile(src)} trimBefore={Math.round(from * FPS)} playbackRate={rate} muted style={{ width: 1920, height: 1080 }} />
    </AbsoluteFill>
  );
  if (!url) return <AbsoluteFill style={{ backgroundColor: COLORS.ink, opacity }}>{page}</AbsoluteFill>;
  return (
    <AbsoluteFill style={{ opacity }}>
      <Ground glowX={50} glowY={50} glow={0.7} grain={false} />
      <BrowserWindow url={url}>{page}</BrowserWindow>
    </AbsoluteFill>
  );
}

const WINDOW_W = 1720;
const CHROME_H = 46;

/** A clean browser window centred in the 1920×1080 frame; children render in a 1920×1080 page space. */
function BrowserWindow({ url, children }: { url: string; children: React.ReactNode }) {
  const s = WINDOW_W / 1920;
  const pageH = 1080 * s;
  return (
    <div
      style={{
        position: "absolute",
        left: (1920 - WINDOW_W) / 2,
        top: (1080 - pageH - CHROME_H) / 2,
        width: WINDOW_W,
        borderRadius: 16,
        overflow: "hidden",
        background: COLORS.ink1,
        border: `1px solid ${COLORS.lineStrong}`,
        boxShadow: "0 50px 120px rgba(0,0,0,0.55), 0 0 90px rgba(94,233,181,0.08)",
      }}
    >
      <div style={{ height: CHROME_H, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", background: COLORS.ink2, borderBottom: `1px solid ${COLORS.line}` }}>
        {[COLORS.rose, COLORS.steel, COLORS.mint].map((col) => (
          <span key={col} style={{ width: 12, height: 12, borderRadius: 99, background: col, opacity: 0.55 }} />
        ))}
        <div
          style={{
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "6px 22px",
            minWidth: WINDOW_W * 0.34,
            borderRadius: 999,
            background: COLORS.ink,
            border: `1px solid ${COLORS.line}`,
            fontFamily: FONTS.mono,
            fontSize: 17,
            color: COLORS.fgSoft,
          }}
        >
          <svg width="12" height="14" viewBox="0 0 12 14">
            <rect x="1" y="6" width="10" height="7.5" rx="2" fill={COLORS.muted} />
            <path d="M3.5 6V4.2a2.5 2.5 0 015 0V6" stroke={COLORS.muted} strokeWidth="1.6" fill="none" />
          </svg>
          {url}
        </div>
        <span style={{ width: 54 }} />
      </div>
      <div style={{ position: "relative", width: WINDOW_W, height: pageH, overflow: "hidden", background: COLORS.ink }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `scale(${s})` }}>{children}</div>
      </div>
    </div>
  );
}

/** Place a Shot on the timeline. */
export function Cut({ at, length, children }: { at: number; length: number; children: React.ReactNode }) {
  return (
    <Sequence from={at} durationInFrames={length} layout="none">
      {children}
    </Sequence>
  );
}

/** Ink ground, faint grid, a dream glow; the brand page every still sits on. */
export function Ground({ glowX = 70, glowY = 30, glow = 0.6, grain = true }: { glowX?: number; glowY?: number; glow?: number; grain?: boolean }) {
  return (
    <>
      <Backdrop glow={glow} glowX={glowX} glowY={glowY} />
      {grain && <Grain />}
    </>
  );
}

/** Bottom-right sign-off: the mark and imagine.fun. */
export function SignOff({ size = 26, right = 56, bottom = 44 }: { size?: number; right?: number; bottom?: number }) {
  return (
    <div style={{ position: "absolute", right, bottom, display: "flex", alignItems: "center", gap: size * 0.45 }}>
      <Mark size={size * 1.35} id={`signoff-${size}`} />
      <span style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: size * 0.85, color: COLORS.fgSoft, letterSpacing: "0.04em" }}>imagine.fun</span>
    </div>
  );
}

/** "Imagine" in the dream gradient followed by plain text, Sora 800. */
export function DreamLead({ lead, rest, size }: { lead: string; rest: string; size: number }) {
  return (
    <div style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: size, lineHeight: 1.06, letterSpacing: "-0.035em", color: COLORS.fg }}>
      <Dream>{lead}</Dream>
      {rest}
    </div>
  );
}
