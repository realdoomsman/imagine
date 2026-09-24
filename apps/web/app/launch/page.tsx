import { AttachForm } from "@/components/attach-form";
import { LaunchForm } from "@/components/launch-form";

export const metadata = {
  title: "Launch a coin",
  description:
    "Launch on pump.fun through VISE. Your coin's creator fees are locked to its holders from the first block.",
};

export default function LaunchPage() {
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:py-20">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div>
          <p className="rule-label">Launch</p>
          <h1 className="t-section mt-5">
            An ordinary pump.fun coin.
            <br />
            With a vise on it.
          </h1>
          <p className="mt-5 max-w-lg text-[16px] text-steel-400">
            The coin is created on pump.fun exactly as any other. What changes is
            where its fees go: they are routed to a lock pool for its holders, and
            that routing is made permanent in the same session.
          </p>
          <LaunchForm />
          <AttachForm />
        </div>

        <aside className="space-y-4">
          <Explainer
            step="What you sign"
            items={[
              "Create the coin on pump.fun and buy the first bag.",
              "Point the coin's creator-fee stream at its lock pool — this call revokes its own admin, so it can never be redirected. Not by you, not by us.",
              "Open the pool with your founding lock.",
            ]}
          />
          <Explainer
            step="What you give up"
            items={[
              "Your dev buy is partly locked for the term you choose. You cannot take it out early without burning some of it.",
              "You take no cut of the fee stream. 90% belongs to whoever locks — including you, through your founding lock.",
              "You cannot change the terms afterwards. Nobody can.",
            ]}
          />
          <Explainer
            step="What you get"
            items={[
              "A reason for holders not to sell that is not a promise — it is a payment.",
              "A public number on your coin's page: what percentage of supply is clamped, and for how long.",
              "A fee stream that keeps paying your holders even if you disappear.",
            ]}
          />
        </aside>
      </div>
    </div>
  );
}

function Explainer({ step, items }: { step: string; items: string[] }) {
  return (
    <section className="panel p-6">
      <h2 className="rule-label">{step}</h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-[13px] leading-relaxed text-steel-400">
            <span className="mt-1.5 size-1 shrink-0 bg-torch" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
