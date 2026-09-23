import { Composition } from "remotion";
import { Explainer, EXPLAINER_DURATION } from "./Explainer";
import { Teaser, TEASER_DURATION } from "./Teaser";
import { Vertical, VERTICAL_DURATION } from "./Vertical";
import { FPS } from "./theme";

export function Root() {
  return (
    <>
      <Composition
        id="Teaser"
        component={Teaser}
        durationInFrames={TEASER_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="Explainer"
        component={Explainer}
        durationInFrames={EXPLAINER_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="Vertical"
        component={Vertical}
        durationInFrames={VERTICAL_DURATION}
        fps={FPS}
        width={1080}
        height={1920}
      />
    </>
  );
}
