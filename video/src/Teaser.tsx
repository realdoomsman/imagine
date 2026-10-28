import { AbsoluteFill, Audio, staticFile } from "remotion";
import { Grain } from "./kit";
import { ChartScene, CloseScene, Scene } from "./Promo";
import { COLORS, FONTS, s } from "./theme";

/** 15 s: the chart dumps, then heals as nobody sells, then the mark. */
export const TEASER_DURATION = s(15);

export function Teaser() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Audio src={staticFile("teaser.wav")} />
      <Scene at={[0, 10]}>
        <ChartScene speed={1.25} />
      </Scene>
      <Scene at={[10, 15]} last>
        <CloseScene />
      </Scene>
      <Grain />
    </AbsoluteFill>
  );
}
