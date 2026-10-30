/**
 * The platform does not promote a coin of its own: no contract address, no
 * ticker, no buy link. Coins trading under the platform's name ($IMAGINE)
 * are kept off every list on the site. Matched by symbol so client
 * components can filter without shipping any mint address.
 */
export const isPlatformTicker = (symbol: string | null | undefined): boolean =>
  symbol?.trim().toUpperCase() === "IMAGINE";
