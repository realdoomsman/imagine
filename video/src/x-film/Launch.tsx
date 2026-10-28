import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Backdrop, Card, Chart, Dream, Eyebrow, Grain, Mark, PairPill, Wordmark, appear, candles } from "../kit";
import { COLORS, DAY, DREAM, FONTS, HOUR, LOCK_TERMS, ease, easeInOut, multiplierFor, s } from "../theme";
import { Chip, Footage } from "./Footage";
import DIAL from "./dial-track.json";
import TIMELINE from "./timeline.json";

/**
 * The launch film, 79.5 s at 1920×1080, cut to the voice-over in
 * timeline.json (the same file audio/score.py mixes from). Product footage is
 * real: the live site, and the local mainnet fork where a coin page is shown
 * (labelled on screen).
 */
export const LAUNCH_DURATION = s(TIMELINE.duration);

type SceneName = keyof typeof TIMELINE.scenes;
const SCENES = TIMELINE.scenes as Record<SceneName, [number, number]>;

/** Absolute time (s) of a voice cue. */
export function cue(id: string): number {
  const line = TIMELINE.vo.find((v) => v.id === id);
  if (!line) throw new Error(`no cue ${id}`);
  return line.at;
}

/** Local frame within `scene` for an absolute time in seconds. */
const at = (scene: SceneName, seconds: number) => s(seconds - SCENES[scene][0]);

const headline: React.CSSProperties = { fontFamily: FONTS.sans, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.02, color: COLORS.fg };

export function Launch() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Audio src={staticFile("launch.wav")} />
      <Shot name="open" fadeIn={false}>
        <OpenScene />
      </Shot>
      <Shot name="title">
        <TitleScene />
      </Shot>
      <Shot name="hero">
        <HeroScene />
      </Shot>
      <Shot name="pairs">
        <PairsScene />
      </Shot>
      <Shot name="fees">
        <FeesScene />
      </Shot>
      <Shot name="paid">
        <PaidScene />
      </Shot>
      <Shot name="curve">
        <CurveScene />
      </Shot>
      <Shot name="exit">
        <ExitScene />
      </Shot>
      <Shot name="rules">
        <RulesScene />
      </Shot>
      <Shot name="proof">
        <ProofScene />
      </Shot>
      <Shot name="end" last>
        <EndScene />
      </Shot>
      <Grain />
    </AbsoluteFill>
  );
}

function Shot({ name, fadeIn = true, last = false, children }: { name: SceneName; fadeIn?: boolean; last?: boolean; children: React.ReactNode }) {
  const [from, to] = SCENES[name];
  const length = s(to) - s(from);
  return (
    <Sequence from={s(from)} durationInFrames={length} name={name}>
      <Settle length={length} fadeIn={fadeIn} last={last}>
        {children}
      </Settle>
    </Sequence>
  );
}

/** Each cut lands with a short settle (fade + 3% scale) and leaves with a quick dip. */
function Settle({ length, fadeIn, last, children }: { length: number; fadeIn: boolean; last: boolean; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const inT = fadeIn ? ease(frame / 8) : 1;
  const outT = last ? 1 - ease((frame - (length - 14)) / 14) : 1 - ease((frame - (length - 6)) / 6);
  const settle = fadeIn ? 1.03 - 0.03 * ease(frame / 22) : 1;
  return <AbsoluteFill style={{ opacity: Math.min(inT, outT), transform: `scale(${settle})` }}>{children}</AbsoluteFill>;
}

/** Words that land one by one, each `step` frames apart from `start`. */
function Words({ text, start, step = 5, accentFrom }: { text: string; start: number; step?: number; accentFrom?: number }) {
  const frame = useCurrentFrame();
  return (
    <>
      {text.split(" ").map((word, i) => {
        const t = ease((frame - start - i * step) / 12);
        const content = accentFrom !== undefined && i >= accentFrom ? <Dream>{word}</Dream> : word;
        return (
          <span key={i} style={{ display: "inline-block", opacity: t, transform: `translateY(${(1 - t) * 0.35}em)`, marginRight: "0.24em" }}>
            {content}
          </span>
        );
      })}
    </>
  );
}

/** Crossfading text: shows `a` until `swap`, then `b`. */
function Swap({ swap, a, b }: { swap: number; a: React.ReactNode; b: React.ReactNode }) {
  const frame = useCurrentFrame();
  const out = ease((frame - swap) / 6);
  const t = ease((frame - swap - 5) / 10);
  return (
    <div style={{ position: "relative" }}>
      <div style={{ opacity: 1 - out, transform: `translateY(${-out * 14}px)` }}>{a}</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, opacity: t, transform: `translateY(${(1 - t) * 16}px)` }}>{b}</div>
    </div>
  );
}

// --- 1. cold open: the chart everyone knows ---------------------------------

const OPEN_COUNT = 56;

function OpenScene() {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const slam = s(cue("l03") + 2.6); // "…is to sell"
  const reveal = t < 7 ? 0.12 + 0.33 * easeInOut(t / 7) : 0.45 + 0.55 * easeInOut((t - 7) / 3.6);
  const data = candles(OPEN_COUNT, 0, 11);
  const shown = reveal * OPEN_COUNT;
  const last = data[Math.max(0, Math.ceil(shown) - 1)];
  const change = (last.close / data[0].open - 1) * 100;
  const sinceSlam = frame - slam;
  const shake = sinceSlam >= 0 && sinceSlam < 18 ? Math.sin(sinceSlam * 2.2) * 14 * Math.exp(-sinceSlam / 5) : 0;
  const push = 1 + 0.07 * easeInOut(t / 11);
  const chartW = 1480;
  const chartH = 560;
  const step = chartW / OPEN_COUNT;
  const lo = -0.35;
  const hi = 3.2;
  const y = (v: number) => chartH - ((v - lo) / (hi - lo)) * chartH;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at 60% 55%, rgba(251,113,133,${0.05 + 0.1 * ease((t - 7) / 3)}) 0%, transparent 70%)` }} />
      <Backdrop glow={0.12} glowX={70} glowY={40} />
      <AbsoluteFill style={{ transform: `translate(${shake}px, ${shake * 0.4}px) scale(${push})` }}>
        <div style={{ position: "absolute", left: 220, top: 330 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22, marginBottom: 26, ...appear(frame, 4, 16, 14) }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 34, fontWeight: 500 }}>$MEME</span>
            <PairPill ticker="NVDAx" size={20} />
            <span style={{ fontFamily: FONTS.mono, fontSize: 34, color: change >= 0 ? COLORS.mint : COLORS.rose, fontVariantNumeric: "tabular-nums" }}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(1)}%
            </span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 15, letterSpacing: "0.2em", color: COLORS.muted }}>ILLUSTRATIVE</span>
          </div>
          <div style={{ position: "relative" }}>
            <Chart width={chartW} height={chartH} calm={0} reveal={reveal} count={OPEN_COUNT} seed={11} />
            {/* every trade throws off a fee, and it flies away from the holders */}
            {Array.from({ length: 16 }, (_, k) => {
              // one fee every 0.42 s from the newest candle, flying off toward the corner
              const born = s(0.7) + k * 12.6;
              const life = (frame - born) / 40;
              if (life < 0 || life > 1 || born > s(7.4)) return null;
              const bornShown = (0.12 + 0.33 * easeInOut(born / 30 / 7)) * OPEN_COUNT;
              const c = data[Math.max(0, Math.ceil(bornShown) - 1)];
              return (
                <div
                  key={k}
                  style={{
                    position: "absolute",
                    left: (Math.ceil(bornShown) - 0.5) * step - 30,
                    top: y(c.high) - 46,
                    transform: `translate(${ease(life) * 900}px, ${-ease(life) * 140}px) scale(${1 - 0.3 * life})`,
                    opacity: Math.min(1, life * 6) * (1 - ease((life - 0.6) / 0.4)),
                    fontFamily: FONTS.mono,
                    fontWeight: 500,
                    fontSize: 20,
                    padding: "4px 12px",
                    borderRadius: 99,
                    color: COLORS.ink,
                    background: COLORS.steelHi,
                    boxShadow: "0 0 18px rgba(140,200,220,0.45)",
                  }}
                >
                  fee
                </div>
              );
            })}
            {[
              { x: 0.62, v: 2.2, d: 0 },
              { x: 0.74, v: 1.6, d: 4 },
              { x: 0.86, v: 1.0, d: 8 },
            ].map((o, i) => {
              const k = frame - slam - o.d;
              if (k < 0) return null;
              const pop = ease(k / 6);
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: o.x * chartW - 60,
                    top: y(o.v) - 30,
                    transform: `scale(${1.8 - 0.8 * pop})`,
                    opacity: pop,
                    padding: "8px 20px",
                    borderRadius: 10,
                    background: COLORS.rose,
                    color: COLORS.ink,
                    fontFamily: FONTS.mono,
                    fontWeight: 500,
                    fontSize: 24,
                    letterSpacing: "0.1em",
                    boxShadow: "0 0 40px rgba(251,113,133,0.55)",
                  }}
                >
                  SELL
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ position: "absolute", right: 150, top: 120, ...appear(frame, s(cue("l02")) + 6, 16, 14) }}>
          <Card style={{ padding: "18px 26px", opacity: t > 9.6 ? 0.5 : 1 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 15, letterSpacing: "0.18em", color: COLORS.muted }}>HOLDERS EARNED</div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 40, marginTop: 8, color: COLORS.fgSoft }}>
              0.0000 <span style={{ fontSize: 22, color: COLORS.muted }}>NVDAx</span>
            </div>
          </Card>
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 220, top: 120, width: 1300 }}>
        <Swap
          swap={s(cue("l03"))}
          a={
            <Swap
              swap={s(cue("l02"))}
              a={
                <div style={{ ...headline, fontSize: 72 }}>
                  <Words text="Every trade pays a fee." start={s(cue("l01")) + 2} />
                </div>
              }
              b={<div style={{ ...headline, fontSize: 72 }}>Almost none of it reaches holders.</div>}
            />
          }
          b={
            <div style={{ ...headline, fontSize: 72 }}>
              So holders get paid one way:{" "}
              <span style={{ color: COLORS.rose, opacity: ease((frame - slam + 2) / 6), display: "inline-block", transform: `scale(${1.25 - 0.25 * ease((frame - slam + 2) / 8)})` }}>
                they sell.
              </span>
            </div>
          }
        />
      </div>
      <AbsoluteFill style={{ background: COLORS.rose, opacity: sinceSlam >= 0 ? 0.16 * Math.exp(-sinceSlam / 4) : 0 }} />
    </AbsoluteFill>
  );
}

// --- 2. title ------------------------------------------------------------------

function TitleScene() {
  const frame = useCurrentFrame();
  const stem = ease((frame - 2) / 12);
  const dot = ease((frame - s(0.45)) / 10);
  const line = at("title", cue("l04"));
  const exit = ease((frame - s(2.65)) / 16);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Backdrop glow={0.3 + 0.7 * ease(frame / 40)} glowX={50} glowY={44} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${1 + 0.35 * exit})`, opacity: 1 - exit }}>
        <div style={{ filter: `drop-shadow(0 0 ${70 * dot}px rgba(94,233,181,0.5))`, transform: `scale(${1 + 0.04 * Math.sin(Math.min(1, frame / 30) * Math.PI)})` }}>
          <Mark size={190} stem={stem} dot={dot} id="title" />
        </div>
        <div style={{ ...headline, fontSize: 132, marginTop: 64, textAlign: "center" }}>
          <Words text="Imagine everyone locks." start={line} step={7} accentFrom={1} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

// --- 3. the live site ------------------------------------------------------------

function HeroScene() {
  const frame = useCurrentFrame();
  const enter = ease(frame / 18);
  return (
    <AbsoluteFill>
      <Backdrop glow={0.7} glowX={60} glowY={45} />
      <div style={{ position: "absolute", left: 180, top: 70, transform: `perspective(2200px) rotateX(${(1 - enter) * 9}deg) translateY(${(1 - enter) * 50}px)`, opacity: enter }}>
        <Footage
          src="hero-long-x2.5.mp4"
          startAt={18.0 / 2.5}
          width={1560}
          url="imagine.fun"
          badge={{ text: "live on mainnet", tone: "live" }}
          keys={[
            { at: 0, z: 1.0, x: 960, y: 470 },
            { at: s(1.6), z: 1.16, x: 960, y: 470 },
            { at: s(3.2), z: 1.2, x: 980, y: 480 },
          ]}
          spots={[{ from: s(0.7), to: s(3.1), rect: [1016, 527, 454, 64], dim: false }]}
        />
      </div>
      <div style={{ position: "absolute", left: 180, bottom: 26, ...appear(frame, 14, 14, 10) }}>
        <Chip>How many holders lock? · labelled simulation</Chip>
      </div>
    </AbsoluteFill>
  );
}

// --- 4. pairs on Raydium LaunchLab -------------------------------------------------------------

const PAIRS: Array<{ ticker: string; kind: string; word: number }> = [
  { ticker: "SOL", kind: "crypto", word: 0.46 },
  { ticker: "USDC", kind: "a stablecoin", word: 1.14 },
  { ticker: "NVDAx", kind: "tokenized stock", word: 3.94 },
  { ticker: "SPYx", kind: "tokenized ETF", word: 5.42 },
];

function PairsScene() {
  const frame = useCurrentFrame();
  const l06 = at("pairs", cue("l06"));
  // The recording starts 1.5 s in and plays at 1.43×, so NVDAx is picked as
  // the voice says it. Source second -> local frame:
  const rate = 1.43;
  const src = (sec: number) => s((sec - 1.5) / rate);
  return (
    <AbsoluteFill>
      <Backdrop glow={0.55} glowX={80} glowY={40} />
      <div style={{ position: "absolute", left: 90, top: 190, ...appear(frame, 0, 18, 30) }}>
        <Footage
          src="pair-picker-x1.43.mp4"
          startAt={1.5 / rate}
          width={1180}
          url="imagine.fun/launch"
          badge={{ text: "live on mainnet", tone: "live" }}
          keys={[
            { at: 0, z: 1.55, x: 731, y: 300 },
            { at: src(7.6), z: 1.55, x: 731, y: 300 },
            { at: src(9.2), z: 1.95, x: 735, y: 330 },
          ]}
          ripples={[
            { at: src(2.16) - 4, x: 486, y: 262 },
            { at: src(4.06) - 4, x: 570, y: 262 },
            { at: src(6.0) - 4, x: 653, y: 262 },
            { at: src(10.82) - 4, x: 728, y: 383 },
          ]}
          spots={[
            { from: src(10.95), to: s(10), rect: [624, 354, 209, 60] },
            { from: src(11.4), to: s(10), rect: [397, 436, 345, 28], dim: false },
          ]}
        />
      </div>
      <div style={{ position: "absolute", left: 1350, right: 80, top: 150 }}>
        <div style={appear(frame, 6)}>
          <Eyebrow size={19}>Launched on Raydium LaunchLab</Eyebrow>
        </div>
        <div style={{ ...headline, fontSize: 68, marginTop: 22, ...appear(frame, 12) }}>
          Paired with <Dream>anything.</Dream>
        </div>
        <div style={{ fontSize: 24, lineHeight: 1.45, color: COLORS.fgSoft, marginTop: 22, ...appear(frame, s(1.6)) }}>
          Paired with anything LaunchLab supports. Its lockers are paid in that pair.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 44 }}>
          {PAIRS.map((p) => {
            const t = ease((frame - l06 - s(p.word)) / 10);
            return (
              <div key={p.ticker} style={{ display: "flex", alignItems: "center", gap: 18, opacity: t, transform: `translateX(${(1 - t) * 40}px) scale(${0.94 + 0.06 * t})`, transformOrigin: "left center" }}>
                <PairPill ticker={p.ticker} size={30} label={null} />
                <span style={{ fontFamily: FONTS.mono, fontSize: 18, letterSpacing: "0.16em", textTransform: "uppercase", color: COLORS.muted }}>{p.kind}</span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// --- 5. where the fee goes ------------------------------------------------------------

/**
 * The fork's coin page while a buy is typed: where the imagine.fun app fee
 * shows up. `typed` is the recording second when the amount lands; `feeRow`
 * the fee line's rect.
 */
const FEE_CLIP = { src: "coin-page.mp4", typed: 3.5, feeRow: [1173, 694, 350, 28] as [number, number, number, number], focus: { x: 1350, y: 640 } };

function FeesScene() {
  const frame = useCurrentFrame();
  const L = (abs: number) => at("fees", abs);
  // diagram, then the product on "Trade on imagine.fun…", then back to the diagram
  const footIn = L(32.6);
  const footOut = L(35.6);
  const inFoot = ease((frame - footIn) / 8) * (1 - ease((frame - footOut) / 8));
  const beats = { anywhere: 4, app: footOut + 2, grad: L(31.2), lock: L(cue("l09")) };
  return (
    <AbsoluteFill>
      <Backdrop glow={0.6} glowX={50} glowY={55} />
      <AbsoluteFill style={{ opacity: 1 - inFoot, transform: `scale(${1 + 0.05 * inFoot})` }}>
        <div style={{ position: "absolute", left: 120, top: 92, ...appear(frame, 0, 14, 16) }}>
          <Eyebrow size={19}>Where the fees go</Eyebrow>
          <div style={{ ...headline, fontSize: 70, marginTop: 20 }}>
            Every trade pays <Dream>the people who lock.</Dream>
          </div>
        </div>
        <AbsoluteFill style={{ transform: "scale(1.04)" }}>
          <Flow frame={frame} beats={beats} />
        </AbsoluteFill>
      </AbsoluteFill>
      {inFoot > 0 && (
        <AbsoluteFill style={{ opacity: inFoot, transform: `scale(${1.04 - 0.04 * inFoot})` }}>
          <div style={{ position: "absolute", left: 210, top: 60 }}>
            <Sequence from={footIn - 6} layout="none">
              <Footage
                src={FEE_CLIP.src}
                startAt={FEE_CLIP.typed - 0.8}
                width={1500}
                url="localhost · mainnet fork"
                badge={{ text: "mainnet-fork demo", tone: "demo" }}
                keys={[
                  { at: 0, z: 1.5, x: 1250, y: 600 },
                  { at: s(0.9), z: 2.0, x: FEE_CLIP.focus.x, y: FEE_CLIP.focus.y },
                ]}
                spots={[{ from: s(1.0), to: s(5), rect: FEE_CLIP.feeRow }]}
              />
            </Sequence>
          </div>
          <div style={{ position: "absolute", left: 210, bottom: 34 }}>
            <Chip tone="demo">imagine.fun app fee 1.5% + the 0.5% on-chain fee · 2% into this coin's pool</Chip>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

type FlowNode = { x: number; y: number; w: number; h: number };
const FN: Record<"anywhere" | "app" | "grad" | "vault" | "lockers" | "treasury" | "creator", FlowNode> = {
  anywhere: { x: 90, y: 330, w: 400, h: 140 },
  app: { x: 90, y: 540, w: 400, h: 140 },
  grad: { x: 90, y: 750, w: 400, h: 120 },
  vault: { x: 820, y: 505, w: 400, h: 190 },
  lockers: { x: 1440, y: 380, w: 400, h: 170 },
  treasury: { x: 1440, y: 590, w: 400, h: 110 },
  creator: { x: 1440, y: 740, w: 400, h: 120 },
};

function edgePath(a: FlowNode, b: FlowNode) {
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;
  const mx = (x1 + x2) / 2;
  const pt = (t: number) => {
    const u = 1 - t;
    return [u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2, u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2];
  };
  return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, pt };
}

/**
 * Where the money goes, as local frames for each beat: the on-chain 0.5% on
 * every trade anywhere, the 1.5% app fee on imagine.fun (2% in all), the CPMM
 * pool's fee share after graduation, then the 90 / 10 / 0 split.
 */
function Flow({ frame, beats }: { frame: number; beats: { anywhere: number; app: number; grad: number; lock: number } }) {
  const shown = (start: number) => ease((frame - start) / 12);
  const edges: Array<{ from: FlowNode; to: FlowNode; start: number; color: string; width: number; dashed?: boolean; dots: number }> = [
    { from: FN.anywhere, to: FN.vault, start: beats.anywhere + 6, color: COLORS.steel, width: 4, dots: 4 },
    { from: FN.app, to: FN.vault, start: beats.app + 6, color: COLORS.steelHi, width: 6, dots: 5 },
    { from: FN.grad, to: FN.vault, start: beats.grad + 6, color: COLORS.steel, width: 3, dashed: true, dots: 2 },
    { from: FN.vault, to: FN.lockers, start: beats.lock, color: COLORS.mint, width: 9, dots: 6 },
    { from: FN.vault, to: FN.treasury, start: beats.lock + 12, color: COLORS.steel, width: 3, dots: 2 },
    { from: FN.vault, to: FN.creator, start: beats.lock + 20, color: COLORS.ink4, width: 2, dots: 0 },
  ];
  const box = (n: FlowNode, start: number, style: React.CSSProperties, children: React.ReactNode) => {
    const t = shown(start);
    return (
      <div
        style={{
          position: "absolute",
          left: n.x,
          top: n.y,
          width: n.w,
          height: n.h,
          boxSizing: "border-box",
          padding: "20px 26px",
          borderRadius: 14,
          opacity: t,
          transform: `translateY(${(1 - t) * 18}px)`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          ...style,
        }}
      >
        {children}
      </div>
    );
  };
  const card = { background: COLORS.ink2, border: `1px solid ${COLORS.line}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" };
  const title: React.CSSProperties = { fontWeight: 700, fontSize: 30, letterSpacing: "-0.02em" };
  const sub: React.CSSProperties = { fontSize: 18, color: COLORS.fgSoft, marginTop: 8, lineHeight: 1.35 };
  const label = (x: number, y: number, start: number, text: string, color: string = COLORS.fgSoft) => (
    <div style={{ position: "absolute", left: x, top: y, fontFamily: FONTS.mono, fontSize: 18, letterSpacing: "0.04em", color, opacity: shown(start), whiteSpace: "nowrap" }}>{text}</div>
  );
  return (
    <AbsoluteFill>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {edges.map((e, i) => {
          const { d, pt } = edgePath(e.from, e.to);
          const lit = ease((frame - e.start) / 16);
          // a zero-length dash with round caps would still draw a dot
          if (lit <= 0) return null;
          return (
            <g key={i}>
              <path d={d} stroke={e.color} strokeWidth={e.width} fill="none" strokeLinecap="round" pathLength={1} strokeDasharray={e.dashed ? "0.012 0.014" : `${lit} 1`} opacity={e.dashed ? lit : 0.9} />
              {Array.from({ length: e.dots }, (_, k) => {
                const p = ((frame - e.start) / 44 + k / e.dots) % 1;
                if (frame < e.start + 8) return null;
                const [x, y] = pt(p);
                return <circle key={k} cx={x} cy={y} r={e.width > 5 ? 7.5 : 5.5} fill={e.color === COLORS.mint ? COLORS.mint : COLORS.steelHi} opacity={lit * Math.sin(Math.PI * p)} />;
              })}
            </g>
          );
        })}
      </svg>
      {box(FN.anywhere, beats.anywhere, card, (
        <>
          <div style={title}>A trade anywhere</div>
          <div style={sub}>Raydium, Jupiter, any wallet or bot</div>
        </>
      ))}
      {label(515, 372, beats.anywhere + 8, "0.5% on-chain trading fee", COLORS.steelHi)}
      {box(FN.app, beats.app, card, (
        <>
          <div style={title}>A trade on imagine.fun</div>
          <div style={sub}>the same 0.5%, plus a 1.5% app fee</div>
        </>
      ))}
      {label(515, 566, beats.app + 8, "2% into the pool", COLORS.mint)}
      {box(FN.grad, beats.grad, { ...card, background: COLORS.ink1 }, (
        <>
          <div style={{ ...title, fontSize: 26 }}>After graduation</div>
          <div style={sub}>its Raydium pool's trading-fee share</div>
        </>
      ))}
      {box(FN.vault, beats.anywhere + 4, { background: DREAM, boxShadow: "0 0 90px rgba(94,233,181,0.35)" }, (
        <>
          <div style={{ ...title, color: COLORS.ink, fontSize: 36 }}>The coin's pool</div>
          <div style={{ ...sub, color: COLORS.ink2 }}>paid in the coin's pair asset</div>
        </>
      ))}
      {box(FN.lockers, beats.lock, { ...card, border: `1.5px solid ${COLORS.mintDeep}`, boxShadow: "0 0 60px rgba(94,233,181,0.18)" }, (
        <>
          <div style={{ ...title, color: COLORS.mint, fontSize: 40 }}>90% → lockers</div>
          <div style={sub}>by weight, streamed over 1 hour</div>
        </>
      ))}
      {box(FN.treasury, beats.lock + 12, card, <div style={{ ...title, fontSize: 28, color: COLORS.steelHi }}>10% → treasury</div>)}
      {box(FN.creator, beats.lock + 20, { ...card, background: COLORS.ink1 }, (
        <>
          <div style={{ ...title, fontSize: 26, color: COLORS.muted }}>0% → creator</div>
          <div style={{ ...sub, color: COLORS.muted }}>earns only by locking</div>
        </>
      ))}
      <div style={{ position: "absolute", left: 90, right: 80, top: 930, fontSize: 21, color: COLORS.muted, opacity: shown(beats.lock + 30) }}>
        The 0.5% is enforced on-chain by Raydium LaunchLab. The creator earns nothing from fees, only by locking like everyone else.
      </div>
    </AbsoluteFill>
  );
}

// --- 6. paid in the pair ------------------------------------------------------------------

const PAID = [
  { coin: "$CHIP", pair: "NVDAx" },
  { coin: "$DREAM", pair: "SOL" },
  { coin: "$CALM", pair: "USDC" },
];

function PaidScene() {
  const frame = useCurrentFrame();
  const swap = at("paid", cue("l11"));
  return (
    <AbsoluteFill>
      <Backdrop glow={0.85} glowX={50} glowY={35} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 120, textAlign: "center" }}>
        <Swap
          swap={swap}
          a={<div style={{ ...headline, fontSize: 92, ...appear(frame, 4) }}>Paid in whatever it's paired with.</div>}
          b={
            <div style={{ ...headline, fontSize: 112 }}>
              Lock the meme. <Dream>Earn its pair.</Dream>
            </div>
          }
        />
      </div>
      <div style={{ position: "absolute", left: 170, right: 170, top: 400, display: "flex", gap: 44 }}>
        {PAID.map((p, i) => (
          <div key={p.pair} style={{ flex: 1, ...appear(frame, 8 + i * 5, 16, 26) }}>
            <Card style={{ padding: "30px 34px 34px", position: "relative", overflow: "hidden" }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 16, letterSpacing: "0.18em", color: COLORS.muted }}>A COIN</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 36 }}>{p.coin}</span>
                <PairPill ticker={p.pair} size={19} />
              </div>
              <div style={{ position: "relative", height: 150, margin: "16px 0" }}>
                {[0, 1, 2].map((k) => {
                  const t = ((frame + k * 18 + i * 7) % 54) / 54;
                  return (
                    <div
                      key={k}
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: t * 118,
                        transform: "translateX(-50%)",
                        opacity: Math.sin(Math.PI * t) * ease((frame - 18 - i * 5) / 12),
                        fontFamily: FONTS.mono,
                        fontSize: 19,
                        color: COLORS.ink,
                        background: COLORS.mint,
                        borderRadius: 999,
                        padding: "4px 16px",
                      }}
                    >
                      {p.pair}
                    </div>
                  );
                })}
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, background: `linear-gradient(${COLORS.line}, ${COLORS.mintDeep})`, transform: "translateX(-50%)", opacity: 0.6 }} />
              </div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 16, letterSpacing: "0.18em", color: COLORS.muted }}>ITS LOCKERS EARN</div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 46, color: COLORS.mint, marginTop: 10 }}>{p.pair}</div>
            </Card>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

// --- 7. the curve ----------------------------------------------------------------------------

const CURVE_TICKS = [
  { secs: 1 * DAY, label: "1d" },
  { secs: 7 * DAY, label: "7d" },
  { secs: 30 * DAY, label: "30d" },
  { secs: 90 * DAY, label: "90d" },
  { secs: 180 * DAY, label: "180d" },
  { secs: 365 * DAY, label: "365d" },
];

function CurveScene() {
  const frame = useCurrentFrame();
  // The recording starts at 6.0 s and plays at 1.6×. The curve follows the
  // dial in the footage stop for stop: dial-track.json is the knob's index
  // per source frame, read off the recording itself.
  const rate = 1.6;
  const sourceFrame = Math.round((6.0 + (frame / 30) * rate) * 30) - DIAL.startFrame;
  const stop = DIAL.index[Math.min(DIAL.index.length - 1, Math.max(0, sourceFrame))];
  const secsNow = stop < 20 ? (4 + stop) * HOUR : (stop - 19) * DAY;
  const span = LOCK_TERMS.maxLockSecs - LOCK_TERMS.minLockSecs;
  const progress = (secsNow - LOCK_TERMS.minLockSecs) / span;
  const W = 680;
  const H = 440;
  const px = (secs: number) => ((secs - LOCK_TERMS.minLockSecs) / span) * W;
  const py = (m: number) => H - ((m - 1) / 3) * H;
  const pts = Array.from({ length: 121 }, (_, i) => LOCK_TERMS.minLockSecs + (i / 120) * span);
  const path = pts
    .filter((x) => x <= secsNow + 1)
    .map((x, i) => `${i === 0 ? "M" : "L"}${px(x).toFixed(1)},${py(Number(multiplierFor(x))).toFixed(1)}`)
    .join(" ");
  const mNow = multiplierFor(secsNow);
  const l13 = at("curve", cue("l13"));
  return (
    <AbsoluteFill>
      <Backdrop glow={0.5 + 0.5 * progress} glowX={72} glowY={50} />
      <div style={{ position: "absolute", left: 80, top: 160, ...appear(frame, 0, 16, 30) }}>
        <Footage
          src="coin-lock-x1.6.mp4"
          startAt={6.0 / rate}
          width={960}
          url="localhost · mainnet fork"
          badge={{ text: "mainnet-fork demo", tone: "demo" }}
          keys={[
            { at: 0, z: 1.6, x: 1300, y: 330 },
            { at: s(0.8), z: 2.05, x: 1350, y: 330 },
          ]}
          spots={[{ from: l13 + s(1.9), to: s(9), rect: [1174, 403, 349, 100] }]}
        />
      </div>
      <div style={{ position: "absolute", left: 1130, top: 120, width: 700 }}>
        <div style={appear(frame, 6)}>
          <Eyebrow size={18}>Duration multiplier · square-root curve</Eyebrow>
        </div>
        <div style={{ ...headline, fontSize: 56, marginTop: 18, ...appear(frame, 10) }}>
          <Swap swap={l13 + s(2.2)} a={<span>Four hours, or a year.</span>} b={<span>Commit longer, <Dream>earn a bigger cut.</Dream></span>} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 1170, top: 330, ...appear(frame, 8, 16, 20) }}>
        <svg width={W + 40} height={H + 70} style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id="curve-dream" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#8CC8DC" />
              <stop offset="0.55" stopColor="#5EE9B5" />
              <stop offset="1" stopColor="#C7F9E5" />
            </linearGradient>
          </defs>
          {[1, 2, 3, 4].map((m) => (
            <g key={m}>
              <line x1={0} x2={W} y1={py(m)} y2={py(m)} stroke={COLORS.line} strokeDasharray="4 8" />
              <text x={-14} y={py(m) + 6} textAnchor="end" fill={COLORS.muted} fontFamily={FONTS.mono} fontSize={17}>
                {m}.00×
              </text>
            </g>
          ))}
          <line x1={0} y1={py(1)} x2={W} y2={py(4)} stroke={COLORS.lineStrong} strokeWidth={2} strokeDasharray="6 8" opacity={0.6} />
          <path d={path} fill="none" stroke="url(#curve-dream)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
          {CURVE_TICKS.map((tk) => {
            const lit = secsNow >= tk.secs;
            // 1d and 7d sit within a few pixels of 4h on a linear time axis: dots only
            const labelled = tk.secs >= 30 * DAY;
            const passed = secsNow >= tk.secs + 0.04 * span;
            const x = px(tk.secs);
            const y = py(Number(multiplierFor(tk.secs)));
            const last = tk.secs === LOCK_TERMS.maxLockSecs;
            return (
              <g key={tk.label} opacity={lit ? 1 : 0.35}>
                <circle cx={x} cy={y} r={lit ? 7 : 4} fill={lit ? COLORS.mint : COLORS.lineStrong} />
                {labelled && (passed || (last && lit)) && (
                  <text x={last ? x - 16 : x + 14} y={last ? y - 16 : y + 28} textAnchor={last ? "end" : "start"} fill={COLORS.fg} fontFamily={FONTS.mono} fontSize={19}>
                    {multiplierFor(tk.secs)}×
                  </text>
                )}
                {labelled && (
                  <text x={x} y={H + 34} textAnchor="middle" fill={COLORS.muted} fontFamily={FONTS.mono} fontSize={17}>
                    {tk.label}
                  </text>
                )}
              </g>
            );
          })}
          <text x={0} y={H + 34} textAnchor="start" fill={COLORS.muted} fontFamily={FONTS.mono} fontSize={17}>
            4h
          </text>
          <circle cx={px(secsNow)} cy={py(Number(mNow))} r={11} fill={COLORS.fg} />
          <circle cx={px(secsNow)} cy={py(Number(mNow))} r={5} fill={COLORS.mintDeep} />
        </svg>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 18 }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 64, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
            <Dream>{mNow}×</Dream>
          </span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 22, color: COLORS.muted, letterSpacing: "0.12em" }}>
            AT {secsNow < DAY ? `${Math.round(secsNow / HOUR)}H` : `${Math.floor(secsNow / DAY)}D`}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// --- 8. leaving early -----------------------------------------------------------------------------

function ExitScene() {
  const frame = useCurrentFrame();
  const crack = at("exit", 53.0);
  const broke = ease((frame - crack) / 14);
  const l15 = at("exit", cue("l15"));
  const rows = [
    { name: "365d lock", fill: 0.92 },
    { name: "Your 30d lock · day 6 of 30", fill: 0.2, you: true },
    { name: "90d lock", fill: 0.55 },
  ];
  return (
    <AbsoluteFill>
      <Backdrop glow={0.4} glowX={50} glowY={70} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 110, textAlign: "center" }}>
        <div style={{ ...headline, fontSize: 84 }}>
          <Swap
            swap={l15}
            a={<span style={appear(frame, 4)}>You can always leave.</span>}
            b={
              <span>
                Selling is free. <Dream>It just costs you the stream.</Dream>
              </span>
            }
          />
        </div>
      </div>
      <div style={{ position: "absolute", left: 360, right: 360, top: 380, display: "flex", flexDirection: "column", gap: 62 }}>
        {rows.map((r, i) => {
          const you = !!r.you;
          return (
            <div key={r.name} style={{ position: "relative", ...appear(frame, 6 + i * 4, 14, 16) }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONTS.mono, fontSize: 19, letterSpacing: "0.08em", color: you ? (broke > 0 ? COLORS.rose : COLORS.fg) : COLORS.fgSoft, marginBottom: 10 }}>
                <span>{you && broke > 0.5 ? "Unlocked early · day 6 of 30" : r.name}</span>
                <span style={{ color: you ? (broke > 0.5 ? COLORS.muted : COLORS.mint) : COLORS.mint }}>{you && broke > 0.5 ? "stream: 0" : "earning"}</span>
              </div>
              <div style={{ position: "relative", height: 54, borderRadius: 12, background: COLORS.ink2, border: `1px solid ${you && broke > 0 ? COLORS.roseDeep : COLORS.line}`, overflow: "visible" }}>
                {you ? (
                  <>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "80%", borderRadius: 12, background: broke > 0 ? COLORS.ink4 : "linear-gradient(90deg,#8CC8DC,#5EE9B5)", transform: `translateX(${broke * 30}px)`, opacity: 1 - 0.3 * broke }} />
                    <div
                      style={{
                        position: "absolute",
                        left: "80%",
                        top: 0,
                        bottom: 0,
                        width: "20%",
                        borderRadius: 12,
                        background: broke > 0 ? COLORS.rose : "linear-gradient(90deg,#5EE9B5,#C7F9E5)",
                        transform: `translate(${broke * 150}px, ${broke * broke * 30}px) rotate(${broke * 16}deg)`,
                        opacity: 1 - ease((frame - crack - 10) / 18),
                      }}
                    />
                    <div style={{ position: "absolute", left: "82%", top: 64, fontFamily: FONTS.mono, fontSize: 18, color: COLORS.rose, opacity: ease((frame - crack - 6) / 10) * (1 - ease((frame - crack - 40) / 12)) }}>
                      20% burned
                    </div>
                    <div style={{ position: "absolute", left: 0, top: 64, fontFamily: FONTS.mono, fontSize: 18, color: COLORS.fgSoft, opacity: ease((frame - crack - 10) / 10) }}>80% back to you · unclaimed rewards go to the others</div>
                  </>
                ) : (
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "100%", borderRadius: 12, background: "linear-gradient(90deg,#8CC8DC,#5EE9B5)", opacity: 0.85 }} />
                )}
                {/* the stream: pair-asset drops land on whoever is still locked */}
                {[0, 1, 2].map((k) => {
                  if (you && frame > crack) return null;
                  const t = ((frame + k * 15 + i * 8) % 45) / 45;
                  return <div key={k} style={{ position: "absolute", left: `${30 + k * 22}%`, top: -40 + t * 46, width: 12, height: 12, borderRadius: 99, background: COLORS.mint, opacity: Math.sin(Math.PI * t), boxShadow: `0 0 12px ${COLORS.mint}` }} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 90, textAlign: "center", fontSize: 25, color: COLORS.fgSoft, ...appear(frame, crack + 14) }}>
        Early exit burns up to 25% of principal, scaled by time left. Unclaimed rewards stream to those who stayed.
      </div>
    </AbsoluteFill>
  );
}

// --- 9. the rules -----------------------------------------------------------------------------

const RULES: Array<{ id: string; title: string; sub: string }> = [
  { id: "l16", title: "The creator earns nothing from fees", sub: "They lock first, in the launch transaction, like everyone else." },
  { id: "l17", title: "No admin withdraw path", sub: "The instruction doesn't exist." },
  { id: "l18", title: "Terms frozen per pool", sub: "Written at launch. Never rewritten." },
  { id: "l19", title: "Claims and unlocks can't be paused", sub: "The pause switch only stops new launches." },
];

function RulesScene() {
  const frame = useCurrentFrame();
  const starts = RULES.map((r) => at("rules", cue(r.id)));
  const active = starts.filter((st) => frame >= st - 2).length - 1;
  return (
    <AbsoluteFill>
      <Backdrop glow={0.4} glowX={18} glowY={40} />
      <div style={{ position: "absolute", left: 140, top: 0, bottom: 0, width: 640, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={appear(frame, 4)}>
          <Eyebrow size={19}>What the program can't do</Eyebrow>
        </div>
        <div style={{ ...headline, fontSize: 100, marginTop: 24, ...appear(frame, 8) }}>
          The rules
          <br />
          <Dream>don't move.</Dream>
        </div>
      </div>
      <div style={{ position: "absolute", left: 860, right: 120, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 22 }}>
        {RULES.map((r, i) => {
          const t = ease((frame - starts[i]) / 12);
          const on = i === active;
          return (
            <div key={r.id} style={{ opacity: t * (on ? 1 : 0.55), transform: `translateX(${(1 - t) * 50}px)` }}>
              <Card
                style={{
                  padding: "26px 32px",
                  display: "flex",
                  alignItems: "center",
                  gap: 26,
                  border: `1px solid ${on ? COLORS.mintDeep : COLORS.line}`,
                  boxShadow: on ? "0 0 50px rgba(94,233,181,0.16), inset 0 1px 0 rgba(255,255,255,0.05)" : undefined,
                }}
              >
                <Mark size={50} id={`rule-${i}`} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 38, letterSpacing: "-0.02em" }}>{r.title}</div>
                  <div style={{ fontSize: 22, color: COLORS.fgSoft, marginTop: 6 }}>{r.sub}</div>
                </div>
              </Card>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

// --- 10. proof -----------------------------------------------------------------------------------

/** Real output, captured 2026-10-28 (video/out/x/raw/cargo-test-raydium.txt, sdk-test-raydium.txt). */
const TERMINAL: Array<{ text: string; tone?: "cmd" | "ok" | "dim" }> = [
  { text: "$ cargo test -p imagine --lib", tone: "cmd" },
  { text: "running 17 tests", tone: "dim" },
  { text: "test math::tests::sqrt_curve_is_front_loaded_and_monotonic ... ok" },
  { text: "test math::tests::many_uneven_deposits_stay_solvent ... ok" },
  { text: "test result: ok. 17 passed; 0 failed; 0 ignored", tone: "ok" },
  { text: "" },
  { text: "$ node --test test/*.test.ts", tone: "cmd" },
  { text: "✔ launches, dev-buys and founds in a single transaction (SPYx)" },
  { text: "✔ burns an early exit's penalty and streams its forfeit to the stayers" },
  { text: "ℹ tests 115", tone: "dim" },
  { text: "ℹ pass 115", tone: "ok" },
  { text: "ℹ fail 0", tone: "dim" },
];

function ProofScene() {
  const frame = useCurrentFrame();
  const l20 = at("proof", cue("l20"));
  const open = l20 + s(1.86);
  const tested = l20 + s(3.08);
  return (
    <AbsoluteFill>
      <Backdrop glow={0.55} glowX={30} glowY={30} />
      <div style={{ position: "absolute", left: 110, top: 80 }}>
        <Eyebrow size={19}>Proof</Eyebrow>
      </div>
      <div style={{ position: "absolute", left: 110, top: 140, width: 900, ...appear(frame, l20, 14, 24) }}>
        <div style={{ ...headline, fontSize: 52 }}>
          Live on <Dream>Solana mainnet.</Dream>
        </div>
        <Card style={{ marginTop: 22, padding: 18, overflow: "hidden" }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 15, letterSpacing: "0.18em", color: COLORS.muted, margin: "2px 4px 12px" }}>SOLANA EXPLORER · MAINNET</div>
          <Img src={staticFile("shots/explorer-rows.png")} style={{ width: 860, display: "block", borderRadius: 8 }} />
        </Card>
      </div>
      <div style={{ position: "absolute", left: 110, top: 640, width: 900, ...appear(frame, open, 14, 24) }}>
        <div style={{ ...headline, fontSize: 52 }}>Open source.</div>
        <Card style={{ marginTop: 22, padding: "22px 26px", display: "flex", alignItems: "center", gap: 24 }}>
          <Img src={staticFile("shots/github-name.png")} style={{ height: 52 }} />
          <span style={{ fontFamily: FONTS.mono, fontSize: 26, color: COLORS.steelHi }}>github.com/realdoomsman/imagine</span>
        </Card>
      </div>
      <div style={{ position: "absolute", left: 1080, top: 140, width: 740, ...appear(frame, tested, 14, 24) }}>
        <div style={{ ...headline, fontSize: 46 }}>
          Tested against <Dream>Raydium's real programs.</Dream>
        </div>
        <div style={{ marginTop: 22, borderRadius: 14, overflow: "hidden", border: `1px solid ${COLORS.lineStrong}`, background: "#050C0E", boxShadow: "0 40px 100px rgba(0,0,0,0.5)" }}>
          <div style={{ height: 38, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", background: COLORS.ink2, borderBottom: `1px solid ${COLORS.line}` }}>
            {[COLORS.rose, COLORS.steel, COLORS.mint].map((c) => (
              <span key={c} style={{ width: 10, height: 10, borderRadius: 9, background: c, opacity: 0.55 }} />
            ))}
            <span style={{ marginLeft: 10, fontFamily: FONTS.mono, fontSize: 14, color: COLORS.muted }}>imagine · tests</span>
          </div>
          <div style={{ padding: "18px 22px 22px", fontFamily: FONTS.mono, fontSize: 17, lineHeight: 1.65 }}>
            {TERMINAL.map((line, i) => {
              const shown = frame >= tested + 4 + i * 2;
              return (
                <div key={i} style={{ opacity: shown ? 1 : 0, color: line.tone === "cmd" ? COLORS.steelHi : line.tone === "ok" ? COLORS.mint : line.tone === "dim" ? COLORS.muted : COLORS.fgSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minHeight: "1.65em" }}>
                  {line.text}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop: 18, fontSize: 21, lineHeight: 1.45, color: COLORS.fgSoft, ...appear(frame, tested + 24) }}>
          Integration tests run against the real mainnet builds of Raydium LaunchLab, CPMM and Token-2022.
        </div>
      </div>
    </AbsoluteFill>
  );
}

// --- 11. end card -----------------------------------------------------------------------------------

function EndScene() {
  const frame = useCurrentFrame();
  const stem = ease((frame - 2) / 14);
  const dot = ease((frame - s(0.75)) / 10);
  const l21 = at("end", cue("l21"));
  const l22 = at("end", cue("l22"));
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Backdrop glow={ease(frame / 40)} glowX={50} glowY={40} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 420, opacity: 0.16 * ease((frame - 10) / 40), display: "flex", justifyContent: "center" }}>
        <Chart width={1920} height={380} calm={1} line={1} count={60} seed={5} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          <div style={{ filter: `drop-shadow(0 0 ${60 * dot}px rgba(94,233,181,0.45))` }}>
            <Mark size={150} stem={stem} dot={dot} id="end" />
          </div>
          <div style={appear(frame, 18, 18, 14)}>
            <Wordmark size={150} />
          </div>
        </div>
        <div style={{ ...headline, fontSize: 72, marginTop: 70 }}>
          <Words text="Imagine the chart if nobody sold." start={l21} step={4} accentFrom={2} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 56, ...appear(frame, l22 - 4, 16, 12) }}>
          <span style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 44, letterSpacing: "0.04em", color: COLORS.fg }}>imagine.fun</span>
          <span style={{ width: 2, height: 40, background: COLORS.lineStrong }} />
          <span style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 44, letterSpacing: "0.04em", color: COLORS.steelHi }}>@LockImagine</span>
        </div>
        <div style={{ marginTop: 40, fontSize: 22, color: COLORS.muted, ...appear(frame, l22 + 14) }}>
          Lock the meme. Earn its pair. · Launched on Raydium.
        </div>
      </div>
    </AbsoluteFill>
  );
}
