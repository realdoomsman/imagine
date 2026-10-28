import Link from "next/link";

export const metadata = {
  title: "Docs",
  description: "How IMAGINE works, every fee on an IMAGINE coin, and the security model of the program.",
};

const DOCS = [
  { href: "/how-it-works", title: "How it works", body: "StonkFun coins with a lock vault: where fees come from and how weight is computed." },
  { href: "/docs/fees", title: "Fees", body: "The 1% app fee, StonkFun's fees and forwarded creator share, the 90/10 split, early exits." },
  { href: "/docs/security", title: "Security", body: "What the program cannot do, what it checks on-chain, and what can still go wrong." },
  { href: "/article", title: "The idea", body: "Why paying holders in the stock a coin is paired with changes what holding means." },
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
    </div>
  );
}
