/**
 * A share to X with the text and link prefilled. The link's card carries the
 * coin's image and numbers, so the post says what the page says.
 */
export function ShareButton({
  text,
  url,
  label = "Share on X",
  className = "",
}: {
  text: string;
  url: string;
  label?: string;
  className?: string;
}) {
  const href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`btn btn-ghost btn-sm ${className}`}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      {label}
    </a>
  );
}

/** A coin's public page and the line everyone shares it with. */
export function coinShare(mint: string, name: string, pair: string): { url: string; text: string } {
  return {
    url: `https://imagine.fun/coins/${mint}`,
    text: `${name} launched on Raydium — lock it, earn ${pair}`,
  };
}
