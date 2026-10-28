import { AbsoluteFill, useVideoConfig } from "remotion";
import { Backdrop, Chart, Dial, Dream, Eyebrow, FeeFlow, FLOW_W, Lockup, PairPill } from "./kit";
import { COLORS, DAY, FONTS, LOCK_TERMS } from "./theme";

/**
 * Stills: the 1200×630 OG image and the 1600×900 X cards. Layout is drawn in
 * a 1200-wide unit space and scaled, so one card renders at either size.
 * `lines[accent]` and after are set in the dream gradient.
 */
export type CardProps =
  | { kind: "statement"; eyebrow?: string; lines: string[]; accent?: number; sub?: string }
  | { kind: "chart"; eyebrow?: string; lines: string[]; accent?: number; sub?: string }
  | { kind: "dial"; eyebrow?: string; lines: string[]; accent?: number; sub?: string; days: number }
  | { kind: "pairs"; eyebrow?: string; lines: string[]; accent?: number; sub?: string; pairs: string[] }
  | { kind: "flow"; eyebrow?: string; lines: string[]; accent?: number; sub?: string };

export const OG_PROPS: CardProps = {
  kind: "chart",
  lines: ["Imagine", "everyone locks."],
  accent: 1,
  sub: "Launched on Raydium. Every trade pays the holders who lock, in whatever the coin is paired with.",
};

export function Card(props: CardProps) {
  const { width, height } = useVideoConfig();
  const u = width / 1200;
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Backdrop glow={0.8} glowX={78} glowY={40} />
      <div style={{ position: "absolute", left: 0, top: 0, transform: `scale(${u})`, transformOrigin: "0 0", width: 1200, height: height / u }}>
        <Body {...props} />
        <div style={{ position: "absolute", left: 72, bottom: 52, display: "flex", alignItems: "center", gap: 24 }}>
          <Lockup size={34} />
        </div>
        <div style={{ position: "absolute", right: 72, bottom: 58, fontFamily: FONTS.mono, fontWeight: 500, fontSize: 22, letterSpacing: "0.06em", color: COLORS.steelHi }}>
          imagine.fun
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Title({ lines, accent, size }: { lines: string[]; accent?: number; size: number }) {
  return (
    <div style={{ fontWeight: 800, fontSize: size, letterSpacing: "-0.035em", lineHeight: 1.04 }}>
      {lines.map((line, i) => (
        <div key={line}>{accent !== undefined && i >= accent ? <Dream>{line}</Dream> : line}</div>
      ))}
    </div>
  );
}

function Text({
  eyebrow,
  lines,
  accent,
  sub,
  width,
  size = 72,
  children,
}: {
  eyebrow?: string;
  lines: string[];
  accent?: number;
  sub?: string;
  width: number;
  size?: number;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ position: "absolute", left: 72, top: 64, width }}>
      {eyebrow && (
        <div style={{ marginBottom: 22 }}>
          <Eyebrow size={17}>{eyebrow}</Eyebrow>
        </div>
      )}
      <Title lines={lines} accent={accent} size={size} />
      {sub && <div style={{ marginTop: 24, fontSize: 22, lineHeight: 1.45, color: COLORS.fgSoft }}>{sub}</div>}
      {children}
    </div>
  );
}

function Body(props: CardProps) {
  switch (props.kind) {
    case "statement":
      return <Text {...props} width={1040} size={76} />;
    case "chart":
      return (
        <>
          <Text {...props} width={560} />
          <div style={{ position: "absolute", left: 680, top: 70, padding: "22px 24px", borderRadius: 14, background: COLORS.ink2, border: `1px solid ${COLORS.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <PairPill ticker="NVDAx" size={14} />
              <span style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: "0.18em", color: COLORS.muted }}>ILLUSTRATIVE</span>
            </div>
            <Chart width={400} height={290} calm={1} line={1} count={34} />
          </div>
        </>
      );
    case "dial":
      return (
        <>
          <Text {...props} width={640} />
          <div style={{ position: "absolute", left: 770, top: 60 }}>
            <Dial size={360} commitment={(props.days * DAY - LOCK_TERMS.minLockSecs) / (LOCK_TERMS.maxLockSecs - LOCK_TERMS.minLockSecs)} />
          </div>
        </>
      );
    case "pairs":
      return (
        <Text {...props} width={1040}>
          <div style={{ marginTop: 30, display: "flex", gap: 14, flexWrap: "wrap" }}>
            {props.pairs.map((ticker, i) => (
              <PairPill key={ticker} ticker={ticker} size={20} label={i === 0 ? "Paired with" : null} />
            ))}
          </div>
        </Text>
      );
    case "flow":
      return (
        <>
          <Text {...props} width={1000} size={60} />
          <div style={{ position: "absolute", left: (1200 - FLOW_W * 0.62) / 2, top: 250 }}>
            <FeeFlow reveal={4} flow={20} scale={0.62} />
          </div>
        </>
      );
  }
}
