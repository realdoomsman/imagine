import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Grain, Knurl, Panel, Rule } from "./chrome";
import { clampEase, COLORS, FONTS, FPS, multiplierFor } from "./theme";
import { Vise } from "./Vise";

/**
 * The launch film. Sixty seconds, seven movements, cut to the score's bars:
 *
 *   0–5    hook: everyone sells; the vise closes in three cranks
 *   5–12.5 the problem: a coin's one revenue stream, and who gets it
 *   12.5–20 the mechanism: VISE reroutes it to a vault, 90 / 10 / 0
 *   20–30  the lock: the multiplier ladder, then size tiers
 *   30–40  the product: real screens, in order
 *   40–50  the guarantees: what the program cannot do
 *   50–60  the close
 *
 * Every number comes from the program's own curve; every screen is a capture
 * of the live site.
 */
export const PROMO_DURATION = Math.round(60.5 * FPS);

const S = (seconds: number) => Math.round(seconds * FPS);

export function Promo() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ground }}>
      <Audio src={staticFile("promo.wav")} />
      <Knurl />
      <Sequence durationInFrames={S(5)}>
        <Hook />
      </Sequence>
      <Sequence from={S(5)} durationInFrames={S(7.5)}>
        <Problem />
      </Sequence>
      <Sequence from={S(12.5)} durationInFrames={S(7.5)}>
        <Mechanism />
      </Sequence>
      <Sequence from={S(20)} durationInFrames={S(10)}>
        <Lock />
      </Sequence>
      <Sequence from={S(30)} durationInFrames={S(10)}>
        <Product />
      </Sequence>
      <Sequence from={S(40)} durationInFrames={S(10)}>
        <Guarantees />
      </Sequence>
      <Sequence from={S(50)} durationInFrames={S(10.5)}>
        <Close />
      </Sequence>
      <Grain />
    </AbsoluteFill>
  );
}

// --- shared ---------------------------------------------------------------

/** Frame-driven fade+lift for a block; `at`/`for` in seconds within the scene. */
function useReveal(at: number, duration = 0.5, outAt?: number) {
  const frame = useCurrentFrame();
  const a = clampEase((frame - S(at)) / S(duration));
  const out = outAt === undefined ? 1 : 1 - clampEase((frame - S(outAt)) / S(0.35));
  return { opacity: a * out, transform: `translateY(${(1 - a) * 22}px)` };
}

function Title({ children, at = 0, size = 92 }: { children: React.ReactNode; at?: number; size?: number }) {
  const style = useReveal(at);
  return (
    <h2
      style={{
        fontFamily: FONTS.display,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 0.98,
        letterSpacing: "-0.035em",
        color: COLORS.heading,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </h2>
  );
}

function Body({ children, at = 0.3 }: { children: React.ReactNode; at?: number }) {
  const style = useReveal(at);
  return (
    <p style={{ fontFamily: FONTS.sans, fontSize: 32, lineHeight: 1.45, color: COLORS.body, maxWidth: 1080, margin: "26px 0 0", ...style }}>
      {children}
    </p>
  );
}

function Scene({ children, index }: { children: React.ReactNode; index: string }) {
  const frame = useCurrentFrame();
  const fadeIn = clampEase(frame / S(0.35));
  return (
    <AbsoluteFill style={{ padding: "100px 140px", opacity: fadeIn }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 24, letterSpacing: "0.22em", color: COLORS.torch }}>{index}</div>
      <div style={{ marginTop: 22, flex: 1, display: "flex", flexDirection: "column" }}>{children}</div>
    </AbsoluteFill>
  );
}

// --- 1. hook ----------------------------------------------------------------

function Hook() {
  const frame = useCurrentFrame();
  // Three cranks, each a hard step then a hold, timed to the score.
  const cranks = [1.6, 2.9, 4.2];
  let grip = 0;
  for (const at of cranks) grip += clampEase((frame - S(at - 0.35)) / S(0.35)) / 3;
  const shake = cranks.some((at) => Math.abs(frame - S(at)) < S(0.12)) ? Math.sin(frame * 3.1) * 4 : 0;
  const line1 = useReveal(0.15, 0.5, 2.3);
  const line2 = useReveal(2.5, 0.5);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ position: "absolute", top: 150, textAlign: "center", fontFamily: FONTS.display, fontWeight: 700, fontSize: 96, letterSpacing: "-0.04em", lineHeight: 1 }}>
        <div style={{ position: "absolute", left: "50%", whiteSpace: "nowrap", color: COLORS.heading, opacity: line1.opacity, transform: `translateX(-50%) ${line1.transform}` }}>
          Everyone sells.
        </div>
        <div style={{ position: "absolute", left: "50%", whiteSpace: "nowrap", color: COLORS.heading, opacity: line2.opacity, transform: `translateX(-50%) ${line2.transform}` }}>
          That is the <span style={{ color: COLORS.torch }}>whole problem.</span>
        </div>
      </div>
      <div style={{ marginTop: 160, transform: `translateX(${shake}px)` }}>
        <Vise grip={grip} width={1100} />
      </div>
    </AbsoluteFill>
  );
}

// --- 2. problem -------------------------------------------------------------

function Problem() {
  const frame = useCurrentFrame();
  const travel = clampEase((frame - S(1.6)) / S(2.2));
  const boxes = [
    { label: "Launchpad", at: 3.4, tone: COLORS.body },
    { label: "Dev wallet", at: 3.8, tone: COLORS.body },
    { label: "Holders", at: 4.4, tone: COLORS.muted, value: "0" },
  ];
  return (
    <Scene index="01 — THE PROBLEM">
      <Title>A memecoin has exactly one revenue stream.</Title>
      <Body>The fee people pay to trade it. About 1% of every buy and sell, in SOL, for the life of the coin.</Body>
      <div style={{ position: "relative", marginTop: 72, height: 300 }}>
        <Panel style={{ position: "absolute", left: 0, top: 60, width: 360 }}>
          <Rule>Every trade</Rule>
          <div style={{ fontFamily: FONTS.mono, fontSize: 56, color: COLORS.heading }}>10.00 SOL</div>
        </Panel>
        <div style={{ position: "absolute", left: 400, top: 160, width: 520, height: 4, background: COLORS.border }} />
        <div style={{ position: "absolute", left: 400, top: 160, width: 520 * travel, height: 4, background: COLORS.torch }} />
        <div style={{ position: "absolute", left: 560, top: 100, fontFamily: FONTS.mono, fontSize: 30, color: COLORS.torch, opacity: travel > 0.05 ? 1 : 0 }}>
          0.10 SOL fee
        </div>
        {boxes.map((box, i) => (
          <Box key={box.label} at={box.at} left={980} top={i * 100 - 4} label={box.label} value={box.value} tone={box.tone} />
        ))}
        <div style={{ position: "absolute", left: 980, top: 296, fontFamily: FONTS.sans, fontSize: 24, color: COLORS.muted, ...useReveal(5.2) }}>
          None of it, ever, to the people whose holding is the reason there is a price.
        </div>
      </div>
    </Scene>
  );
}

function Box({ at, left, top, label, value, tone }: { at: number; left: number; top: number; label: string; value?: string; tone: string }) {
  const style = useReveal(at, 0.4);
  return (
    <div style={{ position: "absolute", left, top, width: 520, display: "flex", alignItems: "center", gap: 20, ...style }}>
      <div style={{ width: 54, height: 4, background: value ? COLORS.border : COLORS.torch }} />
      <div style={{ flex: 1, background: COLORS.panel, border: `2px solid ${COLORS.border}`, padding: "16px 22px", display: "flex", justifyContent: "space-between", fontFamily: FONTS.mono, fontSize: 28, color: tone }}>
        <span>{label}</span>
        <span style={{ color: value ? COLORS.muted : COLORS.torch }}>{value ?? "gets paid"}</span>
      </div>
    </div>
  );
}

// --- 3. mechanism -----------------------------------------------------------

function Mechanism() {
  const frame = useCurrentFrame();
  const grow = clampEase((frame - S(2.8)) / S(1.4));
  const parts = [
    { label: "Lockers", value: 90, color: COLORS.torch, text: "#190600" },
    { label: "VISE", value: 10, color: COLORS.muted, text: COLORS.heading },
  ];
  return (
    <Scene index="02 — THE MECHANISM">
      <Title>VISE points it at the holders.</Title>
      <Body>
        2% of every trade routed through vise.fun, plus the coin&apos;s creator fees, land in a vault that belongs to the
        coin. The routing revokes its own admin: nobody can point it back.
      </Body>
      <div style={{ marginTop: 64 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONTS.mono, fontSize: 22, letterSpacing: "0.18em", textTransform: "uppercase", color: COLORS.muted, ...useReveal(2.4) }}>
          <span>One split. Frozen on the pool at creation.</span>
          <span>Creator: 0%</span>
        </div>
        <div style={{ display: "flex", height: 110, border: `2px solid ${COLORS.border}`, marginTop: 16, overflow: "hidden", width: `${grow * 100}%` }}>
          {parts.map((part) => (
            <div key={part.label} style={{ width: `${part.value}%`, background: part.color, display: "flex", alignItems: "center", justifyContent: "center", gap: 18, fontFamily: FONTS.mono, fontSize: 34, color: part.text }}>
              <span>{part.value}%</span>
              {part.value >= 20 ? <span style={{ fontSize: 22, letterSpacing: "0.16em", textTransform: "uppercase" }}>{part.label}</span> : null}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 28, fontFamily: FONTS.sans, fontSize: 28, color: COLORS.body, ...useReveal(4.6) }}>
          Creators take nothing by default. They earn by locking, like everyone else, and their founding lock is public
          from block one.
        </div>
      </div>
    </Scene>
  );
}

// --- 4. lock ----------------------------------------------------------------

function Lock() {
  const frame = useCurrentFrame();
  const rows = [7, 30, 90, 180, 365];
  const tiers = [
    { at: "≥ 0.1% of supply", bonus: "+10%" },
    { at: "≥ 0.5%", bonus: "+25%" },
    { at: "≥ 1.0%", bonus: "+50%" },
  ];
  const tiersIn = clampEase((frame - S(5.6)) / S(0.5));
  return (
    <Scene index="03 — THE LOCK">
      <Title>Longer locks take more.</Title>
      <Body>Weight is amount times term, on a square-root curve. A week counts once. A year counts four times.</Body>
      <div style={{ display: "flex", gap: 90, marginTop: 56 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
          {rows.map((days, index) => {
            const a = clampEase((frame - S(0.6 + index * 0.45)) / S(0.5));
            const mult = Number(multiplierFor(days));
            return (
              <div key={days} style={{ display: "flex", alignItems: "center", gap: 26, opacity: a }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 30, width: 96, textAlign: "right", color: COLORS.muted }}>{days}d</span>
                <div style={{ flex: 1, height: 40, border: `2px solid ${COLORS.border}`, background: COLORS.panel }}>
                  <div style={{ width: `${(mult / 4) * 100 * a}%`, height: "100%", background: days === 365 ? COLORS.torch : COLORS.torchDim }} />
                </div>
                <span style={{ fontFamily: FONTS.mono, fontSize: 36, width: 130, color: days === 365 ? COLORS.torch : COLORS.heading }}>{mult.toFixed(2)}×</span>
              </div>
            );
          })}
        </div>
        <div style={{ flex: "0 0 560px", opacity: tiersIn, transform: `translateY(${(1 - tiersIn) * 24}px)` }}>
          <Rule>Size counts too</Rule>
          <div style={{ display: "grid", gridTemplateRows: "repeat(3, 1fr)", gap: 2, background: COLORS.border, border: `2px solid ${COLORS.border}` }}>
            {tiers.map((tier) => (
              <div key={tier.at} style={{ background: COLORS.panel, padding: "18px 26px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 22, letterSpacing: "0.12em", textTransform: "uppercase", color: COLORS.muted }}>{tier.at}</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 48, color: COLORS.torch }}>{tier.bonus}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 18, fontFamily: FONTS.sans, fontSize: 24, color: COLORS.body }}>
            A year-long, one-percent position counts six times over.
          </div>
        </div>
      </div>
    </Scene>
  );
}

// --- 5. product -------------------------------------------------------------

const SCREENS = [
  { file: "shots/coin.png", crop: 96, caption: "A coin page. Every number realised, none projected.", zoomFrom: 1.0, zoomTo: 1.06, panY: 0 },
  { file: "shots/launch.png", crop: 120, caption: "Launching takes one form. Image from your disk, dev buy, founding lock.", zoomFrom: 1.04, zoomTo: 1.0, panY: 60 },
  { file: "shots/wallet.png", crop: 322, caption: "No wallet? Sign in with Google. The key is yours to take.", zoomFrom: 1.0, zoomTo: 1.05, panY: 40 },
];

function Product() {
  const frame = useCurrentFrame();
  const each = 10 / SCREENS.length;
  return (
    <AbsoluteFill>
      {SCREENS.map((screen, index) => {
        const start = S(index * each);
        const local = frame - start;
        const visible = local >= 0 && local < S(each);
        if (!visible) return null;
        const a = clampEase(local / S(0.4));
        const out = 1 - clampEase((local - S(each - 0.3)) / S(0.3));
        const zoom = interpolate(local, [0, S(each)], [screen.zoomFrom, screen.zoomTo]);
        const pan = interpolate(local, [0, S(each)], [0, screen.panY]);
        return (
          <AbsoluteFill key={screen.file} style={{ opacity: a * out, padding: "150px 120px 80px" }}>
            <div style={{ position: "relative", flex: 1, overflow: "hidden", border: `2px solid ${COLORS.border}`, borderRadius: 6, background: COLORS.ground, boxShadow: "0 40px 120px -40px rgba(0,0,0,0.9)" }}>
              <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom}) translateY(${-pan}px)`, transformOrigin: "50% 20%" }}>
                <Img src={staticFile(screen.file)} style={{ width: "100%", display: "block", marginTop: -screen.crop }} />
              </div>
              <div style={{ position: "absolute", inset: "auto 0 0 0", height: 260, background: "linear-gradient(180deg, transparent, rgba(8,9,11,0.96))" }} />
              <div style={{ position: "absolute", left: 60, bottom: 52, right: 60, fontFamily: FONTS.display, fontWeight: 700, fontSize: 52, letterSpacing: "-0.03em", color: COLORS.heading, ...useReveal(index * each + 0.35) }}>
                {screen.caption}
              </div>
            </div>
          </AbsoluteFill>
        );
      })}
      <div style={{ position: "absolute", left: 120, top: 100, fontFamily: FONTS.mono, fontSize: 24, letterSpacing: "0.22em", color: COLORS.torch }}>
        04 — THE PRODUCT · VISE.FUN
      </div>
    </AbsoluteFill>
  );
}

// --- 6. guarantees ----------------------------------------------------------

const GUARANTEES = [
  ["No admin path to the money.", "No instruction in the program moves a pool's SOL or tokens to an admin. Not disabled. Not timelocked. Absent."],
  ["Terms frozen at creation.", "Fee split, curve, tiers, penalty, lock bounds: copied onto the pool when it opens and never rewritten."],
  ["Claims can never be paused.", "The pause switch blocks new pools. That is all it can do."],
];

function Guarantees() {
  return (
    <Scene index="05 — WHAT THE PROGRAM CANNOT DO">
      <Title>&ldquo;Trust us&rdquo; is not a security model.</Title>
      <div style={{ marginTop: 60, display: "flex", flexDirection: "column", gap: 34 }}>
        {GUARANTEES.map(([head, body], index) => (
          <Guarantee key={head} head={head} body={body} at={1.2 + index * 2.4} />
        ))}
      </div>
    </Scene>
  );
}

function Guarantee({ head, body, at }: { head: string; body: string; at: number }) {
  const style = useReveal(at, 0.55);
  const frame = useCurrentFrame();
  const line = clampEase((frame - S(at)) / S(0.9));
  return (
    <div style={{ display: "flex", gap: 34, alignItems: "flex-start", ...style }}>
      <div style={{ width: 6, height: 84 * line, background: COLORS.torch, marginTop: 8 }} />
      <div>
        <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 52, letterSpacing: "-0.03em", color: COLORS.heading }}>{head}</div>
        <div style={{ fontFamily: FONTS.sans, fontSize: 28, lineHeight: 1.4, color: COLORS.body, maxWidth: 1240, marginTop: 8 }}>{body}</div>
      </div>
    </div>
  );
}

// --- 7. close ---------------------------------------------------------------

function Close() {
  const frame = useCurrentFrame();
  const grip = clampEase((frame - S(0.1)) / S(0.45));
  const shake = frame > S(0.3) && frame < S(0.55) ? Math.sin(frame * 3.3) * 5 : 0;
  const mark = useReveal(1.6, 0.6);
  const line = useReveal(2.4, 0.6);
  const url = useReveal(4.6, 0.6);
  const fade = 1 - clampEase((frame - S(9.3)) / S(1.1));
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: fade }}>
      <div style={{ transform: `translateX(${shake}px)` }}>
        <Vise grip={grip} width={900} />
      </div>
      <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 132, letterSpacing: "-0.05em", color: COLORS.heading, marginTop: 40, ...mark }}>
        VISE
      </div>
      <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 44, letterSpacing: "-0.02em", color: COLORS.torch, marginTop: 4, ...line }}>
        Hold under pressure.
      </div>
      <div style={{ fontFamily: FONTS.mono, fontSize: 28, letterSpacing: "0.24em", color: COLORS.muted, marginTop: 40, ...url }}>
        VISE.FUN
      </div>
    </AbsoluteFill>
  );
}
