import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { clampEase, COLORS, FONTS, FPS } from "./theme";
import { Grain, Knurl } from "./chrome";
import { Vise } from "./Vise";

/**
 * 15-second 9:16 cut for the feed.
 *
 * Built for sound-off viewing at thumbnail size: one line of type per beat,
 * huge numbers, and the mechanism doing the talking.
 */
export const VERTICAL_DURATION = 15 * FPS;

const BEATS = [
  { at: 0, lines: ["You held.", "You got nothing."] },
  { at: 3.2, lines: ["They sold.", "They got paid."] },
  { at: 6.4, lines: ["VISE flips it."] },
];

export function Vertical() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ground }}>
      <Knurl />
      {BEATS.map((beat, index) => (
        <Sequence
          key={beat.at}
          from={beat.at * FPS}
          durationInFrames={(index === BEATS.length - 1 ? 2.6 : 3.2) * FPS}
        >
          <Lines lines={beat.lines} />
        </Sequence>
      ))}
      <Sequence from={9 * FPS} durationInFrames={6 * FPS}>
        <Payoff />
      </Sequence>
      <Grain />
    </AbsoluteFill>
  );
}

function Lines({ lines }: { lines: string[] }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 90px" }}>
      {lines.map((line, index) => {
        const a = clampEase((frame - index * 0.28 * FPS) / (0.45 * FPS));
        return (
          <div
            key={line}
            style={{
              fontFamily: FONTS.display,
              fontSize: 118,
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
              color: index === 0 ? COLORS.heading : COLORS.torch,
              opacity: a,
              transform: `translateY(${(1 - a) * 34}px)`,
            }}
          >
            {line}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function Payoff() {
  const frame = useCurrentFrame();
  const grip = clampEase(Math.min(frame / (2.6 * FPS), 1));
  const days = Math.round(7 + grip * 358);
  const multiplier = (1 + grip * 3).toFixed(2);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 70 }}>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 26,
            letterSpacing: "0.22em",
            color: COLORS.muted,
          }}
        >
          LOCK FOR
        </div>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 150,
            color: COLORS.heading,
            lineHeight: 1,
          }}
        >
          {days}
          <span style={{ fontSize: 60, color: COLORS.muted }}>d</span>
        </div>
      </div>

      <Vise grip={grip} width={900} showScrew={false} />

      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 26,
            letterSpacing: "0.22em",
            color: COLORS.muted,
          }}
        >
          EARN
        </div>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 150,
            color: COLORS.torch,
            lineHeight: 1,
          }}
        >
          {multiplier}×
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 120,
          textAlign: "center",
          width: "100%",
        }}
      >
        <div
          style={{
            fontFamily: FONTS.display,
            fontSize: 92,
            letterSpacing: "-0.04em",
            color: COLORS.heading,
          }}
        >
          VISE
        </div>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 28,
            letterSpacing: "0.2em",
            color: COLORS.torch,
            marginTop: 10,
          }}
        >
          VISE.FUN
        </div>
      </div>
    </AbsoluteFill>
  );
}
