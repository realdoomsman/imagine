import Link from "next/link";

/** Shared shell for the written pages: docs, mechanics, legal, the article. */
export function DocPage({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-[800px] px-5 pb-24 pt-14 sm:px-8 lg:pb-32 lg:pt-20">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="t-h1 mt-4">{title}</h1>
      <p className="t-lede mt-6 max-w-none">{lede}</p>
      <div className="mt-12 h-px" style={{ background: "linear-gradient(90deg, #5EE9B5, var(--line) 30%, transparent)" }} />
      {children}
    </article>
  );
}

export function DocSection({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-24">
      <h2 className="t-h2 text-[clamp(1.4rem,2.6vw,1.85rem)]">{title}</h2>
      <div className="prose-imagine mt-5 text-[15.5px] [&_pre]:overflow-x-auto [&_pre]:rounded-[10px] [&_pre]:border [&_pre]:border-line [&_pre]:bg-ink-1 [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_pre]:text-fg">
        {children}
      </div>
    </section>
  );
}

/** Closing links at the foot of a written page. */
export function DocLinks({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <div className="hairline mt-14 flex flex-wrap gap-3 pt-8">
      {links.map((link, index) => (
        <Link key={link.href} href={link.href} className={`btn ${index === 0 ? "btn-primary" : "btn-ghost"}`}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}
