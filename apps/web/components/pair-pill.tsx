import type { QuoteInfo } from "@/lib/api";

/**
 * StonkFun's "Paired with ● NVDAx": what the coin is priced in, and so what
 * its lockers are paid in. The pair's logo stands in for the dot when the
 * API has one.
 */
export function PairPill({
  quote,
  label = "Paired with",
  className = "",
}: {
  quote: Pick<QuoteInfo, "symbol" | "logoUrl" | "name">;
  /** Leading words; empty string for just the asset. */
  label?: string;
  className?: string;
}) {
  return (
    <span className={`pill pill-pair ${className}`} title={quote.name}>
      {label ? <span className="pill-label">{label}</span> : null}
      <QuoteLogo quote={quote} size={14} />
      <b>{quote.symbol}</b>
    </span>
  );
}

/** A pair asset's logo, or the mint-green dot when it has none. */
export function QuoteLogo({ quote, size }: { quote: Pick<QuoteInfo, "symbol" | "logoUrl">; size: number }) {
  if (!quote.logoUrl) return <i className="pill-dot" aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- logos come from arbitrary token-list hosts
    <img
      src={quote.logoUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full bg-ink-4 object-cover"
      style={{ width: size, height: size }}
      loading="lazy"
    />
  );
}
