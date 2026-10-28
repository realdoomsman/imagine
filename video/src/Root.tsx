import { Composition, Still } from "remotion";
import { Card, OG_PROPS } from "./Card";
import { Explainer, EXPLAINER_DURATION } from "./Explainer";
import { Avatar, Banner } from "./Profile";
import { Promo, PROMO_DURATION } from "./Promo";
import { Teaser, TEASER_DURATION } from "./Teaser";
import { Vertical, VERTICAL_DURATION } from "./Vertical";
import { FPS } from "./theme";

export function Root() {
  return (
    <>
      <Composition id="Promo" component={Promo} durationInFrames={PROMO_DURATION} fps={FPS} width={1920} height={1080} />
      <Composition id="Teaser" component={Teaser} durationInFrames={TEASER_DURATION} fps={FPS} width={1920} height={1080} />
      <Composition id="Explainer" component={Explainer} durationInFrames={EXPLAINER_DURATION} fps={FPS} width={1920} height={1080} />
      <Composition id="Vertical" component={Vertical} durationInFrames={VERTICAL_DURATION} fps={FPS} width={1080} height={1920} />
      {/* Minimal defaults: Remotion merges --props over these, so optional fields here would leak into every card. */}
      <Still id="XCard" component={Card} defaultProps={{ kind: "statement", lines: ["Imagine everyone locks."] }} width={1600} height={900} />
      <Still id="Card" component={Card} defaultProps={OG_PROPS} width={1200} height={630} />
      <Still id="Avatar" component={Avatar} width={400} height={400} />
      <Still id="Banner" component={Banner} width={1500} height={500} />
    </>
  );
}
