/** Primary destinations, shared by the header, the phone tab bar and the footer. */
export const NAV = [
  { href: "/coins", label: "Coins" },
  { href: "/launch", label: "Launch" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/docs", label: "Docs" },
] as const;

/**
 * Social links come from the build environment only and disappear when unset:
 * no handle is hard-coded anywhere in the site.
 */
const clean = (value: string | undefined) => (value && /^https:\/\//.test(value) ? value : null);

export const X_URL = clean(process.env.NEXT_PUBLIC_X_URL);

/** `@handle` derived from the X URL, for Twitter card metadata. */
export const X_HANDLE = (() => {
  if (!X_URL) return null;
  const match = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/.exec(X_URL);
  return match ? `@${match[1]}` : null;
})();
