import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Mark } from "../kit";
import { COLORS, FONTS, ease } from "../theme";
import { Crop, Cut, DreamLead, Ground, Shot } from "./common";

/**
 * p01: the live homepage hero, "Imagine the chart", from the real capture
 * SOURCE (slider at 0% for the first ~17 s, then dragged 0→100%). Recorded
 * after the Raydium site deploy; set SELL_FROM / DRAG_FROM to its timings.
 * Title card, the sell-off, the drag with a push into the chart card (the
 * site's own ILLUSTRATIVE label stays in frame), then the end card.
 */

// The hero card spans x 372–1548, y 96–863 of the capture; the chart card x 997–1491, y 209–750.
const WIDE: Crop = { x: 960, y: 480, w: 1520 };
const SETTLE: Crop = { x: 962, y: 480, w: 1400 };
// Tightest frame that still holds the whole headline (x ≥ 430) and the chart card.
const CHART: Crop = { x: 962, y: 482, w: 1090 };

const SOURCE = "hero-long-v2.mp4";
const SELL_FROM = 3.0; // seconds into SOURCE: the sell-off at 0%
const DRAG_FROM = 17.6; // seconds into SOURCE: just before the drag starts

const TITLE = 66;
const SELL = 150;
const DRAG = 294;
const END = 80;
const XFADE = 10;

export const P01_FRAMES = TITLE + SELL + DRAG + END;

function TitleCard({ length }: { length: number }) {
  const frame = useCurrentFrame();
  const t = ease(frame / 16);
  const out = 1 - ease((frame - (length - XFADE)) / XFADE);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: out }}>
      <Ground glowX={50} glowY={45} glow={0.8} />
      <div style={{ opacity: t, transform: `translateY(${(1 - t) * 18}px)`, textAlign: "center" }}>
        <DreamLead lead="Imagine" rest=" the chart" size={118} />
        <DreamLead lead="" rest="if nobody sold." size={118} />
      </div>
    </AbsoluteFill>
  );
}

function EndCard() {
  const frame = useCurrentFrame();
  const t = ease(frame / 14);
  const t2 = ease((frame - 8) / 16);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: Math.min(1, frame / XFADE) }}>
      <Ground glowX={50} glowY={42} glow={0.9} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 44 }}>
        <div style={{ opacity: t, transform: `scale(${0.9 + 0.1 * t})` }}>
          <Mark size={150} id="p01-end" />
        </div>
        <div style={{ opacity: t2, transform: `translateY(${(1 - t2) * 16}px)`, textAlign: "center" }}>
          <DreamLead lead="Imagine" rest=" the chart if nobody sold." size={76} />
          <div style={{ marginTop: 34, fontFamily: FONTS.mono, fontWeight: 500, fontSize: 40, color: COLORS.fgSoft, letterSpacing: "0.04em" }}>Launched on Raydium · imagine.fun</div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function P01() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink }}>
      <Cut at={TITLE - XFADE} length={SELL + XFADE}>
        <Shot
          src={SOURCE}
          from={SELL_FROM - XFADE / 30}
          durationInFrames={SELL + XFADE}
          crop={[
            [0, WIDE],
            [1, SETTLE],
          ]}
        />
      </Cut>
      <Cut at={TITLE + SELL - XFADE} length={DRAG + 2 * XFADE}>
        <Shot
          src={SOURCE}
          from={DRAG_FROM - XFADE / 30}
          durationInFrames={DRAG + 2 * XFADE}
          fadeIn={XFADE}
          crop={[
            [0, SETTLE],
            [0.12, SETTLE],
            [0.62, CHART],
            [1, CHART],
          ]}
        />
      </Cut>
      <Cut at={0} length={TITLE}>
        <TitleCard length={TITLE} />
      </Cut>
      <Cut at={TITLE + SELL + DRAG} length={END}>
        <EndCard />
      </Cut>
    </AbsoluteFill>
  );
}
