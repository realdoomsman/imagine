import { FONT_FAMILY } from "./fonts";

/**
 * The video palette is the site palette. Same hexes, same type, same motion
 * curve — a teaser that does not match the product reads as stock footage.
 */
export const COLORS = {
  ground: "#08090B",
  panel: "#0E1013",
  raised: "#161A1F",
  border: "#232A32",
  muted: "#5A6675",
  body: "#A8B3C1",
  heading: "#ECEFF3",
  torch: "#FF5A1F",
  torchDim: "#B33A11",
  verdi: "#3FCF8E",
  rust: "#E5484D",
} as const;

export const FONTS = {
  display: `${FONT_FAMILY.display}, system-ui, sans-serif`,
  sans: `${FONT_FAMILY.sans}, system-ui, sans-serif`,
  mono: `${FONT_FAMILY.mono}, ui-monospace, monospace`,
} as const;

export const FPS = 60;

/** The clamp: fast in, settle hard. Matches `--ease-clamp` on the site. */
export function clampEase(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - c, 3.2);
}

/**
 * The program's duration curve, mirrored so every number on screen is one a
 * locker would actually get: 1x at 7 days rising on a square root to 4x at
 * 365. `grip` is the closed fraction of the vise, 0..1.
 */
export function daysFor(grip: number): number {
  return Math.round(7 + grip * 358);
}

export function multiplierFor(days: number): string {
  const t = Math.max(0, Math.min((days - 7) / 358, 1));
  return (1 + 3 * Math.sqrt(t)).toFixed(2);
}
