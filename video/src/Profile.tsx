import { AbsoluteFill } from "remotion";
import { Knurl } from "./chrome";
import { COLORS, FONTS } from "./theme";
import { Vise } from "./Vise";

/**
 * The X profile assets: a 400×400 avatar and a 1500×500 banner.
 *
 * The avatar is the wordmark's jaw glyph alone — two bars, a gap, torch
 * orange — because at 48px a full vise is mud. The banner gets the mechanism
 * and the line.
 */
export function Avatar() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ground, justifyContent: "center", alignItems: "center" }}>
      <Knurl />
      <div style={{ display: "flex", gap: 22 }}>
        <div style={{ width: 88, height: 200, background: COLORS.torch }} />
        <div style={{ width: 88, height: 200, background: COLORS.torch }} />
      </div>
    </AbsoluteFill>
  );
}

export function Banner() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ground, fontFamily: FONTS.sans }}>
      <Knurl />
      <div style={{ position: "absolute", left: 90, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 92, lineHeight: 0.98, letterSpacing: "-0.04em", color: COLORS.heading }}>
          <div>Hold under</div>
          <div style={{ color: COLORS.torch }}>pressure.</div>
        </div>
        <div style={{ marginTop: 26, fontFamily: FONTS.mono, fontSize: 21, letterSpacing: "0.2em", textTransform: "uppercase", color: COLORS.muted }}>
          Lock-to-earn on pump.fun · vise.fun
        </div>
      </div>
      <div style={{ position: "absolute", right: 60, top: 40 }}>
        <Vise grip={1} width={720} />
      </div>
    </AbsoluteFill>
  );
}
