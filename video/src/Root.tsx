import { Composition, Still } from "remotion";
import { Card, CARD_DEFAULT } from "./Card";
import { Avatar, Banner } from "./Profile";
import { Explainer, EXPLAINER_DURATION } from "./Explainer";
import { Promo, PROMO_DURATION } from "./Promo";
import { Teaser, TEASER_DURATION } from "./Teaser";
import { Vertical, VERTICAL_DURATION } from "./Vertical";
import { FPS } from "./theme";

export function Root() {
  return (
    <>
      <Composition id="Promo" component={Promo} durationInFrames={PROMO_DURATION} fps={FPS} width={1920} height={1080} />
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
      <Still id="Card" component={Card} defaultProps={CARD_DEFAULT} width={1600} height={900} />
      <Still id="Avatar" component={Avatar} width={400} height={400} />
      <Still
        id="OG"
        component={Card}
        defaultProps={{ kind: "statement", lines: ["Hold under", "pressure."], accent: 1, sub: "Lock pump.fun coins and earn the fees they generate. Longer locks take a larger share." }}
        width={1200}
        height={630}
      />
      <Still
        id="Cover"
        component={Card}
        defaultProps={{ kind: "statement", lines: ["Selling is free.", "Holding is not."], sub: "Why every memecoin pays the people who leave and charges the people who stay, and what VISE does about it." }}
        width={2000}
        height={800}
      />
      <Still id="Banner" component={Banner} width={1500} height={500} />
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
