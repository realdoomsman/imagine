import { loadFont as loadBricolage } from "@remotion/google-fonts/BricolageGrotesque";
import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

/**
 * The brand faces, loaded into Remotion's Chromium before the first frame.
 *
 * Without this the renderer silently falls back to Arial and the videos stop
 * looking like the product — the exact failure that makes promo material read
 * as generic.
 */
// Only the weights and subset the compositions actually use: loading the full
// family pulls ~75 files and slows every render for no visible gain.
const bricolage = loadBricolage("normal", {
  weights: ["700"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
});
const geist = loadGeist("normal", {
  weights: ["400", "600"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
});
const geistMono = loadGeistMono("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
});

export const FONT_FAMILY = {
  display: bricolage.fontFamily,
  sans: geist.fontFamily,
  mono: geistMono.fontFamily,
} as const;

export const fontsReady = Promise.all([
  bricolage.waitUntilDone(),
  geist.waitUntilDone(),
  geistMono.waitUntilDone(),
]);
