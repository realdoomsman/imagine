/**
 * Shared shell for the written pages.
 *
 * The prose styling lives here rather than in a global stylesheet so the
 * editorial pages can have a measure and rhythm of their own without leaking
 * into the app surfaces, which are dense and tabular.
 */
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
    <article className="mx-auto max-w-[820px] px-5 py-12">
      <p className="rule-label">{eyebrow}</p>
      <h1 className="mt-3 text-[clamp(2.25rem,5vw,3.25rem)] leading-[1.02]">
        {title}
      </h1>
      <p className="mt-5 text-[17px] leading-relaxed text-steel-300">{lede}</p>
      {children}
    </article>
  );
}

export function DocSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <h2 className="text-[24px]">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-steel-400 [&_code]:rounded-machined [&_code]:border [&_code]:border-steel-700 [&_code]:bg-steel-950 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-steel-200 [&_em]:not-italic [&_em]:text-steel-100 [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_ol]:space-y-2 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-steel-700 [&_pre]:bg-steel-950 [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:text-steel-300 [&_strong]:text-steel-100 [&_ul]:space-y-2">
        {children}
      </div>
    </section>
  );
}
