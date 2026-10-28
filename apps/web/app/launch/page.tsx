import { LaunchForm } from "@/components/launch-form";

export const metadata = {
  title: "Launch a coin",
  description:
    "Launch a coin on StonkFun, paired with a stock, a currency, SOL or any StonkFun pair asset. Every trade through Imagine pays the holders who lock it — in the asset it's paired with.",
};

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
            Your coin launches on StonkFun like any other, paired with the asset you pick. What changes is where its
            fees go: into a pool that pays whoever locks it, in that asset.
          </p>
          <LaunchForm />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Explainer
            step="What you sign"
            items={[
              "Create the coin on StonkFun (Raydium LaunchLab), paired with your pick, with the pool's vault as its creator address.",
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
