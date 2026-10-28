import { AbsoluteFill } from "remotion";
import { Chart, Dream, Mark } from "../kit";
import { COLORS, FONTS } from "../theme";
import { Ground } from "./common";

/**
 * X avatar, 400×400. X crops to a circle: the mark's farthest corner sits at
 * 0.59 × its size from centre, so a 270 px mark stays 40 px inside the circle.
 */
export function XAvatar() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, justifyContent: "center", alignItems: "center" }}>
      <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 50%, rgba(94,233,181,0.16) 0%, rgba(140,200,220,0.06) 38%, transparent 62%)" }} />
      <div style={{ filter: "drop-shadow(0 10px 30px rgba(0,0,0,0.45))" }}>
        <Mark size={270} id="xavatar" />
      </div>
    </AbsoluteFill>
  );
}

/**
 * X banner, 1500×500. The avatar overlaps the lower-left (~400×200), so it
 * stays empty; the copy sits in the vertical middle for the mobile crop.
 */
export function XBanner() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Ground glowX={74} glowY={50} glow={1} grain={false} />
      <div style={{ position: "absolute", right: 44, top: 120, opacity: 0.55 }}>
        <Chart width={250} height={240} calm={1} line={1} count={18} />
      </div>
      <div style={{ position: "absolute", left: 430, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 62, lineHeight: 1.04, letterSpacing: "-0.035em" }}>
          <Dream>Imagine</Dream> everyone locks.
        </div>
        <div style={{ marginTop: 18, fontWeight: 600, fontSize: 34, letterSpacing: "-0.015em", color: COLORS.fgSoft }}>Lock the meme. Earn its pair.</div>
        <div style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 14 }}>
          <Mark size={34} id="xbanner" />
          <span style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 26, color: COLORS.fg, letterSpacing: "0.04em" }}>imagine.fun</span>
        </div>
      </div>
    </AbsoluteFill>
  );
}
