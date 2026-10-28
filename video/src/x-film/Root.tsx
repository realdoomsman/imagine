import { Composition } from "remotion";
import { FPS } from "../theme";
import { LAUNCH_DURATION, Launch } from "./Launch";
import { LaunchSquare } from "./Square";

/** The X launch film: render with src/x-film/index.ts (see scripts/render-launch-film.sh). */
export function FilmRoot() {
  return (
    <>
      <Composition id="Launch" component={Launch} durationInFrames={LAUNCH_DURATION} fps={FPS} width={1920} height={1080} />
      <Composition id="LaunchSquare" component={LaunchSquare} durationInFrames={LAUNCH_DURATION} fps={FPS} width={1080} height={1080} />
    </>
  );
}
