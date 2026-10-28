import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Mark } from "../kit";
import { COLORS, FONTS, ease } from "../theme";
import { Crop, Cut, DreamLead, Ground, Shot } from "./common";

/**
 * p05: live https://imagine.fun/launch after the Raydium deploy, from the real
 * capture SOURCE (image 1.2 s, name 3.2, Stocks 13.2, list scroll 15.5, ETFs
 * 18.7, "SPY" 21.3, SPYx 23.3, first buy 28.0, lock % 31.2, 4h 32.8, dial to
 * 30d 34.9–37.0, fees 41.9). Each segment's `from` is seconds into SOURCE. Nothing is signed: the cut ends on the fee list,
 * before any wallet.
 */

type Seg = { from: number; rate: number; length: number; crop: Array<[number, Crop]>; step: number };

const COIN: Crop = { x: 760, y: 370, w: 1080 };
const PICKER: Crop = { x: 790, y: 420, w: 1250 };
const PILL: Crop = { x: 720, y: 360, w: 1000 };
const BUY: Crop = { x: 790, y: 380, w: 1150 };
const DIAL: Crop = { x: 760, y: 400, w: 980 };
const FEES: Crop = { x: 800, y: 390, w: 1150 };
// "Where the stream goes: 90% lockers · 10% treasury · 0% creator", beside the first buy.
const STREAM: Crop = { x: 900, y: 290, w: 760 };

const SOURCE = "launch-walk-live.mp4";

const INTRO = 40;
const SEGS: Seg[] = [
  { from: 0.6, rate: 1.5, length: 108, step: 1, crop: [[0, COIN], [1, { ...COIN, w: 1020 }]] },
  { from: 12.9, rate: 1.9, length: 152, step: 2, crop: [[0, PICKER], [1, PICKER]] },
  { from: 22.9, rate: 1.0, length: 66, step: 2, crop: [[0, PICKER], [0.5, PILL], [1, PILL]] },
  { from: 27.5, rate: 2.0, length: 123, step: 3, crop: [[0, BUY], [1, BUY]] },
  { from: 34.6, rate: 1.4, length: 90, step: 3, crop: [[0, BUY], [0.4, DIAL], [1, DIAL]] },
  { from: 38.9, rate: 1.0, length: 54, step: 3, crop: [[0, DIAL], [0.45, STREAM], [1, STREAM]] },
  { from: 42.6, rate: 1.0, length: 100, step: 4, crop: [[0, FEES], [1, { ...FEES, w: 1100 }]] },
];

const END = 66;
const XFADE = 6;

const STARTS = SEGS.reduce<number[]>((acc, seg, i) => [...acc, i === 0 ? INTRO : acc[i - 1] + SEGS[i - 1].length], []);
const BODY_END = STARTS[STARTS.length - 1] + SEGS[SEGS.length - 1].length;
export const P05_FRAMES = BODY_END + END;

const STEPS: Record<number, { title: string; sub: string }> = {
  1: { title: "Name, ticker, image", sub: "Moon Cube · CUBE" },
  2: { title: "Pick the pair", sub: "SOL, USDC, tokenized stocks like NVDAx and SPYx" },
  3: { title: "First buy and founding lock", sub: "Lock at least 10% of your first buy" },
  4: { title: "One transaction, on Raydium", sub: "The coin on Raydium LaunchLab, your buy, your founding lock. Pool fee 0.05 SOL." },
};

function Caption({ step, local, length }: { step: number; local: number; length: number }) {
  const t = ease(local / 10);
  const out = 1 - ease((local - (length - 8)) / 8);
  const { title, sub } = STEPS[step];
  return (
    <div
      style={{
        position: "absolute",
        left: 64,
        bottom: 60,
        display: "flex",
        alignItems: "center",
        gap: 26,
        padding: "22px 34px 22px 22px",
        borderRadius: 22,
        background: "rgba(11,23,27,0.94)",
        border: `1px solid ${COLORS.lineStrong}`,
        boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
        opacity: t * out,
        transform: `translateY(${(1 - t) * 14}px)`,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          background: "linear-gradient(120deg, #8CC8DC 0%, #5EE9B5 55%, #C7F9E5 100%)",
          color: COLORS.ink,
          fontFamily: FONTS.mono,
          fontWeight: 500,
          fontSize: 40,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {step}
      </div>
      <div>
        <div style={{ fontFamily: FONTS.sans, fontWeight: 700, fontSize: 44, color: COLORS.fg, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{title}</div>
        <div style={{ marginTop: 8, fontFamily: FONTS.sans, fontWeight: 400, fontSize: 26, color: COLORS.fgSoft }}>{sub}</div>
      </div>
    </div>
  );
}

function Captions() {
  const frame = useCurrentFrame();
  // Merge consecutive segments of the same step into one caption span.
  const spans: Array<{ step: number; start: number; end: number }> = [];
  SEGS.forEach((seg, i) => {
    const last = spans[spans.length - 1];
    if (last && last.step === seg.step) last.end = STARTS[i] + seg.length;
    else spans.push({ step: seg.step, start: STARTS[i], end: STARTS[i] + seg.length });
  });
  const span = spans.find((s) => frame >= s.start && frame < s.end);
  if (!span) return null;
  return <Caption step={span.step} local={frame - span.start} length={span.end - span.start} />;
}

/** Bottom-right honesty tag: it's the live page, and the cut stops before signing. */
function LiveTag() {
  const frame = useCurrentFrame();
  const o = Math.min(1, (frame - INTRO) / 10) * Math.min(1, (BODY_END - frame) / 8);
  if (o <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        right: 64,
        bottom: 60,
        padding: "12px 20px",
        borderRadius: 999,
        background: "rgba(11,23,27,0.9)",
        border: `1px solid ${COLORS.lineStrong}`,
        fontFamily: FONTS.mono,
        fontSize: 22,
        letterSpacing: "0.08em",
        color: COLORS.fgSoft,
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity: o,
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: 999, background: COLORS.mint, boxShadow: `0 0 10px ${COLORS.mint}` }} />
      Live site · stops before signing
    </div>
  );
}

function Intro() {
  const frame = useCurrentFrame();
  const t = ease(frame / 12);
  const out = 1 - ease((frame - INTRO) / XFADE);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: out }}>
      <Ground glowX={50} glowY={45} glow={0.8} />
      <div style={{ opacity: t, transform: `translateY(${(1 - t) * 16}px)`, textAlign: "center" }}>
        <div style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: 96, lineHeight: 1.06, letterSpacing: "-0.035em", color: COLORS.fg }}>Launching a coin</div>
        <div style={{ marginTop: 22, fontFamily: FONTS.mono, fontWeight: 500, fontSize: 40, color: COLORS.fgSoft, letterSpacing: "0.04em" }}>on imagine.fun</div>
      </div>
    </AbsoluteFill>
  );
}

function EndCard() {
  const frame = useCurrentFrame();
  const t = ease(frame / 14);
  const t2 = ease((frame - 6) / 16);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: Math.min(1, frame / XFADE) }}>
      <Ground glowX={50} glowY={42} glow={0.9} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
        <div style={{ opacity: t, transform: `scale(${0.9 + 0.1 * t})` }}>
          <Mark size={130} id="p05-end" />
        </div>
        <div style={{ opacity: t2, transform: `translateY(${(1 - t2) * 16}px)`, textAlign: "center" }}>
          <div style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: 68, lineHeight: 1.1, letterSpacing: "-0.03em", color: COLORS.fg }}>One transaction.</div>
          <DreamLead lead="Nobody can lock before you do." rest="" size={68} />
          <div style={{ marginTop: 34, fontFamily: FONTS.mono, fontWeight: 500, fontSize: 40, color: COLORS.fgSoft, letterSpacing: "0.04em" }}>imagine.fun</div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function P05() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink }}>
      {SEGS.map((seg, i) => {
        // Each cut runs XFADE frames under the next one (or the end card), which fades in over it.
        const length = seg.length + XFADE;
        return (
          <Cut key={i} at={STARTS[i]} length={length}>
            <Shot src={SOURCE} url="imagine.fun/launch" from={seg.from} rate={seg.rate} durationInFrames={length} crop={seg.crop} fadeIn={i === 0 ? 0 : XFADE} />
          </Cut>
        );
      })}
      <Captions />
      <LiveTag />
      <Cut at={0} length={INTRO + XFADE}>
        <Intro />
      </Cut>
      <Cut at={BODY_END} length={END}>
        <EndCard />
      </Cut>
    </AbsoluteFill>
  );
}
