import { QUOTE_CATEGORIES } from "@imagine/sdk";
import type { QuoteInfo } from "./api.ts";

/** The display name for a pair category id; ids the SDK doesn't know are title-cased. */
export function categoryLabel(category: string): string {
  const known = QUOTE_CATEGORIES.find((entry) => entry.id === category.toLowerCase());
  if (known) return known.label;
  return category
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Pair assets grouped by category, in StonkFun's picker order, unknown categories last. */
export function groupQuotes(quotes: QuoteInfo[]): Array<{ category: string; label: string; quotes: QuoteInfo[] }> {
  const groups = new Map<string, { category: string; label: string; quotes: QuoteInfo[] }>();
  for (const quote of quotes) {
    const id = quote.category.toLowerCase();
    const group = groups.get(id) ?? { category: id, label: categoryLabel(id), quotes: [] };
    group.quotes.push(quote);
    groups.set(id, group);
  }
  const rank = (id: string) => {
    const index = QUOTE_CATEGORIES.findIndex((entry) => entry.id === id);
    return index === -1 ? QUOTE_CATEGORIES.length : index;
  };
  return [...groups.values()].sort((a, b) => rank(a.category) - rank(b.category) || a.label.localeCompare(b.label));
}
