import { ECONOMICS, formatPercent } from "@imagine/sdk";
import Link from "next/link";
import { formatBps } from "@/lib/format";
import type { PoolFees } from "@/lib/fees";

const PAIRS = ["SOL", "USDC", "NVDAx", "SPYx"];

/**
 * What the coin lists show before anything has launched: the case for being
 * first, the three steps, and the numbers a launcher signs up to — instead of
 * an empty grid. Server-rendered; `fees` are the live ones from the API.
 */
export function FirstLaunch({ fees, className = "" }: { fees: PoolFees; className?: string }) {
  const lockersShare = formatPercent((10_000 - ECONOMICS.treasuryShareBps) / 10_000, 0);
  const steps = [
    {
      title: "Pick a pair",
      body: "SOL, USDC, or a tokenized stock like NVDAx. Whatever the coin is paired with is what its lockers are paid in.",
    },
    {
      title: "Lock first",
      body: "Your founding lock opens the pool. Nobody can lock before you, and everyone can see what you committed.",
    },
    {
      title: "Every trade pays the lockers",
      body: `${formatBps(fees.poolFeeBps)} of every trade anywhere, ${formatBps(fees.poolFeeBps + fees.tradeFeeBps)} on imagine.fun, ${lockersShare} of it streamed to lockers by weight.`,
    },
  ];
  const facts = [
    { label: "Every trade, to the pool", value: formatBps(fees.poolFeeBps) },
    { label: "On imagine.fun", value: formatBps(fees.poolFeeBps + fees.tradeFeeBps) },
    { label: "To lockers", value: lockersShare },
    { label: "Creator cut", value: "0%" },
  ];

  return (
    <section
      aria-labelledby="first-launch-title"
      className={`card relative isolate overflow-hidden ${className}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-1/4 -top-1/2 -z-10 h-[140%] w-[80%] rounded-full opacity-[0.14] blur-3xl"
        style={{ background: "var(--dream)" }}
      />
      <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-14 lg:p-14">
        <div className="min-w-0">
          <span className="eyebrow">
            <i className="pill-dot pulse-dot" aria-hidden="true" />
            Open on Solana mainnet
          </span>
          <h2 id="first-launch-title" className="t-h2 mt-4 max-w-[16ch]">
            No coins yet. <span className="dream-text">Imagine yours first.</span>
          </h2>
          <p className="mt-5 max-w-[48ch] text-[15.5px] leading-relaxed text-fg-soft">
            Nothing has launched through IMAGINE yet. Launch a coin on Raydium, make the founding lock, and from its
            first trade the holders who lock it are paid in its pair.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/launch" className="btn btn-dream btn-lg">
              Launch the first coin
            </Link>
            <Link href="/how-it-works" className="btn btn-ghost btn-lg">
              How it works
            </Link>
          </div>
          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-4">
            {facts.map((fact) => (
              <div key={fact.label} className="bg-ink-1 px-4 py-3.5">
                <dt className="eyebrow text-[10px]">{fact.label}</dt>
                <dd className="num mt-1.5 text-[18px] font-semibold text-fg">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <ol className="flex flex-col gap-3">
          {steps.map((step, index) => (
            <li key={step.title} className="well flex gap-4 p-5">
              <span
                className="num flex size-9 shrink-0 items-center justify-center rounded-[10px] text-[12.5px] font-semibold text-ink"
                style={{ background: "var(--dream)" }}
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <h3 className="text-[16px] font-bold leading-snug tracking-[-0.02em] text-fg">{step.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-fg-soft">{step.body}</p>
                {index === 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Pairs coins launch with">
                    {PAIRS.map((symbol) => (
                      <li key={symbol} className="pill pill-pair h-6 px-2 text-[11px]">
                        <i className="pill-dot" aria-hidden="true" />
                        <b>{symbol}</b>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
