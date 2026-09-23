import { AbsoluteFill } from "remotion";
import { Knurl, Rule } from "./chrome";
import { COLORS, FONTS, multiplierFor } from "./theme";
import { Vise } from "./Vise";

/**
 * Stills for the X feed, 1600×900.
 *
 * One composition, several layouts: a feed of twenty identically framed cards
 * reads as a template, so each post picks the shape its idea needs and the
 * shared parts are only the palette, the faces and the corner marks. The
 * numbers are computed from the same curve the program runs, not typed in.
 */
export type CardProps =
  | { kind: "statement"; lines: string[]; sub?: string; accent?: number }
  | { kind: "figure"; figure: string; label: string; sub?: string }
  | { kind: "ladder"; title: string; sub?: string }
  | { kind: "split"; title: string; sub?: string }
  | { kind: "vise"; lines: string[]; days: number }
  | { kind: "list"; title: string; items: string[] }
  | { kind: "quote"; quote: string; attribution: string }
  | { kind: "flow"; title: string; steps: string[]; sub?: string }
  | { kind: "tiers"; title: string; sub?: string }
  | { kind: "compare"; title: string; left: { head: string; rows: string[] }; right: { head: string; rows: string[] } };

export const CARD_DEFAULT: CardProps = { kind: "statement", lines: ["Selling is free.", "Holding is not."] };

export function Card(props: CardProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ground, fontFamily: FONTS.sans, color: COLORS.body }}>
      <Knurl />
      <Frame />
      <div style={{ position: "absolute", inset: 0, padding: "96px 110px", display: "flex", flexDirection: "column" }}>
        <Body {...props} />
      </div>
      <Footer />
    </AbsoluteFill>
  );
}

function Body(props: CardProps) {
  switch (props.kind) {
    case "statement":
      return <Statement {...props} />;
    case "figure":
      return <Figure {...props} />;
    case "ladder":
      return <Ladder {...props} />;
    case "split":
      return <Split {...props} />;
    case "vise":
      return <ViseCard {...props} />;
    case "list":
      return <List {...props} />;
    case "quote":
      return <Quote {...props} />;
    case "flow":
      return <Flow {...props} />;
    case "tiers":
      return <Tiers {...props} />;
    case "compare":
      return <Compare {...props} />;
  }
}

/** Corner registration marks; the machined edge every brand surface carries. */
function Frame() {
  const mark = (x: "left" | "right", y: "top" | "bottom") => (
    <div
      key={`${x}${y}`}
      style={{
        position: "absolute",
        [x]: 44,
        [y]: 44,
        width: 26,
        height: 26,
        borderTop: y === "top" ? `2px solid ${COLORS.border}` : undefined,
        borderBottom: y === "bottom" ? `2px solid ${COLORS.border}` : undefined,
        borderLeft: x === "left" ? `2px solid ${COLORS.border}` : undefined,
        borderRight: x === "right" ? `2px solid ${COLORS.border}` : undefined,
      }}
    />
  );
  return <>{[mark("left", "top"), mark("right", "top"), mark("left", "bottom"), mark("right", "bottom")]}</>;
}

function Footer() {
  return (
    <div
      style={{
        position: "absolute",
        left: 110,
        right: 110,
        bottom: 60,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontFamily: FONTS.mono,
        fontSize: 19,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color: COLORS.muted,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ display: "inline-block", width: 14, height: 22, background: COLORS.torch }} />
        <span style={{ display: "inline-block", width: 14, height: 22, background: COLORS.torch, marginLeft: -6 }} />
        <span style={{ color: COLORS.heading, letterSpacing: "0.1em", marginLeft: 6 }}>VISE</span>
      </span>
      <span>vise.fun</span>
    </div>
  );
}

function Headline({ lines, size = 108, accent = -1 }: { lines: string[]; size?: number; accent?: number }) {
  return (
    <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: size, lineHeight: 0.98, letterSpacing: "-0.04em", color: COLORS.heading }}>
      {lines.map((line, index) => (
        <div key={line} style={{ color: index === accent ? COLORS.torch : index > 0 && accent === -1 ? COLORS.muted : COLORS.heading }}>
          {line}
        </div>
      ))}
    </div>
  );
}

function Sub({ children }: { children: string }) {
  return <p style={{ marginTop: 34, maxWidth: 980, fontSize: 30, lineHeight: 1.45, color: COLORS.body }}>{children}</p>;
}

function Statement({ lines, sub, accent }: Extract<CardProps, { kind: "statement" }>) {
  return (
    <div style={{ marginTop: "auto", marginBottom: 60 }}>
      <Headline lines={lines} accent={accent ?? -1} />
      {sub ? <Sub>{sub}</Sub> : null}
    </div>
  );
}

function Figure({ figure, label, sub }: Extract<CardProps, { kind: "figure" }>) {
  return (
    <div style={{ marginTop: "auto", marginBottom: 60 }}>
      <Rule>{label}</Rule>
      <div style={{ fontFamily: FONTS.mono, fontSize: 250, lineHeight: 0.9, letterSpacing: "-0.05em", color: COLORS.torch }}>{figure}</div>
      {sub ? <Sub>{sub}</Sub> : null}
    </div>
  );
}

function Ladder({ title, sub }: Extract<CardProps, { kind: "ladder" }>) {
  const rows = [7, 30, 90, 180, 365];
  return (
    <div style={{ display: "flex", gap: 90, alignItems: "center", marginTop: "auto", marginBottom: 70 }}>
      <div style={{ flex: "0 0 560px" }}>
        <Headline lines={title.split("\n")} size={82} />
        {sub ? <Sub>{sub}</Sub> : null}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 22 }}>
        {rows.map((days) => {
          const mult = Number(multiplierFor(days));
          return (
            <div key={days} style={{ display: "flex", alignItems: "center", gap: 28 }}>
              <span style={{ fontFamily: FONTS.mono, fontSize: 28, width: 90, textAlign: "right", color: COLORS.muted }}>{days}d</span>
              <div style={{ flex: 1, height: 46, border: `2px solid ${COLORS.border}`, background: COLORS.panel }}>
                <div style={{ width: `${(mult / 4) * 100}%`, height: "100%", background: days === 365 ? COLORS.torch : COLORS.torchDim }} />
              </div>
              <span style={{ fontFamily: FONTS.mono, fontSize: 34, width: 130, color: days === 365 ? COLORS.torch : COLORS.heading }}>{mult.toFixed(2)}×</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Split({ title, sub }: Extract<CardProps, { kind: "split" }>) {
  const parts = [
    { label: "Lockers", value: 90, color: COLORS.torch },
    { label: "VISE", value: 10, color: COLORS.muted },
  ];
  return (
    <div style={{ marginTop: "auto", marginBottom: 70 }}>
      <Headline lines={title.split("\n")} size={88} />
      <div style={{ display: "flex", height: 120, border: `2px solid ${COLORS.border}`, marginTop: 56, overflow: "hidden" }}>
        {parts.map((part) => (
          <div key={part.label} style={{ width: `${part.value}%`, background: part.color, display: "flex", alignItems: "center", justifyContent: "center", gap: 18, fontFamily: FONTS.mono, fontSize: 34, color: part.label === "VISE" ? COLORS.heading : "#190600" }}>
            <span>{part.value}%</span>
            {part.value >= 20 ? (
              <span style={{ fontSize: 22, letterSpacing: "0.16em", textTransform: "uppercase" }}>{part.label}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, fontFamily: FONTS.mono, fontSize: 22, color: COLORS.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        <span>Creator: 0%. They lock like everyone else.</span>
        <span>Frozen on the pool at creation</span>
      </div>
      {sub ? <Sub>{sub}</Sub> : null}
    </div>
  );
}

function ViseCard({ lines, days }: Extract<CardProps, { kind: "vise" }>) {
  const grip = Math.max(0, Math.min((days - 7) / 358, 1));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 70, marginTop: "auto", marginBottom: 70 }}>
      <div style={{ flex: "0 0 620px" }}>
        <Headline lines={lines} size={lines.length > 2 ? 66 : 84} />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 30 }}>
        <Vise grip={grip} width={640} />
        <div style={{ display: "flex", gap: 60, fontFamily: FONTS.mono }}>
          <div>
            <div style={{ fontSize: 18, letterSpacing: "0.2em", color: COLORS.muted, textTransform: "uppercase" }}>Lock term</div>
            <div style={{ fontSize: 60, color: COLORS.heading }}>{days}<span style={{ fontSize: 28, color: COLORS.muted }}>d</span></div>
          </div>
          <div>
            <div style={{ fontSize: 18, letterSpacing: "0.2em", color: COLORS.muted, textTransform: "uppercase" }}>Your weight</div>
            <div style={{ fontSize: 60, color: COLORS.torch }}>{multiplierFor(days)}×</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function List({ title, items }: Extract<CardProps, { kind: "list" }>) {
  return (
    <div style={{ marginTop: "auto", marginBottom: 60 }}>
      <Headline lines={title.split("\n")} size={76} />
      <ul style={{ listStyle: "none", padding: 0, margin: "44px 0 0", display: "flex", flexDirection: "column", gap: 18 }}>
        {items.map((item, index) => (
          <li key={item} style={{ display: "flex", gap: 26, alignItems: "baseline", fontSize: 31, lineHeight: 1.35, color: COLORS.body }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 22, color: COLORS.torch, width: 44, flexShrink: 0 }}>{String(index + 1).padStart(2, "0")}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Quote({ quote, attribution }: Extract<CardProps, { kind: "quote" }>) {
  return (
    <div style={{ marginTop: "auto", marginBottom: 70, borderLeft: `6px solid ${COLORS.torch}`, paddingLeft: 50 }}>
      <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 62, lineHeight: 1.12, letterSpacing: "-0.03em", color: COLORS.heading, maxWidth: 1200 }}>{quote}</div>
      <div style={{ marginTop: 30, fontFamily: FONTS.mono, fontSize: 22, letterSpacing: "0.18em", textTransform: "uppercase", color: COLORS.muted }}>{attribution}</div>
    </div>
  );
}

function Flow({ title, steps, sub }: Extract<CardProps, { kind: "flow" }>) {
  return (
    <div style={{ marginTop: "auto", marginBottom: 70 }}>
      <Headline lines={title.split("\n")} size={78} />
      <div style={{ display: "flex", alignItems: "stretch", gap: 0, marginTop: 56 }}>
        {steps.map((step, index) => (
          <div key={step} style={{ display: "flex", alignItems: "center", flex: 1 }}>
            <div style={{ flex: 1, background: COLORS.panel, border: `2px solid ${index === steps.length - 1 ? COLORS.torch : COLORS.border}`, padding: "30px 32px", fontSize: 28, lineHeight: 1.3, color: index === steps.length - 1 ? COLORS.heading : COLORS.body, minHeight: 150, display: "flex", alignItems: "center" }}>
              {step}
            </div>
            {index < steps.length - 1 ? (
              <div style={{ width: 56, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.torch, fontFamily: FONTS.mono, fontSize: 34 }}>→</div>
            ) : null}
          </div>
        ))}
      </div>
      {sub ? <Sub>{sub}</Sub> : null}
    </div>
  );
}

function Tiers({ title, sub }: Extract<CardProps, { kind: "tiers" }>) {
  const tiers = [
    { at: "≥ 0.1% of supply", bonus: "+10%" },
    { at: "≥ 0.5% of supply", bonus: "+25%" },
    { at: "≥ 1.0% of supply", bonus: "+50%" },
  ];
  return (
    <div style={{ marginTop: "auto", marginBottom: 70 }}>
      <Headline lines={title.split("\n")} size={84} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2, background: COLORS.border, border: `2px solid ${COLORS.border}`, marginTop: 56 }}>
        {tiers.map((tier) => (
          <div key={tier.at} style={{ background: COLORS.panel, padding: "40px 44px" }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 21, letterSpacing: "0.18em", textTransform: "uppercase", color: COLORS.muted }}>{tier.at}</div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 92, color: COLORS.torch, marginTop: 14, lineHeight: 1 }}>{tier.bonus}</div>
          </div>
        ))}
      </div>
      {sub ? <Sub>{sub}</Sub> : null}
    </div>
  );
}

function Compare({ title, left, right }: Extract<CardProps, { kind: "compare" }>) {
  const column = (side: { head: string; rows: string[] }, accent: boolean) => (
    <div style={{ flex: 1, background: COLORS.panel, border: `2px solid ${accent ? COLORS.torch : COLORS.border}`, padding: "34px 40px" }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 22, letterSpacing: "0.18em", textTransform: "uppercase", color: accent ? COLORS.torch : COLORS.muted }}>{side.head}</div>
      <ul style={{ listStyle: "none", padding: 0, margin: "26px 0 0", display: "flex", flexDirection: "column", gap: 16 }}>
        {side.rows.map((row) => (
          <li key={row} style={{ fontSize: 29, lineHeight: 1.3, color: accent ? COLORS.heading : COLORS.body, display: "flex", gap: 18 }}>
            <span style={{ color: accent ? COLORS.torch : COLORS.muted }}>—</span>
            <span>{row}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div style={{ marginTop: "auto", marginBottom: 70 }}>
      <Headline lines={title.split("\n")} size={76} />
      <div style={{ display: "flex", gap: 30, marginTop: 50 }}>
        {column(left, false)}
        {column(right, true)}
      </div>
    </div>
  );
}
