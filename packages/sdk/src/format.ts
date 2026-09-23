const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Formatting shared by the web app, the API, and the video renderer so a number
 * never reads differently in two places.
 */

export function formatSol(lamports: bigint | number, maxFractionDigits = 4): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL;
  if (sol === 0) return "0";
  if (Math.abs(sol) < 0.0001) return "<0.0001";
  return sol.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  const whole = Number(amount) / 10 ** decimals;
  if (whole >= 1_000_000_000) return `${(whole / 1_000_000_000).toFixed(2)}B`;
  if (whole >= 1_000_000) return `${(whole / 1_000_000).toFixed(2)}M`;
  if (whole >= 1_000) return `${(whole / 1_000).toFixed(2)}K`;
  return whole.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatMultiplier(bps: number): string {
  return `${(bps / 10_000).toFixed(2)}×`;
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Compact "2d 4h" style remaining-time label for lock countdowns. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "unlocked";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export function shortAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/**
 * A base-unit amount as an exact decimal string, no rounding or grouping —
 * what goes back into an input when the user presses "max". `formatTokenAmount`
 * rounds for display and would overstate the balance by a few base units.
 */
export function exactAmount(amount: bigint, decimals: number): string {
  const whole = amount / 10n ** BigInt(decimals);
  const fraction = (amount % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}
