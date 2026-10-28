import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Backdrop, Card, Chart, Dial, Dream, Eyebrow, FeeFlow, FLOW_W, Grain, Mark, PairPill, Wordmark, appear, fadeOut } from "./kit";
import { COLORS, DAY, FONTS, HOUR, durationLabel, ease, easeInOut, multiplierFor, s } from "./theme";

/**
 * The film, 58 s at 1920×1080. Cuts sit on the score's bars (96 BPM, 2.5 s):
 * the dump 0–7.5, "Imagine nobody sold" 7.5–12.5, the dial 12.5–22.5, the fee
 * path 22.5–30, lockers paid in the pair 30–35, StonkFun pairs 35–42.5, the
 * rules 42.5–50, the mark 50–58.
 */
export const PROMO_DURATION = s(58);

const SCENES = {
  chart: [0, 12.5],
  dial: [12.5, 22.5],
  flow: [22.5, 30],
  lockers: [30, 35],
  pairs: [35, 42.5],
  rules: [42.5, 50],
  close: [50, 58],
} as const;

export function Promo() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Audio src={staticFile("promo.wav")} />
      <Scene at={SCENES.chart}>
        <ChartScene />
      </Scene>
      <Scene at={SCENES.dial}>
        <DialScene />
      </Scene>
      <Scene at={SCENES.flow}>
        <FlowScene />
      </Scene>
      <Scene at={SCENES.lockers}>
        <LockersScene />
      </Scene>
      <Scene at={SCENES.pairs}>
        <PairsScene />
      </Scene>
      <Scene at={SCENES.rules}>
        <RulesScene />
      </Scene>
      <Scene at={SCENES.close} last>
        <CloseScene />
      </Scene>
      <Grain />
    </AbsoluteFill>
  );
}

/** A cut with a short dip: fades in over 10 frames, out over the last 10. */
export function Scene({ at, last = false, children }: { at: readonly [number, number]; last?: boolean; children: React.ReactNode }) {
  const length = s(at[1] - at[0]);
  return (
    <Sequence from={s(at[0])} durationInFrames={length}>
      <Dip length={length} last={last}>
        {children}
      </Dip>
    </Sequence>
  );
}

function Dip({ length, last, children }: { length: number; last: boolean; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = Math.min(ease(frame / 10), last ? 1 : fadeOut(frame, length - 10, 10));
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

const headline: React.CSSProperties = { fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.02 };

/** `speed` > 1 plays the same beats faster (the teaser runs it in 10 s). */
export function ChartScene({ speed = 1 }: { speed?: number }) {
  const frame = useCurrentFrame() * speed;
  const reveal = easeInOut(frame / s(6.2));
  const calm = easeInOut((frame - s(8)) / s(3.6));
  const firstOut = fadeOut(frame, s(6.6), 12);
  return (
    <AbsoluteFill>
      <Backdrop glow={0.15 + calm * 0.85} glowX={72} glowY={45} />
      <div style={{ position: "absolute", left: 120, top: 0, bottom: 0, width: 680, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ position: "relative", height: 420 }}>
          <div style={{ position: "absolute", inset: 0, opacity: firstOut }}>
            <div style={appear(frame, 6)}>
              <Eyebrow>A meme, paired with a stock</Eyebrow>
            </div>
            <div style={{ ...headline, fontSize: 92, marginTop: 28, ...appear(frame, 14) }}>You know how this chart ends.</div>
            <div style={{ fontSize: 30, lineHeight: 1.4, color: COLORS.fgSoft, marginTop: 30, ...appear(frame, s(3.6)) }}>
              Everyone sells. The holders who stayed pay for it.
            </div>
          </div>
          <div style={{ position: "absolute", inset: 0 }}>
            <div style={appear(frame, s(7.6))}>
              <Eyebrow>Now</Eyebrow>
            </div>
            <div style={{ ...headline, fontSize: 104, marginTop: 28, ...appear(frame, s(7.8)) }}>
              Imagine <Dream>nobody sold.</Dream>
            </div>
            <div style={{ fontSize: 30, lineHeight: 1.4, color: COLORS.fgSoft, marginTop: 30, ...appear(frame, s(9.6)) }}>
              Same buyers. No rush for the exit.
            </div>
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 880, top: 170, ...appear(frame, 0, 20, 40) }}>
        <Card style={{ width: 920, padding: "34px 40px 40px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 30 }}>$MEME</div>
              <PairPill ticker="NVDAx" size={20} />
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 17, letterSpacing: "0.18em", color: COLORS.muted }}>ILLUSTRATIVE</div>
          </div>
          <Chart width={840} height={560} calm={calm} reveal={reveal} line={calm} />
        </Card>
      </div>
    </AbsoluteFill>
  );
}

function DialScene() {
  const frame = useCurrentFrame();
  const commitment = easeInOut((frame - s(1.4)) / s(5.6));
  return (
    <AbsoluteFill>
      <Backdrop glow={0.4 + commitment * 0.6} glowX={30} glowY={50} />
      <div style={{ position: "absolute", left: 170, top: 190, ...appear(frame, 0, 20, 30) }}>
        <Dial size={700} commitment={commitment} />
      </div>
      <div style={{ position: "absolute", left: 1000, right: 120, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={appear(frame, 8)}>
          <Eyebrow>Commit</Eyebrow>
        </div>
        <div style={{ ...headline, fontSize: 96, marginTop: 26, ...appear(frame, 14) }}>
          Imagine <Dream>everyone locks.</Dream>
        </div>
        <div style={{ fontSize: 32, lineHeight: 1.4, color: COLORS.fgSoft, marginTop: 34, ...appear(frame, s(2.4)) }}>
          Lock your coins for four hours or a full year. Lock longer, earn a bigger cut.
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 40, ...appear(frame, s(5)) }}>
          {[4 * HOUR, 30 * DAY, 365 * DAY].map((secs) => (
            <div key={secs} style={{ fontFamily: FONTS.mono, fontSize: 24, padding: "12px 22px", borderRadius: 999, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.fgSoft }}>
              {durationLabel(secs)} <span style={{ color: COLORS.mint }}>{multiplierFor(secs)}×</span>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function FlowScene() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop glow={0.6} glowX={55} glowY={60} />
      <div style={{ position: "absolute", left: 120, top: 120, right: 120 }}>
        <div style={appear(frame, 4)}>
          <Eyebrow>The stream</Eyebrow>
        </div>
        <div style={{ ...headline, fontSize: 78, marginTop: 22, ...appear(frame, 10) }}>Every trade pays the people who lock.</div>
      </div>
      <div style={{ position: "absolute", left: (1920 - FLOW_W) / 2, top: 430 }}>
        <FeeFlow reveal={(frame - s(0.8)) / s(1.1)} flow={frame} />
      </div>
      <div style={{ position: "absolute", left: 120, bottom: 70, fontSize: 24, color: COLORS.muted, ...appear(frame, s(5)) }}>
        StonkFun forwards a creator share to each coin's creator address. For IMAGINE coins, that address is the pool vault.
      </div>
    </AbsoluteFill>
  );
}

const LOCKERS = [
  { days: 365, pair: "NVDAx", share: 1 },
  { days: 90, pair: "NVDAx", share: 0.61 },
  { days: 30, pair: "SPYx", share: 0.44 },
];

function LockersScene() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop glow={0.8} glowX={50} glowY={40} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 190, textAlign: "center" }}>
        <div style={{ ...headline, fontSize: 112, ...appear(frame, 4) }}>
          Lock the meme. <Dream>Earn the stock.</Dream>
        </div>
        <div style={{ fontSize: 32, color: COLORS.fgSoft, marginTop: 28, ...appear(frame, 18) }}>Paid in NVDAx, not promises.</div>
      </div>
      <div style={{ position: "absolute", left: 160, right: 160, top: 600, display: "flex", gap: 40 }}>
        {LOCKERS.map((locker, i) => {
          const fill = ease((frame - 24 - i * 6) / s(3)) * locker.share;
          return (
            <div key={locker.days} style={{ flex: 1, ...appear(frame, 20 + i * 6) }}>
              <Card style={{ padding: "34px 36px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 22, letterSpacing: "0.16em", color: COLORS.muted }}>LOCKER</div>
                  <PairPill ticker={locker.pair} size={19} label="Earns" />
                </div>
                <div style={{ marginTop: 30, display: "flex", alignItems: "baseline", gap: 18 }}>
                  <span style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 64 }}>{locker.days}d</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 34, color: COLORS.mint }}>{multiplierFor(locker.days * DAY)}×</span>
                </div>
                <div style={{ marginTop: 30, height: 14, borderRadius: 999, background: COLORS.ink4, overflow: "hidden" }}>
                  <div style={{ width: `${fill * 100}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #8CC8DC, #5EE9B5)" }} />
                </div>
                <div style={{ marginTop: 14, fontSize: 21, color: COLORS.fgSoft }}>Share of the stream, by weight</div>
              </Card>
            </div>
          );
        })}
      </div>
      <Stream frame={frame} />
    </AbsoluteFill>
  );
}

/** Pair tokens drifting down into the locker cards. */
function Stream({ frame }: { frame: number }) {
  const columns = [430, 960, 1490];
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {columns.flatMap((x, c) =>
        [0, 1, 2].map((k) => {
          const t = ((frame + k * 22 + c * 9) % 66) / 66;
          const label = c === 2 ? "SPYx" : "NVDAx";
          return (
            <div
              key={`${c}-${k}`}
              style={{
                position: "absolute",
                left: x - 52,
                top: 440 + t * 120,
                opacity: Math.sin(Math.PI * t) * ease((frame - 30) / 20),
                fontFamily: FONTS.mono,
                fontSize: 20,
                color: COLORS.ink,
                background: COLORS.mint,
                borderRadius: 999,
                padding: "4px 14px",
                width: 104,
                textAlign: "center",
                boxSizing: "border-box",
              }}
            >
              {label}
            </div>
          );
        }),
      )}
    </AbsoluteFill>
  );
}

const PAIRS = ["NVDAx", "SPYx", "TSLAx", "SOL", "USDC"];

function PairsScene() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop glow={0.55} glowX={50} glowY={70} />
      <div style={{ position: "absolute", left: 160, right: 160, top: 250 }}>
        <div style={appear(frame, 4)}>
          <Eyebrow>Launch</Eyebrow>
        </div>
        <div style={{ ...headline, fontSize: 96, marginTop: 26, ...appear(frame, 10) }}>
          Coins launch on StonkFun,
          <br />
          <Dream>paired with any stock.</Dream>
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 70, flexWrap: "wrap" }}>
          {PAIRS.map((ticker, i) => (
            <div key={ticker} style={appear(frame, s(1.4) + i * 7, 16, 18)}>
              <PairPill ticker={ticker} size={32} label={i === 0 ? "Paired with" : null} />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 30, lineHeight: 1.45, color: COLORS.fgSoft, marginTop: 64, maxWidth: 1300, ...appear(frame, s(3.4)) }}>
          Raydium LaunchLab under the hood. A coin paired with NVDAx pays its lockers NVDAx. A SOL pair pays SOL.
        </div>
      </div>
    </AbsoluteFill>
  );
}

const RULES = [
  ["Terms frozen per pool", "Set at launch, never rewritten."],
  ["No admin withdraw path", "The instruction does not exist."],
  ["Claims can't be paused", "Unlocks neither."],
  ["Creator locks first", "The founding lock opens the pool."],
];

function RulesScene() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop glow={0.35} glowX={20} glowY={30} />
      <div style={{ position: "absolute", left: 160, top: 150, width: 760 }}>
        <div style={appear(frame, 4)}>
          <Eyebrow>Built to hold</Eyebrow>
        </div>
        <div style={{ ...headline, fontSize: 92, marginTop: 26, ...appear(frame, 10) }}>The rules don't move.</div>
        <div style={{ fontSize: 30, lineHeight: 1.45, color: COLORS.fgSoft, marginTop: 34, ...appear(frame, 22) }}>
          Selling is free. It just costs you the stream.
        </div>
      </div>
      <div style={{ position: "absolute", left: 1000, right: 140, top: 170, display: "flex", flexDirection: "column", gap: 22 }}>
        {RULES.map(([title, sub], i) => (
          <div key={title} style={appear(frame, 26 + i * 9, 18, 20)}>
            <Card style={{ padding: "28px 34px", display: "flex", alignItems: "center", gap: 26 }}>
              <Mark size={46} id={`rule-${i}`} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em" }}>{title}</div>
                <div style={{ fontSize: 22, color: COLORS.fgSoft, marginTop: 6 }}>{sub}</div>
              </div>
            </Card>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

/** The mark builds (stem, then dot), then the lines. `speed` > 1 for short cuts. */
export function CloseScene({ scale = 1, speed = 1 }: { scale?: number; speed?: number }) {
  const frame = useCurrentFrame() * speed;
  const stem = ease((frame - 6) / 22);
  const dot = ease((frame - 22) / 16);
  const word = appear(frame, 36, 22, 16);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Backdrop glow={ease(frame / 40)} glowX={50} glowY={42} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${scale})` }}>
        <div style={{ filter: `drop-shadow(0 0 ${60 * dot}px rgba(94,233,181,0.45))` }}>
          <Mark size={200} stem={stem} dot={dot} id="close" />
        </div>
        <div style={{ marginTop: 56, ...word }}>
          <Wordmark size={150} />
        </div>
        <div style={{ ...headline, fontSize: 56, marginTop: 40, ...appear(frame, 58) }}>
          Imagine <Dream>everyone locks.</Dream>
        </div>
        <div style={{ fontSize: 30, color: COLORS.fgSoft, marginTop: 22, ...appear(frame, 72) }}>Lock the meme. Earn the stock.</div>
        <div style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 34, letterSpacing: "0.08em", color: COLORS.steelHi, marginTop: 48, ...appear(frame, 88) }}>
          imagine.fun
        </div>
      </div>
    </AbsoluteFill>
  );
}

