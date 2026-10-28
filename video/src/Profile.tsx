import { AbsoluteFill } from "remotion";
import { Backdrop, Chart, Dream, Mark } from "./kit";
import { COLORS, FONTS } from "./theme";

/** X avatar, 400×400: the mark alone on ink, so it reads at 48 px. */
export function Avatar() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, justifyContent: "center", alignItems: "center" }}>
      <Mark size={300} id="avatar" />
    </AbsoluteFill>
  );
}

/** X banner, 1500×500. The left third stays quiet: the avatar overlaps it. */
export function Banner() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Backdrop glow={0.9} glowX={80} glowY={50} />
      <div style={{ position: "absolute", right: 40, top: 80, opacity: 0.9 }}>
        <Chart width={420} height={340} calm={1} line={1} count={26} />
      </div>
      <div style={{ position: "absolute", left: 470, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 70, lineHeight: 1.04, letterSpacing: "-0.035em" }}>
          <div>Lock the meme.</div>
          <Dream>Earn its pair.</Dream>
        </div>
        <div style={{ marginTop: 24, fontFamily: FONTS.mono, fontSize: 20, letterSpacing: "0.16em", textTransform: "uppercase", color: COLORS.fgSoft }}>
          Lock-to-earn on StonkFun · imagine.fun
        </div>
      </div>
    </AbsoluteFill>
  );
}
