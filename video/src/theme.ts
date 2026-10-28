import { FONT_FAMILY } from "./fonts";

/** The site palette (apps/web/app/globals.css), hex for hex. */
export const COLORS = {
  ink: "#071013",
  ink1: "#0B171B",
  ink2: "#102127",
  ink3: "#18262A",
  ink4: "#20363D",
  line: "#20363D",
  lineStrong: "#2F4F58",
  fg: "#F3F8F8",
  fgSoft: "#A4C5CF",
  muted: "#768A93",
  steel: "#69AAC1",
  steelHi: "#8CC8DC",
  mint: "#5EE9B5",
  mintDeep: "#39D6A3",
  rose: "#FB7185",
  roseDeep: "#F23674",
} as const;

export const DREAM_STOPS = [
  { at: 0, color: "#8CC8DC" },
  { at: 0.55, color: "#5EE9B5" },
  { at: 1, color: "#C7F9E5" },
] as const;

export const DREAM = "linear-gradient(120deg, #8CC8DC 0%, #5EE9B5 55%, #C7F9E5 100%)";

export const FONTS = {
  sans: `${FONT_FAMILY.sans}, system-ui, sans-serif`,
  mono: `${FONT_FAMILY.mono}, ui-monospace, monospace`,
} as const;

export const FPS = 30;

/** Seconds to frames. */
export const s = (seconds: number) => Math.round(seconds * FPS);

/** Soft settle: quick start, long gentle landing. */
export function ease(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - c, 3);
}

export function easeInOut(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export const HOUR = 3_600;
export const DAY = 86_400;

/**
 * The shipped lock terms, mirrored exactly from `ECONOMICS` in
 * packages/sdk/src/constants.ts (the video package does not depend on the SDK):
 * 4 hours to 365 days, sqrt curve, 4.00× at the top.
 */
export const LOCK_TERMS = {
  minLockSecs: 4 * HOUR,
  maxLockSecs: 365 * DAY,
  maxMultiplierBps: 40_000,
} as const;

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) / 2n;
    if (y >= x) return x;
    x = y;
  }
}

/**
 * `durationMultiplierBps` from packages/sdk/src/math.ts on the sqrt curve,
 * same integer math, formatted like the SDK's `formatMultiplier` (without ×).
 */
export function multiplierFor(seconds: number): string {
  const { minLockSecs, maxLockSecs, maxMultiplierBps } = LOCK_TERMS;
  const clamped = Math.min(Math.max(Math.round(seconds), minLockSecs), maxLockSecs);
  const span = BigInt(maxLockSecs - minLockSecs);
  const travelled = BigInt(clamped - minLockSecs);
  const bps = 10_000n + ((BigInt(maxMultiplierBps) - 10_000n) * isqrt(travelled * span)) / span;
  return (Number(bps) / 10_000).toFixed(2);
}

/** Lock seconds at `commitment` (0..1) of the way around the dial, linear in time. */
export function secondsFor(commitment: number): number {
  const { minLockSecs, maxLockSecs } = LOCK_TERMS;
  return Math.round(minLockSecs + Math.min(Math.max(commitment, 0), 1) * (maxLockSecs - minLockSecs));
}

/** "4h" under a day, whole days above it. */
export function durationLabel(seconds: number): string {
  return seconds < DAY ? `${Math.round(seconds / HOUR)}h` : `${Math.floor(seconds / DAY)}d`;
}
