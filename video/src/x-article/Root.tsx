import { Still } from "remotion";
import { A01Hero, A02Flow, A03Curve, A04Example, A05Rules, A06Launch, A07Coin, A08Compare, A09Proof, Cover } from "./Stills";

/**
 * X article images → video/out/x/article/. Render with
 * `npx remotion still src/x-article/index.ts <id> out/x/article/<id>.png --public-dir=out/x/raw`
 * (see render.sh beside this file).
 */
export function ArticleRoot() {
  return (
    <>
      <Still id="cover" component={Cover} width={1500} height={600} />
      <Still id="a01-hero" component={A01Hero} width={1600} height={900} />
      <Still id="a02-flow" component={A02Flow} width={1600} height={900} />
      <Still id="a03-curve" component={A03Curve} width={1600} height={900} />
      <Still id="a04-example" component={A04Example} width={1600} height={900} />
      <Still id="a05-rules" component={A05Rules} width={1600} height={900} />
      <Still id="a06-launch" component={A06Launch} width={1600} height={900} />
      <Still id="a07-coin" component={A07Coin} width={1600} height={900} />
      <Still id="a08-compare" component={A08Compare} width={1600} height={900} />
      <Still id="a09-proof" component={A09Proof} width={1600} height={900} />
    </>
  );
}
