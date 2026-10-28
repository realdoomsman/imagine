import { AbsoluteFill } from "remotion";
import { DREAM_STOPS, COLORS, DAY, FONTS, HOUR, LOCK_TERMS, multiplierFor } from "../theme";
import { Dream } from "../kit";
import { Ground, SignOff } from "./common";

/**
 * p03, 1600×900: the duration multiplier on the shipped square-root curve
 * (multiplierFor mirrors packages/sdk durationMultiplierBps), on a linear time
 * axis so the front-loaded bend shows, plus the size tiers and one worked
 * multiplier. Numbers are posts.json p03.
 */

const X0 = 150;
const X1 = 990;
const Y1 = 742; // 1.00×
const Y4 = 258; // 4.00×
const { minLockSecs: MIN, maxLockSecs: MAX } = LOCK_TERMS;
const px = (secs: number) => X0 + ((secs - MIN) / (MAX - MIN)) * (X1 - X0);
const py = (mult: number) => Y1 - ((mult - 1) / 3) * (Y1 - Y4);

type Pt = { label: string; secs: number; lx: number; ly: number; anchor: "start" | "end" };
// Label offsets keep the first-week cluster readable under the curve.
const POINTS: Pt[] = [
  { label: "4h", secs: 4 * HOUR, lx: 60, ly: -6, anchor: "start" },
  { label: "1d", secs: DAY, lx: 58, ly: -16, anchor: "start" },
  { label: "7d", secs: 7 * DAY, lx: 44, ly: -8, anchor: "start" },
  { label: "30d", secs: 30 * DAY, lx: 22, ly: 18, anchor: "start" },
  { label: "90d", secs: 90 * DAY, lx: 18, ly: 26, anchor: "start" },
  { label: "180d", secs: 180 * DAY, lx: 16, ly: 30, anchor: "start" },
  { label: "365d", secs: 365 * DAY, lx: 0, ly: -26, anchor: "end" },
];

const mono = (size: number, color: string): React.CSSProperties => ({ fontFamily: FONTS.mono, fontWeight: 500, fontSize: size, color });
/** SVG text takes `fill`, not `color`. */
const svgMono = (size: number, color: string): React.CSSProperties => ({ fontFamily: FONTS.mono, fontWeight: 500, fontSize: size, fill: color });

function Curve() {
  const steps = 400;
  const d = Array.from({ length: steps + 1 }, (_, i) => {
    const secs = MIN + ((MAX - MIN) * i) / steps;
    const m = 1 + 3 * Math.sqrt((secs - MIN) / (MAX - MIN));
    return `${i === 0 ? "M" : "L"} ${px(secs).toFixed(2)} ${py(m).toFixed(2)}`;
  }).join(" ");
  const area = `${d} L ${X1} ${Y1} L ${X0} ${Y1} Z`;
  return (
    <svg width={1600} height={900} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <linearGradient id="p03-dream" x1={X0} y1="0" x2={X1} y2="0" gradientUnits="userSpaceOnUse">
          {DREAM_STOPS.map((s) => (
            <stop key={s.at} offset={s.at} stopColor={s.color} />
          ))}
        </linearGradient>
        <linearGradient id="p03-fill" x1="0" y1={Y4} x2="0" y2={Y1} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="rgba(94,233,181,0.20)" />
          <stop offset="1" stopColor="rgba(94,233,181,0)" />
        </linearGradient>
      </defs>
      {/* grid + y ticks */}
      {[1, 2, 3, 4].map((m) => (
        <g key={m}>
          <line x1={X0} x2={X1} y1={py(m)} y2={py(m)} stroke={COLORS.line} strokeWidth={1} />
          <text x={X0 - 18} y={py(m) + 7} textAnchor="end" style={svgMono(20, COLORS.muted)}>
            {m.toFixed(2)}×
          </text>
        </g>
      ))}
      {/* x axis */}
      <line x1={X0} x2={X1} y1={Y1} y2={Y1} stroke={COLORS.lineStrong} strokeWidth={2} />
      {POINTS.map((p) => (
        <line key={p.label} x1={px(p.secs)} x2={px(p.secs)} y1={Y1} y2={Y1 + 10} stroke={COLORS.lineStrong} strokeWidth={2} />
      ))}
      {[
        { t: "4h", x: px(4 * HOUR) },
        { t: "30d", x: px(30 * DAY) },
        { t: "90d", x: px(90 * DAY) },
        { t: "180d", x: px(180 * DAY) },
        { t: "365d", x: px(365 * DAY) },
      ].map((l) => (
        <text key={l.t} x={l.x} y={Y1 + 36} textAnchor="middle" style={svgMono(20, COLORS.fgSoft)}>
          {l.t}
        </text>
      ))}
      {/* 1d and 7d sit 2 px and 16 px from 4h on a linear axis: fan them out */}
      <path d={`M ${px(DAY)} ${Y1 + 10} L ${X0 - 22} ${Y1 + 50}`} stroke={COLORS.lineStrong} strokeWidth={1.5} fill="none" />
      <text x={X0 - 28} y={Y1 + 64} textAnchor="end" style={svgMono(20, COLORS.fgSoft)}>
        1d
      </text>
      <path d={`M ${px(7 * DAY)} ${Y1 + 10} L ${px(7 * DAY) + 16} ${Y1 + 50}`} stroke={COLORS.lineStrong} strokeWidth={1.5} fill="none" />
      <text x={px(7 * DAY) + 10} y={Y1 + 68} textAnchor="start" style={svgMono(20, COLORS.fgSoft)}>
        7d
      </text>
      <text x={(X0 + X1) / 2 + 40} y={Y1 + 70} textAnchor="middle" style={svgMono(18, COLORS.muted)}>
        LOCK DURATION · LINEAR TIME
      </text>
      {/* linear comparison */}
      <line x1={X0} y1={Y1} x2={X1} y2={Y4} stroke={COLORS.muted} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="8 9" />
      <text
        transform={`translate(${px(250 * DAY)} ${py(1 + 3 * ((250 * DAY - MIN) / (MAX - MIN))) + 30}) rotate(${(-Math.atan((Y1 - Y4) / (X1 - X0)) * 180) / Math.PI})`}
        textAnchor="middle"
        style={svgMono(18, COLORS.muted)}
      >
        linear, for comparison
      </text>
      {/* the curve */}
      <path d={area} fill="url(#p03-fill)" />
      <path d={d} stroke="url(#p03-dream)" strokeWidth={6} fill="none" strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 10px rgba(94,233,181,0.35))" }} />
      {POINTS.map((p) => {
        const m = multiplierFor(p.secs);
        const x = px(p.secs);
        const y = py(Number(m));
        const lx = x + p.lx;
        const ly = y + p.ly;
        const leader = Math.abs(p.lx) > 30;
        return (
          <g key={p.label}>
            {leader && <line x1={x + 8} y1={y} x2={lx - 8} y2={ly - 7} stroke={COLORS.lineStrong} strokeWidth={1.5} />}
            <circle cx={x} cy={y} r={8} fill={COLORS.ink} stroke={COLORS.mint} strokeWidth={3.5} />
            <text x={lx} y={ly} textAnchor={p.anchor} style={svgMono(22, COLORS.fgSoft)}>
              <tspan>{p.label} </tspan>
              <tspan fill={COLORS.fg}>{m}×</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Tier({ at, bonus }: { at: string; bonus: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "14px 0", borderTop: `1px solid ${COLORS.line}` }}>
      <span style={{ fontFamily: FONTS.sans, fontSize: 24, color: COLORS.fgSoft }}>
        ≥ <span style={mono(24, COLORS.fg)}>{at}</span> of supply
      </span>
      <span style={mono(30, COLORS.mint)}>{bonus}</span>
    </div>
  );
}

export function P03() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Ground glowX={40} glowY={40} glow={0.6} grain={false} />
      <div style={{ position: "absolute", left: 72, top: 58, fontWeight: 800, fontSize: 64, letterSpacing: "-0.035em", lineHeight: 1.05 }}>
        Lock longer, <Dream>earn a bigger cut.</Dream>
      </div>
      <div style={{ position: "absolute", left: 74, top: 146, ...mono(23, COLORS.fgSoft) }}>
        weight = amount × duration multiplier × size tier
      </div>
      <div style={{ position: "absolute", left: 74, top: 206, ...mono(18, COLORS.steelHi), letterSpacing: "0.18em", textTransform: "uppercase" }}>
        Duration multiplier · square-root curve
      </div>

      <Curve />

      <div
        style={{
          position: "absolute",
          left: 1080,
          top: 206,
          width: 448,
          background: COLORS.ink2,
          border: `1px solid ${COLORS.line}`,
          borderRadius: 18,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 60px rgba(0,0,0,0.35)",
          padding: "26px 30px 28px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ ...mono(18, COLORS.steelHi), letterSpacing: "0.18em", textTransform: "uppercase" }}>Size tier</div>
        <div style={{ fontWeight: 700, fontSize: 28, marginTop: 10, marginBottom: 14, lineHeight: 1.2 }}>On top, multiplies</div>
        <Tier at="0.1%" bonus="+10%" />
        <Tier at="0.5%" bonus="+25%" />
        <Tier at="1%" bonus="+50%" />
        <div style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 20, marginTop: 4 }}>
          <div style={{ fontSize: 22, color: COLORS.fgSoft }}>365 days at 1% of supply</div>
          <div style={{ ...mono(35, COLORS.mint), marginTop: 10, whiteSpace: "nowrap" }}>4.00 × 1.5 = 6.00×</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 1082, top: 686, width: 444, fontSize: 20, lineHeight: 1.45, color: COLORS.muted }}>
        Square-root curve, so short locks still count. Terms frozen per pool.
      </div>

      <SignOff size={28} right={72} bottom={56} />
    </AbsoluteFill>
  );
}
