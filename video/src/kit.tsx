import { AbsoluteFill, useCurrentFrame } from "remotion";
import { COLORS, DAY, DREAM, DREAM_STOPS, FONTS, LOCK_TERMS, ease, multiplierFor, secondsFor } from "./theme";

// --- surfaces ----------------------------------------------------------------

/** The page ground: ink, a faint ticker grid, and a slow dream glow. */
export function Backdrop({ glow = 0.5, glowX = 70, glowY = 30 }: { glow?: number; glowX?: number; glowY?: number }) {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${COLORS.ink1} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.ink1} 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          opacity: 0.9,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 55% 60% at ${glowX}% ${glowY}%, rgba(94,233,181,${0.16 * glow}) 0%, rgba(140,200,220,${0.08 * glow}) 40%, transparent 75%)`,
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 120% 90% at 50% 50%, transparent 55%, rgba(3,8,10,0.85) 100%)` }} />
    </AbsoluteFill>
  );
}

/** Moving grain: keeps flat gradients from banding and reads as film. */
export function Grain() {
  const frame = useCurrentFrame();
  const shift = (frame % 6) * 37;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: 0.045,
        backgroundImage: "repeating-conic-gradient(rgba(255,255,255,0.4) 0% 25%, transparent 0% 50%)",
        backgroundSize: "3px 3px",
        backgroundPosition: `${shift}px ${shift * 0.6}px`,
        mixBlendMode: "overlay",
      }}
    />
  );
}

/** Fade + rise of a block between two local frames. */
export function appear(frame: number, start: number, length = 18, distance = 24) {
  const t = ease((frame - start) / length);
  return { opacity: t, transform: `translateY(${(1 - t) * distance}px)` };
}

export function fadeOut(frame: number, start: number, length = 12) {
  return 1 - ease((frame - start) / length);
}

// --- brand -------------------------------------------------------------------

function DreamDefs({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0.58" gradientUnits="objectBoundingBox">
      {DREAM_STOPS.map((stop) => (
        <stop key={stop.at} offset={stop.at} stopColor={stop.color} />
      ))}
    </linearGradient>
  );
}

/**
 * The IMAGINE mark: a rounded tile in the dream gradient with a lowercase "i"
 * cut in ink — the stem is the held position, the dot is the idea.
 * `dot` (0..1) lets the dot drop in; `stem` (0..1) grows the stem upward.
 */
export function Mark({ size, dot = 1, stem = 1, id = "mark" }: { size: number; dot?: number; stem?: number; id?: string }) {
  const stemHeight = 12 * stem;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: "block" }}>
      <defs>
        <DreamDefs id={`${id}-dream`} />
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="9" fill={`url(#${id}-dream)`} />
      {stemHeight > 0.2 && <rect x="13" y={25 - stemHeight} width="6" height={stemHeight} rx="3" fill={COLORS.ink} />}
      {dot > 0 && <circle cx="16" cy={8.5 - (1 - dot) * 6} r={3.2 * Math.min(1, dot * 1.4)} fill={COLORS.ink} opacity={Math.min(1, dot * 2)} />}
    </svg>
  );
}

export function Wordmark({ size, gradient = false }: { size: number; gradient?: boolean }) {
  return (
    <span
      style={{
        fontFamily: FONTS.sans,
        fontWeight: 800,
        fontSize: size,
        letterSpacing: "-0.02em",
        lineHeight: 1,
        color: COLORS.fg,
        ...(gradient ? { backgroundImage: DREAM, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } : {}),
      }}
    >
      IMAGINE
    </span>
  );
}

/** Lockup: mark + wordmark, scaled from the wordmark size. */
export function Lockup({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.32 }}>
      <Mark size={size * 1.08} id={`lockup-${size}`} />
      <Wordmark size={size} />
    </div>
  );
}

/** Text in the dream gradient. */
export function Dream({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ backgroundImage: DREAM, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", paddingBottom: "0.08em" }}>
      {children}
    </span>
  );
}

export function Eyebrow({ children, size = 22, color = COLORS.steelHi }: { children: React.ReactNode; size?: number; color?: string }) {
  return (
    <div style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: size, letterSpacing: "0.2em", textTransform: "uppercase", color }}>
      {children}
    </div>
  );
}

/** StonkFun-style pair pill: "Paired with ● NVDAx". */
export function PairPill({ ticker, size = 24, label = "Paired with" }: { ticker: string; size?: number; label?: string | null }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.45,
        padding: `${size * 0.4}px ${size * 0.8}px`,
        borderRadius: 999,
        border: `1px solid ${COLORS.lineStrong}`,
        background: COLORS.ink2,
        fontSize: size,
        color: COLORS.fgSoft,
        fontFamily: FONTS.sans,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {label && <span>{label}</span>}
      <span style={{ width: size * 0.5, height: size * 0.5, borderRadius: 999, background: COLORS.mint, boxShadow: `0 0 ${size * 0.5}px ${COLORS.mint}` }} />
      <span style={{ fontFamily: FONTS.mono, fontWeight: 500, color: COLORS.fg }}>{ticker}</span>
    </div>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: COLORS.ink2,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 14,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 30px 80px rgba(0,0,0,0.35)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// --- the chart ---------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Candle = { open: number; close: number; high: number; low: number };

/**
 * A sample stock-paired meme, seeded so every render is identical.
 * `calm` 0 is the familiar run-up and sell-off; 1 is the chart where holders
 * locked: same buyers, no rush for the exit.
 */
export function candles(count: number, calm: number, seed = 11): Candle[] {
  const rand = mulberry32(seed);
  const out: Candle[] = [];
  let prev = 1;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const noise = rand() - 0.5;
    const wick = rand();
    const dump = t < 0.42 ? 1 + 2.6 * t + 0.25 * Math.sin(t * 40) : Math.max(0.3, 2.1 - 4.4 * (t - 0.42) + 0.18 * Math.sin(t * 31));
    const steady = 1 + 1.55 * t + 0.07 * Math.sin(t * 23);
    const close = dump * (1 - calm) + steady * calm + noise * (0.32 * (1 - calm) + 0.06 * calm);
    const spread = (0.35 * (1 - calm) + 0.06) * wick;
    const down = close < prev;
    out.push({
      open: prev,
      close,
      high: Math.max(prev, close) + spread * (down ? 0.4 : 0.7),
      low: Math.min(prev, close) - spread * (down ? 1.2 : 0.3),
    });
    prev = close;
  }
  return out;
}

export function Chart({
  width,
  height,
  calm,
  reveal = 1,
  count = 56,
  seed,
  line = 0,
}: {
  width: number;
  height: number;
  calm: number;
  reveal?: number;
  count?: number;
  seed?: number;
  /** 0..1 opacity of the dream trend line over the candles. */
  line?: number;
}) {
  const data = candles(count, calm, seed);
  const lo = -0.35;
  const hi = 3.2;
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const step = width / count;
  const body = Math.max(3, step * 0.56);
  const shown = Math.max(0, Math.min(count, reveal * count));
  const visible = data.slice(0, Math.ceil(shown));
  const last = visible[visible.length - 1];
  const path = visible.map((c, i) => `${i === 0 ? "M" : "L"}${(i + 0.5) * step},${y(c.close)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <DreamDefs id="chart-dream" />
      </defs>
      {[0.2, 0.4, 0.6, 0.8].map((g) => (
        <line key={g} x1={0} x2={width} y1={height * g} y2={height * g} stroke={COLORS.line} strokeWidth={1} strokeDasharray="4 8" />
      ))}
      {visible.map((c, i) => {
        const x = (i + 0.5) * step;
        const up = c.close >= c.open;
        const color = up ? COLORS.mint : COLORS.rose;
        const grow = Math.min(1, shown - i);
        const top = y(Math.max(c.open, c.close));
        const bottom = y(Math.min(c.open, c.close));
        return (
          <g key={i} opacity={grow}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={Math.max(1.5, step * 0.08)} />
            <rect x={x - body / 2} y={top} width={body} height={Math.max(2, bottom - top)} rx={Math.min(3, body / 4)} fill={color} />
          </g>
        );
      })}
      {line > 0 && visible.length > 1 && (
        <path d={path} fill="none" stroke="url(#chart-dream)" strokeWidth={4} strokeLinejoin="round" opacity={line} />
      )}
      {last && (
        <g>
          <line x1={0} x2={width} y1={y(last.close)} y2={y(last.close)} stroke={last.close >= last.open ? COLORS.mint : COLORS.rose} strokeWidth={1.5} strokeDasharray="2 6" opacity={0.7} />
        </g>
      )}
    </svg>
  );
}

// --- the lock dial -----------------------------------------------------------

/**
 * A commitment dial over the shipped lock window (4 hours to a year, linear in
 * time), with the duration multiplier the program pays at that point.
 */
export function Dial({ size, commitment }: { size: number; commitment: number }) {
  const r = 42;
  const sweep = 300;
  const start = -150;
  const seconds = secondsFor(commitment);
  const underDay = seconds < DAY;
  const shown = underDay ? Math.round(seconds / 3_600) : Math.floor(seconds / DAY);
  const polar = (deg: number, radius = r) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [50 + radius * Math.cos(a), 50 + radius * Math.sin(a)];
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = polar(from);
    const [x2, y2] = polar(to);
    const large = to - from > 180 ? 1 : 0;
    return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}`;
  };
  const end = start + sweep * Math.max(0.002, commitment);
  const [kx, ky] = polar(end);
  const ticks = [30, 90, 180, 365].map((d) => d * DAY);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100">
        <defs>
          <DreamDefs id="dial-dream" />
        </defs>
        <path d={arc(start, start + sweep)} stroke={COLORS.ink4} strokeWidth={5} fill="none" strokeLinecap="round" />
        <path d={arc(start, end)} stroke="url(#dial-dream)" strokeWidth={5} fill="none" strokeLinecap="round" />
        {ticks.map((t) => {
          const deg = start + sweep * ((t - LOCK_TERMS.minLockSecs) / (LOCK_TERMS.maxLockSecs - LOCK_TERMS.minLockSecs));
          const [x1, y1] = polar(deg, r - 6);
          const [x2, y2] = polar(deg, r - 9);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke={seconds >= t ? COLORS.mint : COLORS.lineStrong} strokeWidth={0.8} strokeLinecap="round" />;
        })}
        <circle cx={kx} cy={ky} r={4.4} fill={COLORS.fg} />
        <circle cx={kx} cy={ky} r={2} fill={COLORS.mintDeep} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: size * 0.2, color: COLORS.fg, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{shown}</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: size * 0.045, letterSpacing: "0.2em", color: COLORS.muted, marginTop: size * 0.02 }}>
          {underDay ? "HOURS LOCKED" : "DAYS LOCKED"}
        </div>
        <div style={{ marginTop: size * 0.05, fontFamily: FONTS.mono, fontWeight: 500, fontSize: size * 0.09, lineHeight: 1 }}>
          <Dream>{multiplierFor(seconds)}×</Dream>
        </div>
        <div style={{ fontFamily: FONTS.mono, fontSize: size * 0.04, letterSpacing: "0.2em", color: COLORS.muted, marginTop: size * 0.015 }}>WEIGHT</div>
      </div>
    </div>
  );
}

// --- the fee flow ------------------------------------------------------------

type Node = { id: string; x: number; y: number; w: number; title: string; sub: string; tone: "steel" | "dream" | "mint" | "muted" };

const NODES: Node[] = [
  { id: "trade", x: 0, y: 200, w: 300, title: "A trade", sub: "buy or sell, any IMAGINE coin", tone: "steel" },
  { id: "app", x: 430, y: 70, w: 330, title: "1% app fee", sub: "on trades routed via imagine.fun", tone: "steel" },
  { id: "share", x: 430, y: 330, w: 330, title: "Creator share", sub: "forwarded by StonkFun", tone: "steel" },
  { id: "vault", x: 900, y: 200, w: 300, title: "Pool vault", sub: "this coin's own vault", tone: "dream" },
  { id: "lockers", x: 1340, y: 70, w: 340, title: "90% lockers", sub: "by weight, in the pair asset", tone: "mint" },
  { id: "treasury", x: 1340, y: 330, w: 340, title: "10% treasury", sub: "frozen per pool", tone: "muted" },
];

const EDGES: Array<[string, string]> = [
  ["trade", "app"],
  ["trade", "share"],
  ["app", "vault"],
  ["share", "vault"],
  ["vault", "lockers"],
  ["vault", "treasury"],
];

const NODE_H = 150;
export const FLOW_W = 1680;
export const FLOW_H = 480;

function bezier(a: Node, b: Node) {
  const x1 = a.x + a.w;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  const mx = (x1 + x2) / 2;
  const at = (t: number) => {
    const u = 1 - t;
    return [
      u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2,
      u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2,
    ];
  };
  return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, at };
}

/**
 * The fee path, left to right, in a fixed 1680×480 space (scale it with
 * `scale`). `reveal` counts columns shown (0..4); `flow` is a running clock
 * in frames that drives the particles once a column is lit.
 */
export function FeeFlow({ reveal, flow, scale = 1, pair = "NVDAx" }: { reveal: number; flow: number; scale?: number; pair?: string }) {
  const column = (n: Node) => (n.id === "trade" ? 0 : n.id === "app" || n.id === "share" ? 1 : n.id === "vault" ? 2 : 3);
  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
  return (
    <div style={{ width: FLOW_W * scale, height: FLOW_H * scale, position: "relative" }}>
      <div style={{ width: FLOW_W, height: FLOW_H, transform: `scale(${scale})`, transformOrigin: "0 0", position: "absolute" }}>
        <svg width={FLOW_W} height={FLOW_H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {EDGES.map(([from, to], i) => {
            const a = byId[from];
            const b = byId[to];
            const lit = Math.min(1, Math.max(0, reveal - column(a)));
            const { d, at } = bezier(a, b);
            const dots = [0, 1, 2, 3].map((k) => {
              const t = (flow / 70 + k / 4 + i * 0.13) % 1;
              const [px, py] = at(t);
              return <circle key={k} cx={px} cy={py} r={to === "lockers" ? 7 : 5.5} fill={to === "treasury" ? COLORS.steel : COLORS.mint} opacity={lit * Math.sin(Math.PI * t)} />;
            });
            return (
              <g key={`${from}-${to}`}>
                <path d={d} stroke={COLORS.lineStrong} strokeWidth={2.5} fill="none" opacity={0.35 + 0.65 * lit} pathLength={1} strokeDasharray={`${lit} 1`} />
                {dots}
              </g>
            );
          })}
        </svg>
        {NODES.map((n) => {
          const shown = ease(reveal - column(n) + 1);
          const dream = n.tone === "dream";
          return (
            <div
              key={n.id}
              style={{
                position: "absolute",
                left: n.x,
                top: n.y,
                width: n.w,
                height: NODE_H,
                boxSizing: "border-box",
                padding: "26px 28px",
                borderRadius: 14,
                background: dream ? DREAM : COLORS.ink2,
                border: `1px solid ${dream ? "transparent" : n.tone === "mint" ? COLORS.mintDeep : COLORS.line}`,
                boxShadow: dream ? "0 0 80px rgba(94,233,181,0.35)" : "inset 0 1px 0 rgba(255,255,255,0.05)",
                opacity: shown,
                transform: `translateY(${(1 - shown) * 20}px)`,
              }}
            >
              <div style={{ fontFamily: FONTS.sans, fontWeight: 700, fontSize: 36, letterSpacing: "-0.02em", color: dream ? COLORS.ink : n.tone === "mint" ? COLORS.mint : COLORS.fg }}>
                {n.title}
              </div>
              <div style={{ marginTop: 10, fontFamily: FONTS.sans, fontSize: 21, color: dream ? COLORS.ink2 : COLORS.fgSoft }}>
                {n.id === "lockers" ? `by weight, paid in ${pair}` : n.sub}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
