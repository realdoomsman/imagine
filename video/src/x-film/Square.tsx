import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Backdrop, Lockup } from "../kit";
import { COLORS, FONTS, ease, s } from "../theme";
import { Launch } from "./Launch";
import TIMELINE from "./timeline.json";

/**
 * The feed cut, 1080×1080: the film letterboxed at full width, the lockup
 * above it and the voice-over burned in below, since feeds autoplay muted.
 */
export function LaunchSquare() {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const scale = 1080 / 1920;
  const filmTop = 214;
  const current = [...TIMELINE.vo].reverse().find((line) => t >= line.at - 0.05);
  const next = TIMELINE.vo[TIMELINE.vo.findIndex((line) => line === current) + 1];
  const shownUntil = Math.min(next ? next.at - 0.08 : TIMELINE.duration, (current?.at ?? 0) + 6.5);
  const show = current && t < shownUntil ? Math.min(ease((frame - s(current.at)) / 6), 1 - ease((frame - s(shownUntil) + 6) / 6)) : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink }}>
      <Backdrop glow={0.35} glowX={50} glowY={10} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 78, display: "flex", justifyContent: "center" }}>
        <Lockup size={44} />
      </div>
      <div style={{ position: "absolute", left: 0, top: filmTop, width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "0 0", overflow: "hidden" }}>
        <Launch />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: filmTop - 1, height: 1, background: COLORS.line }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: filmTop + 1080 * scale, height: 1, background: COLORS.line }} />
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: filmTop + 1080 * scale + 44,
          height: 170,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          textAlign: "center",
          fontFamily: FONTS.sans,
          fontWeight: 600,
          fontSize: 40,
          lineHeight: 1.3,
          letterSpacing: "-0.01em",
          color: COLORS.fg,
          opacity: show,
        }}
      >
        {current?.text}
      </div>
    </AbsoluteFill>
  );
}
