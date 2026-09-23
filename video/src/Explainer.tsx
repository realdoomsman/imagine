import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clampEase, COLORS, FONTS, FPS } from "./theme";
import { Grain, Knurl, Panel, Rule } from "./chrome";
import { Vise } from "./Vise";

/**
 * 30-second explainer: the four things a viewer has to understand before the
 * product makes sense. One idea per beat, no narration, numbers on screen.
 */
export const EXPLAINER_DURATION = 30 * FPS;

export function Explainer() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ground }}>
      <Audio src={staticFile("explainer.wav")} />
      <Knurl />
      <Sequence durationInFrames={6 * FPS}>
        <Beat
          index="01"
          title="A trade pays a fee"
          body="2% of the SOL on every trade routed through VISE, plus the coin's pump.fun creator fees."
        >
          <FeeFlow />
        </Beat>
      </Sequence>
      <Sequence from={6 * FPS} durationInFrames={7 * FPS}>
        <Beat
          index="02"
          title="The fee goes to holders"
          body="Not to a dev wallet. Into the coin's own vault. 90% to the people who locked, 10% to VISE, nothing to the creator."
        >
          <SplitBar />
        </Beat>
      </Sequence>
      <Sequence from={13 * FPS} durationInFrames={8 * FPS}>
        <Beat
          index="03"
          title="Longer locks take more"
          body="Weight is amount times term, on a square-root curve. Seven days counts once. A year counts four times. Lock 1% of supply and it counts half again."
        >
          <MultiplierLadder />
        </Beat>
      </Sequence>
      <Sequence from={21 * FPS} durationInFrames={9 * FPS}>
        <Closing />
      </Sequence>
      <Grain />
    </AbsoluteFill>
  );
}

function Beat({
  index,
  title,
  body,
  children,
}: {
  index: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  const frame = useCurrentFrame();
  const a = clampEase(frame / (0.5 * FPS));

  return (
    <AbsoluteFill style={{ padding: "110px 140px", opacity: a }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 26, color: COLORS.torch }}>
        {index}
      </div>
      <h2
        style={{
          fontFamily: FONTS.display,
          fontSize: 88,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: COLORS.heading,
          margin: "26px 0 0",
          transform: `translateY(${(1 - a) * 26}px)`,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontFamily: FONTS.sans,
          fontSize: 34,
          lineHeight: 1.45,
          color: COLORS.body,
          maxWidth: 1180,
          margin: "26px 0 0",
        }}
      >
        {body}
      </p>
      <div style={{ marginTop: 70, flex: 1 }}>{children}</div>
    </AbsoluteFill>
  );
}

function FeeFlow() {
  const frame = useCurrentFrame();
  const travel = clampEase(Math.min((frame - 0.8 * FPS) / (2.4 * FPS), 1));

  return (
    <div style={{ position: "relative", height: 260 }}>
      <Panel style={{ position: "absolute", left: 0, top: 40, width: 380 }}>
        <Rule>Trade</Rule>
        <div style={{ fontFamily: FONTS.mono, fontSize: 60, color: COLORS.heading }}>
          10.00 SOL
        </div>
      </Panel>

      <div
        style={{
          position: "absolute",
          left: 420,
          top: 140,
          width: 680,
          height: 4,
          background: COLORS.border,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 420,
          top: 140,
          width: 680 * travel,
          height: 4,
          background: COLORS.torch,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 420 + 680 * travel - 14,
          top: 126,
          width: 28,
          height: 32,
          background: COLORS.torch,
          opacity: travel > 0 && travel < 1 ? 1 : 0.35,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 620,
          top: 76,
          fontFamily: FONTS.mono,
          fontSize: 34,
          color: COLORS.torch,
        }}
      >
        0.20 SOL
      </div>

      <Panel
        style={{
          position: "absolute",
          left: 1140,
          top: 40,
          width: 420,
          borderColor: travel > 0.98 ? COLORS.torch : COLORS.border,
        }}
      >
        <Rule>The coin&apos;s vault</Rule>
        <div style={{ fontFamily: FONTS.mono, fontSize: 60, color: COLORS.torch }}>
          +0.20
        </div>
      </Panel>
    </div>
  );
}

function SplitBar() {
  const frame = useCurrentFrame();
  const grow = clampEase(Math.min(frame / (1.6 * FPS), 1));
  const parts = [
    { label: "Lockers", value: 90, color: COLORS.torch },
    { label: "Treasury", value: 10, color: COLORS.muted },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 96,
          border: `2px solid ${COLORS.border}`,
          overflow: "hidden",
          width: `${grow * 100}%`,
        }}
      >
        {parts.map((part) => (
          <div
            key={part.label}
            style={{
              width: `${part.value}%`,
              background: part.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONTS.mono,
              fontSize: 30,
              color: COLORS.ground,
            }}
          >
            {part.value}%
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 56, marginTop: 28 }}>
        {parts.map((part) => (
          <div
            key={part.label}
            style={{ display: "flex", alignItems: "center", gap: 14 }}
          >
            <div style={{ width: 18, height: 18, background: part.color }} />
            <span style={{ fontFamily: FONTS.sans, fontSize: 28, color: COLORS.body }}>
              {part.label}
            </span>
          </div>
        ))}
      </div>
      <p
        style={{
          fontFamily: FONTS.sans,
          fontSize: 26,
          color: COLORS.muted,
          marginTop: 34,
        }}
      >
        Stamped onto the pool at launch. Nobody can edit it afterwards.
      </p>
    </div>
  );
}

function MultiplierLadder() {
  const frame = useCurrentFrame();
  const rows = [
    { days: 7, mult: "1.00×", width: 25 },
    { days: 30, mult: "1.76×", width: 44 },
    { days: 90, mult: "2.44×", width: 61 },
    { days: 180, mult: "3.09×", width: 77 },
    { days: 365, mult: "4.00×", width: 100 },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {rows.map((row, index) => {
        const a = clampEase((frame - index * 0.45 * FPS) / (0.6 * FPS));
        return (
          <div
            key={row.days}
            style={{ display: "flex", alignItems: "center", gap: 34, opacity: a }}
          >
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 34,
                color: COLORS.body,
                width: 110,
              }}
            >
              {row.days}d
            </span>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 38,
                color: COLORS.heading,
                width: 140,
              }}
            >
              {row.mult}
            </span>
            <div
              style={{
                flex: 1,
                height: 30,
                border: `2px solid ${COLORS.border}`,
                background: COLORS.ground,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${row.width * a}%`,
                  background: COLORS.torch,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Closing() {
  const frame = useCurrentFrame();
  const grip = clampEase(Math.min(frame / (2.2 * FPS), 1));
  const fade = interpolate(frame, [0, 0.6 * FPS], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{ justifyContent: "center", alignItems: "center", opacity: fade }}
    >
      <Vise grip={grip} width={860} />
      <div
        style={{
          fontFamily: FONTS.display,
          fontSize: 120,
          letterSpacing: "-0.04em",
          color: COLORS.heading,
          marginTop: 56,
        }}
      >
        VISE
      </div>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontSize: 36,
          color: COLORS.torch,
          marginTop: 10,
        }}
      >
        Every trade pays the people who didn&apos;t sell.
      </div>
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 26,
          letterSpacing: "0.2em",
          color: COLORS.muted,
          marginTop: 42,
        }}
      >
        VISE.FUN
      </div>
    </AbsoluteFill>
  );
}
