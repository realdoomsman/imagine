import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { Backdrop, Dream, Eyebrow, FeeFlow, FLOW_W, Grain, appear, fadeOut } from "./kit";
import { CloseScene, Scene } from "./Promo";
import { COLORS, FONTS, ease, s } from "./theme";

/**
 * 30 s: where a trade's fee goes, one column at a time, then the mark.
 * Steps land at 2.5, 7.5, 12.5 and 17.5 s (on the score's bars).
 */
export const EXPLAINER_DURATION = s(30);

const STEPS = [
  { at: 2.5, text: "Someone buys or sells an IMAGINE coin." },
  {
    at: 7.5,
    text: "imagine.fun adds a 1% app fee on trades it routes. StonkFun forwards a creator share to the coin's creator address, which for IMAGINE coins is the pool vault.",
  },
  { at: 12.5, text: "Both land in that coin's own vault. There is no admin withdraw path." },
  { at: 17.5, text: "90% streams to lockers by weight, paid in the coin's pair asset. 10% goes to the treasury." },
];

export function Explainer() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Audio src={staticFile("explainer.wav")} />
      <Scene at={[0, 22.5]}>
        <FlowExplained />
      </Scene>
      <Scene at={[22.5, 30]} last>
        <CloseScene />
      </Scene>
      <Grain />
    </AbsoluteFill>
  );
}

function FlowExplained() {
  const frame = useCurrentFrame();
  // Step k lights column k-1; before the first step nothing is on screen.
  const reveal = STEPS.reduce((acc, step) => acc + ease((frame - s(step.at)) / 18), 0) - 1;
  return (
    <AbsoluteFill>
      <Backdrop glow={0.3 + reveal * 0.15} glowX={60} glowY={55} />
      <div style={{ position: "absolute", left: 120, top: 100 }}>
        <div style={appear(frame, 4)}>
          <Eyebrow>Where the fee goes</Eyebrow>
        </div>
        <div style={{ fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.02, fontSize: 80, marginTop: 22, ...appear(frame, 10) }}>
          One trade, <Dream>followed all the way.</Dream>
        </div>
      </div>
      <div style={{ position: "absolute", left: (1920 - FLOW_W) / 2, top: 360 }}>
        <FeeFlow reveal={reveal} flow={frame} />
      </div>
      <div style={{ position: "absolute", left: 120, right: 120, bottom: 90, height: 110 }}>
        {STEPS.map((step, i) => {
          const next = STEPS[i + 1];
          const opacity = Math.min(ease((frame - s(step.at)) / 14), next ? fadeOut(frame, s(next.at) - 8, 8) : 1);
          return (
            <div key={step.at} style={{ position: "absolute", inset: 0, display: "flex", gap: 28, alignItems: "flex-start", opacity }}>
              <div style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 28, color: COLORS.mint, paddingTop: 4 }}>0{i + 1}</div>
              <div style={{ fontSize: 36, lineHeight: 1.35, color: COLORS.fg, maxWidth: 1500 }}>{step.text}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
