import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Docs",
  description: "How IMAGINE works, auto-compound, every fee on an IMAGINE coin, and the security model of the program.",
  path: "/docs",
});

const DOCS = [
  { href: "/how-it-works", title: "How it works", body: "Raydium LaunchLab coins with a lock pool: where fees come from and how weight is computed." },
  { href: "/docs/fees", title: "Fees", body: "The 0.5% on-chain trading fee, the 1.5% app fee, the 90/10 split, early exits." },
  { href: "/docs/security", title: "Security", body: "What the program cannot do, what it checks on-chain, and what can still go wrong." },
  { href: "/article", title: "The idea", body: "Why paying holders in whatever a coin is paired with changes what holding means." },
  { href: "/terms", title: "Terms", body: "The terms for using imagine.fun." },
  { href: "/privacy", title: "Privacy", body: "What the site stores and why." },
];

export default function DocsPage() {
  return (
    <div className="container-x pb-24 pt-14 lg:pb-32 lg:pt-20">
      <p className="eyebrow">Docs</p>
      <h1 className="t-h1 mt-4 max-w-[18ch]">Everything the program does, in writing.</h1>
      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DOCS.map((doc) => (
          <Link key={doc.href} href={doc.href} className="card group flex flex-col p-6">
            <span className="t-h3 flex items-center justify-between gap-3">
              {doc.title}
              <span className="text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-mint">→</span>
            </span>
            <span className="mt-3 text-[14px] leading-relaxed text-fg-soft">{doc.body}</span>
          </Link>
        ))}
      </div>

      <section id="auto-compound" className="card mt-12 scroll-mt-24 p-6 sm:p-8">
        <p className="eyebrow">Optional · per lock</p>
        <h2 className="t-h2 mt-3 text-[clamp(1.4rem,2.6vw,1.85rem)]">Auto-compound</h2>
        <p className="num mt-3 text-[15px] font-semibold text-mint">Hold → Earn → Buy → Lock → Repeat</p>
        <div className="mt-5 grid gap-6 text-[14.5px] leading-relaxed text-fg-soft md:grid-cols-2">
          <div className="space-y-3">
            <p>
              Switch it on for a lock and that lock&apos;s rewards in the pair asset buy more of the same coin, and the
              coins go straight into the lock. Same unlock date, same multiplier rules as adding to a lock, so your weight
              and share of the stream grow with every round.
            </p>
            <p>
              It is never forced: off until you turn it on, and off again with one click on your account page.
              &ldquo;Compound now&rdquo; does a single round on the spot and shows roughly how many coins it buys first.
            </p>
          </div>
          <ul className="space-y-2 [&>li]:flex [&>li]:gap-2 [&>li]:before:text-mint [&>li]:before:content-['·']">
            <li>A keeper runs it about every 30 minutes once a lock has around $0.50 waiting, and pays the network fees.</li>
            <li>The buy happens on-chain: on the LaunchLab curve, or on the Raydium pool after migration.</li>
            <li>The program refuses any buy more than 3% below the price before it.</li>
            <li>No app fee on a compound. The coin&apos;s normal on-chain trading fee applies and flows back to its lockers.</li>
            <li>Not for matured locks, locks that gave up their earnings, or locks locked forever.</li>
            <li>Rewards you could have taken in the pair asset become locked coin, which can fall and stays locked until the lock ends.</li>
          </ul>
        </div>
        <Link href="/how-it-works#auto-compound" className="mt-6 inline-block text-[13px] font-semibold text-steel-hi hover:text-fg">
          More in How it works →
        </Link>
      </section>
    </div>
  );
}
