import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS, FONTS, FPS, clampEase, daysFor, multiplierFor } from "./theme";
import { Vise } from "./Vise";
import { Grain, Knurl, Rule } from "./chrome";

/**
 * 12-second teaser. No voiceover, no stock footage, no AI narration — kinetic
 * type on the product's own mechanism, cut on the beat of the clamp.
 */
export const TEASER_DURATION = 12 * FPS;

export function Teaser() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ground }}>
      <Audio src={staticFile("teaser.wav")} />
      <Knurl />
      <Sequence durationInFrames={3 * FPS}>
        <Statement top="Everyone sells." bottom="That is the whole problem." />
      </Sequence>
      <Sequence from={3 * FPS} durationInFrames={5 * FPS}>
        <ClampScene />
      </Sequence>
      <Sequence from={8 * FPS} durationInFrames={4 * FPS}>
        <Logo />
      </Sequence>
      <Grain />
    </AbsoluteFill>
  );
}

function Statement({ top, bottom }: { top: string; bottom: string }) {
  const frame = useCurrentFrame();
  const a = clampEase(frame / (0.5 * FPS));
  const b = clampEase((frame - 0.35 * FPS) / (0.5 * FPS));
  const out = interpolate(frame, [2.4 * FPS, 3 * FPS], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        padding: "0 140px",
        opacity: out,
      }}
    >
      <h1
        style={{
          fontFamily: FONTS.display,
          fontSize: 132,
          lineHeight: 0.94,
          letterSpacing: "-0.03em",
          color: COLORS.heading,
          margin: 0,
          transform: `translateY(${(1 - a) * 40}px)`,
          opacity: a,
        }}
      >
        {top}
      </h1>
      <h1
        style={{
          fontFamily: FONTS.display,
          fontSize: 132,
          lineHeight: 0.94,
          letterSpacing: "-0.03em",
          color: COLORS.muted,
          margin: 0,
          transform: `translateY(${(1 - b) * 40}px)`,
          opacity: b,
        }}
      >
        {bottom}
      </h1>
    </AbsoluteFill>
  );
}

function ClampScene() {
  const frame = useCurrentFrame();
  // The jaws close in three deliberate cranks rather than one smooth slide:
  // a vise is turned by hand, and the stepping is what sells it as mechanical.
  const steps = [0.0, 0.34, 0.34, 0.68, 0.68, 1.0];
  const t = frame / (5 * FPS);
  const index = Math.min(Math.floor(t * steps.length), steps.length - 1);
  const local = t * steps.length - index;
  const from = steps[index];
  const to = steps[Math.min(index + 1, steps.length - 1)];
  const grip = from + (to - from) * clampEase(local);

  const days = daysFor(grip);
  const multiplier = multiplierFor(days);
  const shake = index % 2 === 1 ? Math.sin(frame * 2.4) * (1 - local) * 3 : 0;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ transform: `translateX(${shake}px)` }}>
        <Vise grip={grip} width={1180} />
      </div>

      <div
        style={{
          position: "absolute",
          top: 120,
          left: 140,
          fontFamily: FONTS.mono,
        }}
      >
        <Rule>Lock term</Rule>
        <div style={{ fontSize: 96, color: COLORS.heading, lineHeight: 1 }}>
          {days}
          <span style={{ fontSize: 40, color: COLORS.muted }}>d</span>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 120,
          right: 140,
          textAlign: "right",
          fontFamily: FONTS.mono,
        }}
      >
        <Rule align="right">Your weight</Rule>
        <div style={{ fontSize: 96, color: COLORS.torch, lineHeight: 1 }}>
          {multiplier}×
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 120,
          fontFamily: FONTS.sans,
          fontSize: 34,
          color: COLORS.body,
        }}
      >
        The tighter you clamp, the bigger your cut of every trade.
      </div>
    </AbsoluteFill>
  );
}

function Logo() {
  const frame = useCurrentFrame();
  const a = clampEase(frame / (0.6 * FPS));
  const scale = 0.94 + a * 0.06;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ transform: `scale(${scale})`, textAlign: "center" }}>
        <div style={{ opacity: a }}>
          <Vise grip={0.92} width={520} showScrew={false} />
        </div>
        <div
          style={{
            fontFamily: FONTS.display,
            fontSize: 176,
            letterSpacing: "-0.04em",
            color: COLORS.heading,
            marginTop: 40,
            opacity: a,
          }}
        >
          VISE
        </div>
        <div
          style={{
            fontFamily: FONTS.sans,
            fontSize: 40,
            color: COLORS.torch,
            marginTop: 8,
            opacity: clampEase((frame - 0.5 * FPS) / (0.6 * FPS)),
          }}
        >
          Hold under pressure.
        </div>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 26,
            color: COLORS.muted,
            marginTop: 36,
            letterSpacing: "0.18em",
            opacity: clampEase((frame - 1.1 * FPS) / (0.6 * FPS)),
          }}
        >
          VISE.FUN
        </div>
      </div>
    </AbsoluteFill>
  );
}
