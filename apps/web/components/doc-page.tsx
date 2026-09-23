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
    <article className="mx-auto max-w-[760px] px-5 py-20 sm:px-8 lg:py-28">
      <p className="rule-label">{eyebrow}</p>
      <h1 className="t-section mt-5">{title}</h1>
      <p className="t-lede mt-7 max-w-none">{lede}</p>
      <div
        className="mt-14 h-px"
        style={{
          background:
            "linear-gradient(90deg, var(--color-torch), var(--color-steel-780) 32%, transparent)",
        }}
      />
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
    <section className="mt-14">
      <h2 className="text-[clamp(1.4rem,2.6vw,1.9rem)] leading-[1.1] tracking-[-0.03em]">
        {title}
      </h2>
      <div className="mt-5 space-y-4 text-[15.5px] leading-[1.7] text-steel-400 [&_code]:rounded-machined [&_code]:border [&_code]:border-steel-700 [&_code]:bg-steel-950 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-steel-200 [&_em]:not-italic [&_em]:text-steel-100 [&_li]:ml-5 [&_li]:list-disc [&_li]:marker:text-steel-600 [&_ol_li]:list-decimal [&_ol]:space-y-2 [&_pre]:overflow-x-auto [&_pre]:rounded-machined [&_pre]:border [&_pre]:border-steel-700 [&_pre]:bg-steel-950 [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:text-steel-300 [&_strong]:font-semibold [&_strong]:text-steel-100 [&_ul]:space-y-2">
        {children}
      </div>
    </section>
  );
}
