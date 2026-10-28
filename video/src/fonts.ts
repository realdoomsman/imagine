import { loadFont as loadSora } from "@remotion/google-fonts/Sora";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

/**
 * The brand faces, loaded into Remotion's Chromium before the first frame:
 * Sora for display and UI, Geist Mono for numbers, tickers and addresses.
 * Only the weights and subset the compositions use.
 */
const sora = loadSora("normal", {
  weights: ["400", "600", "700", "800"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
});
const geistMono = loadGeistMono("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
});

export const FONT_FAMILY = {
  sans: sora.fontFamily,
  mono: geistMono.fontFamily,
} as const;
