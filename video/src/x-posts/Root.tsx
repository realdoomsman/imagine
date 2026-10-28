import { Composition, Still } from "remotion";
import { FPS } from "../theme";
import { P01, P01_FRAMES } from "./P01";
import { P02 } from "./P02";
import { P03 } from "./P03";
import { P04, P04Props } from "./P04";
import { P05, P05_FRAMES } from "./P05";
import { XAvatar, XBanner } from "./Profile";

// Post-pivot captures (ProgramSdk) and the IMAGINE platform config confirmed on mainnet.
const P04_PROPS: P04Props = {
  cargoFile: "cargo-test-raydium.txt",
  sdkFile: "sdk-test-raydium.txt",
  sdkSuite: "one-transaction launch",
  platformConfig: "DYtCiTPJoqCyDApm45b9C7D3xotkSDecJaAtQHaQNULk",
};

/** X launch post assets. Render with `--public-dir out/x/raw` (see render.sh). */
export function XPostsRoot() {
  return (
    <>
      <Composition id="XP01" component={P01} durationInFrames={P01_FRAMES} fps={FPS} width={1920} height={1080} />
      <Composition id="XP05" component={P05} durationInFrames={P05_FRAMES} fps={FPS} width={1920} height={1080} />
      <Still id="XP02" component={P02} width={1600} height={900} />
      <Still id="XP03" component={P03} width={1600} height={900} />
      <Still id="XP04" component={P04} defaultProps={P04_PROPS} width={1600} height={900} />
      <Still id="XAvatar" component={XAvatar} width={400} height={400} />
      <Still id="XBanner" component={XBanner} width={1500} height={500} />
    </>
  );
}
