import { useId } from "react";

/**
 * The IMAGINE mark: a rounded tile in the dream gradient holding a lowercase
 * "i" — the stem is a held position, the dot above it is the idea.
 * Geometry is shared with `app/icon.svg` and the film; change all three
 * together.
 */
export function ImagineMark({
  size = 28,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  /** Accessible name; omit when the mark sits beside the wordmark. */
  title?: string;
}) {
  const id = useId();
  const gradient = `imagine-dream-${id.replace(/:/g, "")}`;
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        {/* 120deg CSS gradient, expressed in the tile's own box. */}
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0.58" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#8CC8DC" />
          <stop offset="0.55" stopColor="#5EE9B5" />
          <stop offset="1" stopColor="#C7F9E5" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradient})`} />
      <rect x="13" y="13" width="6" height="12" rx="3" fill="#071013" />
      <circle cx="16" cy="8.5" r="3.2" fill="#071013" />
    </svg>
  );
}

/** Mark + wordmark, as used in the header and footer. */
export function ImagineLogo({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <ImagineMark size={size} />
      <span className="text-[17px] font-extrabold tracking-[-0.02em] text-fg">IMAGINE</span>
    </span>
  );
}
