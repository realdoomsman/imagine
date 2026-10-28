import { OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { COLORS, FONTS, ease, easeInOut } from "../theme";

/** Screen recordings are 1920×1080 CSS pixels; every rect below is in that space. */
export const SRC_W = 1920;
export const SRC_H = 1080;
const CHROME_H = 46;

/** A camera key: at local frame `at`, zoom `z` centred on source point (`x`, `y`). */
export type CameraKey = { at: number; z: number; x: number; y: number };

/** A highlight ring over a source rect, shown between local frames `from` and `to`. */
export type Spot = { from: number; to: number; rect: [number, number, number, number]; dim?: boolean };

/** A click ripple at a source point, at local frame `at`. */
export type Ripple = { at: number; x: number; y: number };

function camera(keys: CameraKey[], frame: number) {
  if (frame <= keys[0].at) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (frame <= b.at) {
      const t = easeInOut((frame - a.at) / Math.max(1, b.at - a.at));
      return { at: frame, z: a.z + (b.z - a.z) * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return keys[keys.length - 1];
}

/**
 * A recording inside a clean browser window: traffic lights, a URL pill, and
 * a camera that pushes in on the part of the page that matters.
 */
export function Footage({
  src,
  startAt,
  width,
  url,
  keys = [{ at: 0, z: 1, x: SRC_W / 2, y: SRC_H / 2 }],
  spots = [],
  ripples = [],
  badge,
}: {
  src: string;
  /** Seconds into the file at local frame 0. Speed-ups are baked into the file (`<name>-x<rate>.mp4`). */
  startAt: number;
  width: number;
  url: string;
  keys?: CameraKey[];
  spots?: Spot[];
  ripples?: Ripple[];
  /** Small chip in the chrome, e.g. "mainnet-fork demo". */
  badge?: { text: string; tone: "live" | "demo" };
}) {
  const frame = useCurrentFrame();
  const height = (width * SRC_H) / SRC_W;
  const base = width / SRC_W;
  const cam = camera(keys, frame);
  const scale = base * cam.z;
  // Keep the page filling the window: clamp the focus so no edge shows.
  const tx = Math.min(0, Math.max(width - SRC_W * scale, width / 2 - cam.x * scale));
  const ty = Math.min(0, Math.max(height - SRC_H * scale, height / 2 - cam.y * scale));
  return (
    <div
      style={{
        width,
        borderRadius: 16,
        overflow: "hidden",
        background: COLORS.ink1,
        border: `1px solid ${COLORS.lineStrong}`,
        boxShadow: "0 50px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03), 0 0 90px rgba(94,233,181,0.08)",
      }}
    >
      <div
        style={{
          height: CHROME_H,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 18px",
          background: COLORS.ink2,
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        {[COLORS.rose, COLORS.steel, COLORS.mint].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c, opacity: 0.55 }} />
        ))}
        <div
          style={{
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 22px",
            borderRadius: 999,
            background: COLORS.ink,
            border: `1px solid ${COLORS.line}`,
            fontFamily: FONTS.mono,
            fontSize: 17,
            color: COLORS.fgSoft,
            minWidth: width * 0.34,
            justifyContent: "center",
          }}
        >
          <svg width="12" height="14" viewBox="0 0 12 14">
            <rect x="1" y="6" width="10" height="7.5" rx="2" fill={COLORS.muted} />
            <path d="M3.5 6V4.2a2.5 2.5 0 015 0V6" stroke={COLORS.muted} strokeWidth="1.6" fill="none" />
          </svg>
          {url}
        </div>
        {badge ? <Badge {...badge} /> : <span style={{ width: 54 }} />}
      </div>
      <div style={{ position: "relative", width, height, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: SRC_W, height: SRC_H, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}>
          <OffthreadVideo src={staticFile(`shots/${src}`)} startFrom={Math.round(startAt * 30)} muted style={{ width: SRC_W, height: SRC_H }} />
          {spots.map((spot, i) => (
            <SpotRing key={i} spot={spot} frame={frame} zoom={scale} />
          ))}
          {ripples.map((r, i) => (
            <RippleMark key={i} ripple={r} frame={frame} zoom={scale} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Badge({ text, tone }: { text: string; tone: "live" | "demo" }) {
  const color = tone === "live" ? COLORS.mint : COLORS.steelHi;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px",
        borderRadius: 999,
        border: `1px solid ${tone === "live" ? "rgba(94,233,181,0.35)" : "rgba(140,200,220,0.4)"}`,
        background: tone === "live" ? "rgba(94,233,181,0.08)" : "rgba(140,200,220,0.08)",
        fontFamily: FONTS.mono,
        fontSize: 14,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 9, background: color, boxShadow: `0 0 8px ${color}` }} />
      {text}
    </div>
  );
}

function SpotRing({ spot, frame, zoom }: { spot: Spot; frame: number; zoom: number }) {
  const on = Math.min(ease((frame - spot.from) / 9), 1 - ease((frame - spot.to) / 9));
  if (on <= 0) return null;
  const [x, y, w, h] = spot.rect;
  const pad = 8;
  const stroke = 2.5 / zoom;
  return (
    <div
      style={{
        position: "absolute",
        left: x - pad,
        top: y - pad,
        width: w + pad * 2,
        height: h + pad * 2,
        borderRadius: 14,
        opacity: on,
        transform: `scale(${1.06 - 0.06 * on})`,
        boxShadow: `${spot.dim === false ? "" : `0 0 0 4000px rgba(3,8,10,${0.5 * on}), `}0 0 ${40 / zoom}px rgba(94,233,181,0.45)`,
        outline: `${stroke}px solid ${COLORS.mint}`,
      }}
    />
  );
}

function RippleMark({ ripple, frame, zoom }: { ripple: Ripple; frame: number; zoom: number }) {
  const t = (frame - ripple.at) / 16;
  if (t < 0 || t > 1) return null;
  const r = (14 + 46 * ease(t)) / zoom;
  return (
    <div
      style={{
        position: "absolute",
        left: ripple.x - r,
        top: ripple.y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: 999,
        border: `${3 / zoom}px solid ${COLORS.mint}`,
        opacity: 1 - t,
        boxShadow: `0 0 ${24 / zoom}px rgba(94,233,181,0.6)`,
      }}
    />
  );
}

/** A caption chip under or over footage. */
export function Chip({ children, tone = "live" }: { children: React.ReactNode; tone?: "live" | "demo" | "plain" }) {
  const color = tone === "live" ? COLORS.mint : COLORS.steelHi;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 20px",
        borderRadius: 999,
        background: "rgba(16,33,39,0.85)",
        border: `1px solid ${COLORS.lineStrong}`,
        fontFamily: FONTS.mono,
        fontSize: 19,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: COLORS.fgSoft,
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 9, background: color, boxShadow: `0 0 10px ${color}` }} />
      {children}
    </div>
  );
}
