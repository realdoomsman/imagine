import { LaunchForm } from "@/components/launch-form";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/launch",
  title: "Launch a coin",
  description:
    "Launch a coin on Raydium LaunchLab, paired with SOL, USDC, a tokenized stock like NVDAx or any pair asset LaunchLab supports. Every trade pays the holders who lock it — in the asset it's paired with.",
});

export default function LaunchPage() {
  return (
    <div className="container-x py-14 lg:py-20">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="min-w-0">
          <p className="eyebrow">Launch</p>
          <h1 className="t-h1 mt-4">
            Imagine a coin people <span className="dream-text">hold.</span>
          </h1>
          <p className="t-lede mt-5">
            Your coin launches on Raydium LaunchLab under the IMAGINE platform, paired with the asset you pick. Every
            trade anywhere pays an on-chain fee into a pool for whoever locks it, in that asset — and you earn
            nothing from fees, only by locking like everyone else.
          </p>
          <LaunchForm />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Explainer
            step="What you sign"
            items={[
              "Create the coin on Raydium LaunchLab, paired with your pick, with its on-chain trading fee pointed at the coin's pool.",
              "Your first buy, in the same transaction, so nobody buys between creation and you.",
              "Open the Imagine pool with your founding lock.",
            ]}
          />
          <Explainer
            step="What you give up"
            items={[
              "Part of your first buy stays locked for the term you choose. Leaving early burns some of it.",
              "You take no cut of the stream. Lockers get 90% — including you, through your founding lock.",
              "You can't change the terms afterwards. Nobody can.",
            ]}
          />
          <Explainer
            step="What you get"
            items={[
              "A reason for holders not to sell that isn't a promise — it's a payment, in the asset your coin is paired with.",
              "A public number on your coin's page: how much of the supply is locked, and for how long.",
              "A stream that keeps paying your holders even if you disappear.",
            ]}
          />
        </aside>
      </div>
    </div>
  );
}

function Explainer({ step, items }: { step: string; items: string[] }) {
  return (
    <section className="card p-6">
      <h2 className="eyebrow">{step}</h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-[13.5px] leading-relaxed text-fg-soft">
            <span className="mt-[9px] size-1.5 shrink-0 rounded-full" style={{ background: "var(--dream)" }} />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
