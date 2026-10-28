import Link from "next/link";
import { ImagineChart } from "./imagine-chart";
import { STONKFUN_URL } from "@imagine/sdk";

const PAIRS = ["NVDAx", "SPYx", "TSLAx", "USDC", "SOL"];

export function Hero() {
  return (
    <section className="container-x pt-6 sm:pt-8">
      <div className="card grid-bg relative isolate overflow-hidden">
        {/* The signature glow, low and off to the side so the type stays crisp. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-40 -top-40 -z-10 size-[620px] rounded-full opacity-[0.16] blur-3xl"
          style={{ background: "var(--dream)" }}
        />
        <div className="grid items-center gap-10 p-5 sm:p-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12 lg:p-14">
          <div>
            <a
              href={STONKFUN_URL}
              target="_blank"
              rel="noreferrer"
              className="pill pill-pair h-8 px-3 transition-colors hover:border-line-strong"
            >
              <i className="pill-dot pulse-dot" aria-hidden="true" />
              <span className="pill-label">Lock-to-earn for coins on</span>
              <b className="font-sans">StonkFun</b>
            </a>

            <h1 className="t-hero mt-6">
              Imagine
              <br />
              everyone <span className="dream-text">locks.</span>
            </h1>

            <p className="t-lede mt-6">
              Launch a coin on StonkFun, paired with any stock. Every trade pays the holders who
              lock it — in the stock it&apos;s paired with. Lock longer, earn a bigger cut.
            </p>

            <div className="mt-8 flex items-center gap-3">
              <Link href="/launch" className="btn btn-dream btn-lg flex-1 px-3 sm:flex-none sm:px-6">
                Launch a coin
              </Link>
              <Link href="/coins" className="btn btn-ghost btn-lg flex-1 px-3 sm:flex-none sm:px-6">
                Browse coins
              </Link>
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-2">
              <span className="eyebrow mr-1">Lockers earn in</span>
              {PAIRS.map((symbol) => (
                <span key={symbol} className="pill num h-7 text-[12px] text-fg">
                  {symbol}
                </span>
              ))}
            </div>
          </div>

          <ImagineChart className="w-full lg:max-w-[560px] lg:justify-self-end" />
        </div>
      </div>
    </section>
  );
}
