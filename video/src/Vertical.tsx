import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { Backdrop, Card, Chart, Dial, Dream, Eyebrow, Grain, PairPill, appear, fadeOut } from "./kit";
import { CloseScene, Scene } from "./Promo";
import { COLORS, FONTS, easeInOut, s } from "./theme";

/** 15 s at 1080×1920 for X and TikTok: dump, heal, commit, mark. */
export const VERTICAL_DURATION = s(15);

const headline: React.CSSProperties = { fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.04 };

export function Vertical() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Audio src={staticFile("vertical.wav")} />
      <Scene at={[0, 7.5]}>
        <ChartBeat />
      </Scene>
      <Scene at={[7.5, 11.25]}>
        <DialBeat />
      </Scene>
      <Scene at={[11.25, 15]} last>
        <CloseScene scale={0.9} speed={1.5} />
      </Scene>
      <Grain />
    </AbsoluteFill>
  );
}

function ChartBeat() {
  const frame = useCurrentFrame();
  const reveal = easeInOut(frame / s(3.2));
  const calm = easeInOut((frame - s(3.8)) / s(2.6));
  return (
    <AbsoluteFill>
      <Backdrop glow={0.15 + calm * 0.85} glowX={50} glowY={65} />
      <div style={{ position: "absolute", left: 90, right: 90, top: 260, height: 420 }}>
        <div style={{ position: "absolute", inset: 0, opacity: fadeOut(frame, s(3.3), 10) }}>
          <div style={appear(frame, 4)}>
            <Eyebrow size={26}>A meme, paired with a stock</Eyebrow>
          </div>
          <div style={{ ...headline, fontSize: 104, marginTop: 30, ...appear(frame, 10) }}>You know how this chart ends.</div>
        </div>
        <div style={{ position: "absolute", inset: 0 }}>
          <div style={appear(frame, s(3.5))}>
            <Eyebrow size={26}>Now</Eyebrow>
          </div>
          <div style={{ ...headline, fontSize: 116, marginTop: 30, ...appear(frame, s(3.7)) }}>
            Imagine <Dream>nobody sold.</Dream>
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 820, ...appear(frame, 0, 20, 40) }}>
        <Card style={{ padding: "32px 34px 36px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 30 }}>$MEME</div>
              <PairPill ticker="NVDAx" size={20} />
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 17, letterSpacing: "0.18em", color: COLORS.muted }}>ILLUSTRATIVE</div>
          </div>
          <Chart width={890} height={760} calm={calm} reveal={reveal} line={calm} count={36} />
        </Card>
      </div>
    </AbsoluteFill>
  );
}

function DialBeat() {
  const frame = useCurrentFrame();
  const commitment = easeInOut((frame - 8) / s(2.6));
  return (
    <AbsoluteFill>
      <Backdrop glow={0.4 + commitment * 0.6} glowX={50} glowY={62} />
      <div style={{ position: "absolute", left: 90, right: 90, top: 250 }}>
        <div style={{ ...headline, fontSize: 116, ...appear(frame, 4) }}>Lock the meme.</div>
        <div style={{ ...headline, fontSize: 116, ...appear(frame, 14) }}>
          <Dream>Earn the stock.</Dream>
        </div>
        <div style={{ fontSize: 36, lineHeight: 1.4, color: COLORS.fgSoft, marginTop: 36, ...appear(frame, 24) }}>
          Every trade pays the holders who lock, in the stock it's paired with.
        </div>
      </div>
      <div style={{ position: "absolute", left: 165, top: 900, ...appear(frame, 6, 20, 30) }}>
        <Dial size={750} commitment={commitment} />
      </div>
    </AbsoluteFill>
  );
}
