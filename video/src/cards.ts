import type { CardProps } from "./Card";

/** The X cards (1600×900), in posting order. Copy states only facts the product guarantees. */
export const CARDS: Array<{ id: string; props: CardProps }> = [
  {
    id: "01-imagine",
    props: {
      kind: "chart",
      lines: ["Imagine the", "chart if", "nobody sold."],
      accent: 2,
      sub: "Every trade on an IMAGINE coin pays the holders who lock it.",
    },
  },
  {
    id: "02-stock",
    props: {
      kind: "pairs",
      eyebrow: "Lock-to-earn on StonkFun",
      lines: ["Lock the meme.", "Earn the stock."],
      accent: 1,
      sub: "Coins launch on StonkFun, paired with a stock. Lockers are paid in that pair: a coin paired with NVDAx pays NVDAx; a SOL pair pays SOL.",
      pairs: ["NVDAx", "SPYx", "TSLAx", "SOL", "USDC"],
    },
  },
  {
    id: "03-flow",
    props: { kind: "flow", eyebrow: "Where the fee goes", lines: ["Every trade pays", "the people who lock."], accent: 1 },
  },
  {
    id: "04-dial",
    props: {
      kind: "dial",
      eyebrow: "Commit",
      lines: ["Lock longer,", "earn a bigger cut."],
      accent: 1,
      sub: "Your share of the stream is weighted by how long you commit: 1× at four hours, 4× at a year.",
      days: 365,
    },
  },
  {
    id: "05-promises",
    props: { kind: "statement", lines: ["Paid in NVDAx,", "not promises."], accent: 1, sub: "90% of each pool's inflow streams to its lockers by weight. 10% to the treasury. Terms frozen per pool." },
  },
  {
    id: "06-stream",
    props: {
      kind: "statement",
      lines: ["Selling is free.", "It just costs you", "the stream."],
      accent: 1,
      sub: "Unlock early and a penalty is burned; the stream stays with the holders who kept their word.",
    },
  },
  {
    id: "07-rules",
    props: {
      kind: "statement",
      eyebrow: "The rules don't move",
      lines: ["No admin withdraw path.", "Creator locks first."],
      accent: 1,
      sub: "Each pool's terms are frozen at launch. Claims and unlocks can't be paused.",
    },
  },
];
