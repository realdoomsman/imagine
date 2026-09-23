import { AbsoluteFill, useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "./theme";

/** The site's knurl texture, as a full-bleed background layer. */
export function Knurl() {
  return (
    <AbsoluteFill
      style={{
        backgroundImage:
          "repeating-linear-gradient(-45deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 2px, transparent 2px, transparent 9px)",
        opacity: 0.55,
      }}
    />
  );
}

/**
 * A faint animated grain pass.
 *
 * Flat digital gradients are the single loudest "this was generated" tell in
 * motion work; a little moving noise reads as film and costs nothing.
 */
export function Grain() {
  const frame = useCurrentFrame();
  const shift = (frame % 6) * 37;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: 0.05,
        backgroundImage:
          "repeating-conic-gradient(rgba(255,255,255,0.35) 0% 25%, transparent 0% 50%)",
        backgroundSize: "3px 3px",
        backgroundPosition: `${shift}px ${shift * 0.6}px`,
        mixBlendMode: "overlay",
      }}
    />
  );
}

export function Rule({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div
      style={{
        fontFamily: FONTS.mono,
        fontSize: 20,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: COLORS.muted,
        textAlign: align,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

export function Panel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `2px solid ${COLORS.border}`,
        borderRadius: 3,
        padding: 40,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
