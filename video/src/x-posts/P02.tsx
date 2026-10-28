import { AbsoluteFill } from "remotion";
import { Dream } from "../kit";
import { COLORS, FONTS } from "../theme";
import { Ground, SignOff } from "./common";

/**
 * p02, 1600×900: where a coin's fees come from and where they go, after the
 * move to Raydium LaunchLab. Every figure is from posts.json p02: 0.5% on-chain
 * trading fee on every curve trade, +1.5% app fee on imagine.fun (2% to the
 * pool), the graduated Raydium pool's fee share, 90 / 10 / 0 streamed over
 * 1 hour, LaunchLab protocol fee 0.25%, IMAGINE platform fee 0%.
 */

const box: React.CSSProperties = {
  position: "absolute",
  background: COLORS.ink2,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 18,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 60px rgba(0,0,0,0.35)",
  padding: "20px 24px",
  boxSizing: "border-box",
};
const title: React.CSSProperties = { fontFamily: FONTS.sans, fontWeight: 700, fontSize: 26, color: COLORS.fg, letterSpacing: "-0.01em", whiteSpace: "nowrap" };
const sub: React.CSSProperties = { fontFamily: FONTS.sans, fontWeight: 400, fontSize: 19, color: COLORS.fgSoft, marginTop: 6, lineHeight: 1.35 };
const mono = (size: number, color: string): React.CSSProperties => ({ fontFamily: FONTS.mono, fontWeight: 500, fontSize: size, color });

// Geometry (px in the 1600×900 frame).
const SRC_W = 340;
const ANYWHERE = { y: 192, h: 116 };
const APP = { y: 334, h: 116 };
const GRAD = { y: 476, h: 104 };
const VAULT = { x: 740, y: 262, w: 310, h: 250 };
const OUT_X = 1150;
const OUT_W = 1536 - OUT_X;
const LOCKERS = { y: 196, h: 148 };
const TREASURY = { y: 368, h: 76 };
const CREATOR = { y: 468, h: 104 };

function PairPill({ ticker }: { ticker: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 24px",
        borderRadius: 999,
        border: `1px solid ${COLORS.lineStrong}`,
        background: COLORS.ink2,
        fontFamily: FONTS.sans,
        fontWeight: 600,
        fontSize: 24,
        color: COLORS.fgSoft,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: 999, background: COLORS.mint, boxShadow: `0 0 12px ${COLORS.mint}` }} />
      <span style={mono(24, COLORS.fg)}>{ticker}</span>
      <span>→ pays</span>
      <span style={mono(24, COLORS.mint)}>{ticker}</span>
    </div>
  );
}

/** A cubic from the right edge of a box at height `y0` into the vault (or an output) at `y1`. */
function curve(x0: number, y0: number, x1: number, y1: number) {
  const dx = (x1 - x0) * 0.45;
  return `M ${x0} ${y0} C ${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}`;
}

export function P02() {
  const vCy = VAULT.y + VAULT.h / 2;
  const srcR = 72 + SRC_W;
  const vR = VAULT.x + VAULT.w;
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Ground glowX={52} glowY={46} glow={0.7} grain={false} />

      <div style={{ position: "absolute", left: 72, top: 54, fontWeight: 800, fontSize: 56, letterSpacing: "-0.035em", lineHeight: 1.05, whiteSpace: "nowrap" }}>
        Launched on Raydium. <Dream>Fees enforced on-chain.</Dream>
      </div>
      <div style={{ position: "absolute", left: 74, top: 134, ...mono(20, COLORS.steelHi), letterSpacing: "0.18em", textTransform: "uppercase" }}>
        Where a coin's fees go
      </div>

      <svg width={1600} height={900} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <marker id="p02-steel" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={COLORS.steelHi} />
          </marker>
          <marker id="p02-mint" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={COLORS.mint} />
          </marker>
          <marker id="p02-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={COLORS.lineStrong} />
          </marker>
        </defs>
        {/* in: 0.5% from a trade anywhere */}
        <path d={curve(srcR, ANYWHERE.y + ANYWHERE.h / 2, VAULT.x - 6, vCy - 70)} stroke={COLORS.steelHi} strokeWidth={3} fill="none" markerEnd="url(#p02-steel)" />
        {/* in: 2% from a trade on imagine.fun */}
        <path d={curve(srcR, APP.y + APP.h / 2, VAULT.x - 8, vCy)} stroke={COLORS.steelHi} strokeWidth={7} fill="none" markerEnd="url(#p02-steel)" />
        {/* in: the graduated pool's fee share */}
        <path d={curve(srcR, GRAD.y + GRAD.h / 2, VAULT.x - 6, vCy + 70)} stroke={COLORS.steelHi} strokeWidth={3} strokeDasharray="12 10" fill="none" markerEnd="url(#p02-steel)" />
        {/* out */}
        <path
          d={curve(vR, vCy - 50, OUT_X - 10, LOCKERS.y + LOCKERS.h / 2)}
          stroke={COLORS.mint}
          strokeWidth={12}
          fill="none"
          markerEnd="url(#p02-mint)"
          style={{ filter: "drop-shadow(0 0 10px rgba(94,233,181,0.45))" }}
        />
        <path d={curve(vR, vCy + 10, OUT_X - 6, TREASURY.y + TREASURY.h / 2)} stroke={COLORS.steel} strokeWidth={3} fill="none" markerEnd="url(#p02-steel)" />
        <path d={curve(vR, vCy + 60, OUT_X - 6, CREATOR.y + CREATOR.h / 2)} stroke={COLORS.lineStrong} strokeWidth={2} strokeDasharray="4 8" fill="none" markerEnd="url(#p02-muted)" />
      </svg>

      {/* sources */}
      <div style={{ ...box, left: 72, top: ANYWHERE.y, width: SRC_W, height: ANYWHERE.h }}>
        <div style={title}>A trade anywhere</div>
        <div style={sub}>
          Raydium, Jupiter,
          <br />
          any wallet or bot
        </div>
      </div>
      <div style={{ ...box, left: 72, top: APP.y, width: SRC_W, height: APP.h, border: `1px solid ${COLORS.lineStrong}` }}>
        <div style={title}>A trade on imagine.fun</div>
        <div style={sub}>
          the same 0.5%,
          <br />
          plus a 1.5% app fee
        </div>
      </div>
      <div style={{ ...box, left: 72, top: GRAD.y, width: SRC_W, height: GRAD.h, background: "transparent", boxShadow: "none", border: `1px dashed ${COLORS.lineStrong}` }}>
        <div style={title}>After graduation</div>
        <div style={sub}>its Raydium pool's fee share</div>
      </div>

      {/* arrow labels */}
      <div style={{ position: "absolute", left: 432, top: 196, ...mono(19, COLORS.fg), whiteSpace: "nowrap" }}>0.5% on-chain trading fee</div>
      <div style={{ position: "absolute", left: 432, top: 342, ...mono(28, COLORS.fg), whiteSpace: "nowrap" }}>2% into the pool</div>

      {/* the vault */}
      <div
        style={{
          ...box,
          left: VAULT.x,
          top: VAULT.y,
          width: VAULT.w,
          height: VAULT.h,
          borderRadius: 32,
          border: `2px solid ${COLORS.mint}`,
          boxShadow: "0 0 0 8px rgba(94,233,181,0.07), 0 0 70px rgba(94,233,181,0.22), inset 0 1px 0 rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <div style={{ ...mono(17, COLORS.steelHi), letterSpacing: "0.2em", textTransform: "uppercase" }}>one per coin</div>
        <div style={{ fontWeight: 800, fontSize: 33, lineHeight: 1.12, marginTop: 12, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>The coin's pool</div>
        <div style={{ ...sub, marginTop: 12, fontSize: 21 }}>paid in its pair asset</div>
      </div>
      <div style={{ position: "absolute", left: VAULT.x - 90, top: VAULT.y + VAULT.h + 26, width: VAULT.w + 180, textAlign: "center", fontSize: 16.5, lineHeight: 1.45, color: COLORS.muted }}>
        Raydium LaunchLab protocol fee <span style={mono(16.5, COLORS.fgSoft)}>0.25%</span> — Raydium's.
        <br />
        IMAGINE platform fee <span style={mono(16.5, COLORS.fgSoft)}>0%</span>.
      </div>

      {/* outputs */}
      <div style={{ ...box, left: OUT_X, top: LOCKERS.y, width: OUT_W, height: LOCKERS.h, border: "1px solid rgba(94,233,181,0.5)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={mono(52, COLORS.mint)}>90%</span>
          <span style={{ ...title, fontSize: 32 }}>→ lockers</span>
        </div>
        <div style={{ ...sub, marginTop: 6, whiteSpace: "nowrap" }}>by weight, streamed over 1 hour</div>
      </div>
      <div style={{ ...box, left: OUT_X, top: TREASURY.y, width: OUT_W, height: TREASURY.h, padding: "0 24px", display: "flex", alignItems: "center", gap: 14 }}>
        <span style={mono(34, COLORS.steelHi)}>10%</span>
        <span style={{ ...title, fontWeight: 600, color: COLORS.fgSoft }}>→ treasury</span>
      </div>
      <div
        style={{
          ...box,
          left: OUT_X,
          top: CREATOR.y,
          width: OUT_W,
          height: CREATOR.h,
          padding: "0 24px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "transparent",
          boxShadow: "none",
          borderStyle: "dashed",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={mono(34, COLORS.muted)}>0%</span>
          <span style={{ ...title, fontWeight: 600, color: COLORS.muted }}>→ creator</span>
        </div>
        <div style={{ ...sub, color: COLORS.muted, marginTop: 2 }}>earns only by locking</div>
      </div>

      {/* pairs */}
      <div style={{ position: "absolute", left: 72, top: 650, ...mono(18, COLORS.muted), letterSpacing: "0.18em", textTransform: "uppercase" }}>
        Lockers are paid in the coin's pair
      </div>
      <div style={{ position: "absolute", left: 72, top: 686, display: "flex", gap: 18 }}>
        <PairPill ticker="SOL" />
        <PairPill ticker="USDC" />
        <PairPill ticker="NVDAx" />
      </div>
      <div style={{ position: "absolute", left: 72, top: 784, width: 1190, fontSize: 17.5, lineHeight: 1.45, color: COLORS.muted }}>
        The 0.5% is enforced on-chain by Raydium LaunchLab. The creator earns nothing from fees, only by locking like everyone else.
      </div>

      <SignOff size={28} right={72} bottom={52} />
    </AbsoluteFill>
  );
}
