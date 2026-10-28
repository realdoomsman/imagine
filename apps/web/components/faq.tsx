import { Reveal } from "./motion";

/**
 * The questions people actually ask, answered the way the program answers
 * them. Native disclosure elements, so it works without a script, and
 * emitted as FAQPage structured data.
 */
const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What is IMAGINE?",
    a: "Lock-to-earn for coins launched on StonkFun. Every IMAGINE coin has a vault. Trading fees flow into it, and 90% of what arrives streams to the holders who locked, weighted by how much they locked and for how long.",
  },
  {
    q: "Why do lockers earn the pair asset and not the coin?",
    a: "Every StonkFun coin is paired with an asset: a tokenized stock like NVDAx or SPYx, a currency like USDC, or SOL. Fees are taken from that side of each trade, so lockers are paid in it. A coin paired with NVDAx pays its lockers NVDAx; a SOL-paired coin pays SOL; a USDC-paired coin pays USDC. Nothing is minted.",
  },
  {
    q: "Where does the money come from?",
    a: "Three places, all landing in the coin's vault. imagine.fun adds a 1% app fee to trades it routes, paid into that coin's pool in the same transaction. StonkFun forwards a creator share to each coin's creator address, and for IMAGINE coins that address is the vault itself. And anyone can donate. How much StonkFun forwards is StonkFun's policy, so we don't promise an amount.",
  },
  {
    q: "Is it a normal StonkFun coin?",
    a: "Yes. It launches on StonkFun through Raydium LaunchLab and trades like any other StonkFun coin. StonkFun charges 1% on curve trades and the Raydium LaunchLab protocol fee applies, the same as for every coin there. IMAGINE adds the vault and the locks.",
  },
  {
    q: "How is my share worked out?",
    a: "Your weight is amount times a multiplier. The multiplier rises on a square-root curve from 1.00× at four hours to 4.00× at a year: a week is 1.41×, thirty days 1.86×, ninety 2.49×. Locking at least 0.1%, 0.5% or 1% of the supply adds 10%, 25% or 50% on top. Your share of what arrives is your weight over the pool's total weight.",
  },
  {
    q: "Is there a limit to what a lock can earn?",
    a: "Yes. A lock can earn at most what its tokens were worth when you locked them, measured in the pair asset, times its multiplier. Once it has, it stops earning and the locks still earning split what comes in. Your tokens stay yours and unlock on their date either way.",
  },
  {
    q: "Can I get out early?",
    a: "Always. Breaking a lock forfeits your unclaimed rewards to the lockers who stayed and burns a slice of your principal, scaled by how much of the term you did not serve. Claiming, on the other hand, never touches the lock.",
  },
  {
    q: "What does the creator get?",
    a: "Nothing by default. Pools split 90% to lockers and 10% to the treasury, frozen when the pool is created. The creator has to lock first, before anyone else can, and that founding lock is public on the coin's page.",
  },
  {
    q: "What stops anyone taking the vault?",
    a: "The absence of an instruction that could. There is no admin withdraw path in the program, a pool's terms are frozen when it is created, and claiming and unlocking can't be paused.",
  },
  {
    q: "I don't have a wallet.",
    a: "Sign in with Google. You get an ordinary Solana address held for you: fund it, lock from it, withdraw whenever, and export the secret key at any time to use it in any other wallet.",
  },
  {
    q: "What's the catch?",
    a: "Illiquidity. You can't sell a locked bag without burning part of it, and a locked bag in a coin going to zero is worse than an unlocked one. A coin nobody trades pays nothing. If you weren't going to hold anyway, don't lock.",
  },
];

export function Faq() {
  const json = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
  return (
    <section className="container-x grid gap-12 py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-28">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }} />
      <Reveal>
        <span className="eyebrow">Questions</span>
        <h2 className="t-h1 mt-4 max-w-[12ch]">Before you lock anything.</h2>
        <p className="mt-6 max-w-[40ch] text-[15px] leading-relaxed text-fg-soft">
          Every answer is a property of the program or a fee you can see on-chain. The{" "}
          <a href="/docs/security" className="text-steel-hi underline decoration-steel-hi/40 underline-offset-4 hover:decoration-steel-hi">
            security page
          </a>{" "}
          shows where to check.
        </p>
      </Reveal>
      <Reveal delay={100}>
        <div className="space-y-2">
          {FAQ.map((item) => (
            <details key={item.q} className="card card-hover group px-5 open:border-line-strong">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-[16px] font-semibold text-fg [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line text-fg-soft transition-transform duration-200 group-open:rotate-45 group-open:text-mint"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <p className="max-w-[64ch] pb-5 text-[14.5px] leading-relaxed text-fg-soft">{item.a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
