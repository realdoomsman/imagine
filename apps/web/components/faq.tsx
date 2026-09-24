import { Reveal } from "./motion";

/**
 * The questions people actually ask, answered the way the program answers
 * them. Rendered as native disclosure elements so it works without a script,
 * and emitted as FAQPage structured data so search engines can show it.
 */
const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "So it is staking?",
    a: "Staking usually pays you in newly printed tokens, which dilutes everyone who did not stake. This pays you in SOL that traders already spent on fees. Nothing is minted, nothing is promised; if a coin stops trading, its number goes to zero.",
  },
  {
    q: "What stops VISE from taking the vault?",
    a: "The absence of an instruction that could. There is no admin transfer path in the program, not a disabled one, not a timelocked one. The pause switch blocks new pools and nothing else; claiming and unlocking cannot be paused. Every claim is checkable against the deployed bytecode.",
  },
  {
    q: "Where does the money actually come from?",
    a: "Two streams, both in SOL. 2% of the SOL on every trade routed through vise.fun lands in the coin's vault inside the same transaction as the swap. And the coin's pump.fun creator fees are pointed at the vault at launch by pump's own fee-sharing program, with an instruction that revokes its own admin, so nobody can point them back.",
  },
  {
    q: "How is my share worked out?",
    a: "Your weight is amount times a multiplier. The multiplier runs on a square-root curve from 1.00× at four hours to 4.00× at a year: a week is 1.41×, thirty days 1.86×, ninety 2.49×. Even a four-hour lock earns its share. Locking at least 0.1%, 0.5% or 1% of the supply adds 10%, 25% or 50% on top. Your share of each SOL that arrives is your weight over the pool's total weight.",
  },
  {
    q: "Is there a limit to what a lock can earn?",
    a: "Yes, on coins launched from now on. A lock can earn at most the SOL value of its tokens when you locked them, times its multiplier: lock 1 SOL worth for a year at 6.00× and it can earn up to 6 SOL. Once it has, it stops earning and the locks still earning split what comes in. Fees beyond what the open locks can still earn go to the treasury as they arrive. Your tokens stay yours and unlock on their date either way.",
  },
  {
    q: "Can I get out early?",
    a: "Always. Breaking a lock forfeits your unclaimed rewards to the lockers who stayed and burns a slice of your principal, scaled by how much of the term you did not serve. Leave on day one of a hundred and it hurts; on day ninety-nine it barely registers. Claiming, on the other hand, never touches the lock.",
  },
  {
    q: "What does the creator get?",
    a: "Nothing by default. Pools split 90% to lockers and 10% to VISE, and the split is frozen on the pool when it is created. A creator earns the way everyone else does, by locking, and their founding lock is public on the coin's page from block one.",
  },
  {
    q: "I do not have a wallet.",
    a: "Sign in with Google. You get an ordinary Solana address held for you: send SOL or coins to it, lock from it, withdraw whenever, and export the secret key any time to import it into Phantom or anywhere else. There is no step where VISE gets to say no.",
  },
  {
    q: "What is the catch?",
    a: "Illiquidity. You cannot sell a locked bag without burning part of it, and a locked bag in a coin going to zero is worse than an unlocked one. If you were not going to hold anyway, do not lock. If you were, this pays you for the holding you were already doing.",
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
    <section className="border-t border-steel-780">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }} />
      <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-32">
        <Reveal>
          <span className="rule-label">Straight answers</span>
          <h2 className="t-section mt-5 max-w-[12ch]">The questions, before you ask them.</h2>
          <p className="mt-6 max-w-[40ch] text-[15px] leading-relaxed text-steel-500">
            Nothing here is a promise. Each answer is a property of the program,
            and the <a href="/docs/security" className="text-torch">security page</a> shows
            where to check it.
          </p>
        </Reveal>
        <Reveal delay={100}>
          <div className="divide-y divide-steel-780 border-y border-steel-780">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-semibold text-steel-50 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span className="relative size-5 shrink-0 text-torch" aria-hidden="true">
                    <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-current transition-transform duration-300 group-open:rotate-90" />
                    <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-current" />
                  </span>
                </summary>
                <p className="mt-3 max-w-[64ch] text-[14.5px] leading-relaxed text-steel-400">{item.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
