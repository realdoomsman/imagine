import type { CardProps } from "./Card";

/**
 * The twenty stills for launch week, in posting order. Each is one idea; the
 * copy that goes with it lives in docs/LAUNCH-X.md under the same number.
 */
export const CARDS: Array<{ id: string; props: CardProps }> = [
  { id: "01-thesis", props: { kind: "statement", lines: ["Selling is free.", "Holding is not."], sub: "Every platform in this market pays for the first and charges for the second. That is backwards, and it is fixable." } },
  { id: "02-revenue", props: { kind: "figure", figure: "1", label: "Revenue streams a memecoin has", sub: "The fee people pay to trade it. On pump.fun, about 1% of every buy and sell, in SOL, for the life of the coin. Today none of it reaches the people holding." } },
  { id: "03-flow", props: { kind: "flow", title: "Where the fee goes now.\nWhere it goes with a vise on it.", steps: ["A trade on pump.fun", "2% app fee + the creator's cut", "The coin's own vault", "Everyone who locked"], sub: "The fee instruction rides inside the swap. If the trade fails, the fee is never taken." } },
  { id: "04-split", props: { kind: "split", title: "One split. Frozen at launch." } },
  { id: "05-ladder", props: { kind: "ladder", title: "Longer locks\ntake more.", sub: "A square-root curve from 1× at seven days to 4× at a year. Short locks are still worth making." } },
  { id: "06-tiers", props: { kind: "tiers", title: "Size counts too.", sub: "Tiers are a share of total supply, so a whale and a minnow are measured on the same scale." } },
  { id: "07-vise-30", props: { kind: "vise", lines: ["Thirty days.", "Already 1.76×."], days: 30 } },
  { id: "08-vise-365", props: { kind: "vise", lines: ["A year.", "Four times the claim", "on the same stream."], days: 365 } },
  { id: "09-claim", props: { kind: "statement", lines: ["Claiming never", "touches the lock.", "The lock never", "blocks a claim."], accent: 1 } },
  { id: "10-penalty", props: { kind: "list", title: "Leaving early costs two things.\nBoth go to the people who stayed.", items: ["Your unclaimed rewards are forfeited into the pool.", "A slice of your principal is burned, scaled by how much of the term you did not serve.", "Leave on day 1 of 100 and it hurts. Day 99, it barely registers."] } },
  { id: "11-cannot", props: { kind: "list", title: "What the program cannot do.", items: ["Move a pool's SOL or tokens to an admin. The instruction does not exist.", "Change a pool's terms after creation. They are copied on and never rewritten.", "Pause a claim or an unlock. The pause switch only blocks new pools.", "Redirect the fee stream. The routing call revokes its own admin."] } },
  { id: "12-program", props: { kind: "figure", figure: "0", label: "Admin withdraw instructions in the bytecode", sub: "VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb. Read it." } },
  { id: "13-creator", props: { kind: "compare", title: "What a creator gets.", left: { head: "Elsewhere", rows: ["A cut of every trade, forever", "Paid whether holders stay or not", "Nobody can see what you committed"] }, right: { head: "On VISE", rows: ["0% of the stream by default", "You earn by locking, same as everyone", "Your founding lock is public from block one"] } } },
  { id: "14-google", props: { kind: "statement", lines: ["No wallet?", "Sign in with Google."], sub: "You get an ordinary Solana address, held for you. Send coins to it, lock from it, withdraw whenever. Export the key any time; it is yours." } },
  { id: "15-apr", props: { kind: "quote", quote: "Every number on the site is trailing, realised fees divided by locked value. Nothing is projected. If a coin stops trading its number goes to zero, and it should.", attribution: "On APR" } },
  { id: "16-honest", props: { kind: "statement", lines: ["This does not make", "a bad coin good."], sub: "A coin with no volume pays nothing. A locked bag in a coin going to zero is worse than an unlocked one. If you were not going to hold, do not lock." } },
  { id: "17-rounding", props: { kind: "quote", quote: "A randomised test drives thousands of locks, deposits, claims and exits and asserts, after every single step, that the vault can still pay everyone it owes.", attribution: "Rounding always favours the pool" } },
  { id: "18-launch", props: { kind: "flow", title: "Launching takes one form.", steps: ["Name, ticker, an image from your disk", "Dev buy, and how much of it you lock", "Create on pump.fun, open the pool, route the fees", "Live, with a vise on it"], sub: "The routing call is the last signature. After it lands, nobody can redirect the stream." } },
  { id: "19-staking", props: { kind: "compare", title: "\"So it is staking?\"", left: { head: "Staking", rows: ["Pays you in newly printed tokens", "Dilutes everyone who did not stake", "APR is whatever the emissions say"] }, right: { head: "VISE", rows: ["Pays you in SOL traders already spent", "Nothing is minted", "APR is realised fees, trailing"] } } },
  { id: "20-close", props: { kind: "statement", lines: ["Hold under pressure."], sub: "vise.fun" } },
];
