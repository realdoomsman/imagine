import type { MetadataRoute } from "next";
import { api } from "@/lib/api";
import { isPlatformTicker } from "@/lib/official";

export const revalidate = 600;

/** Every public page plus a URL per coin, read from the index. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://imagine.fun";
  const fixed: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/coins`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/launch`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/leaderboard`, changeFrequency: "hourly", priority: 0.7 },
    { url: `${base}/proof`, changeFrequency: "hourly", priority: 0.7 },
    { url: `${base}/article`, changeFrequency: "yearly", priority: 0.8 },
    { url: `${base}/how-it-works`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/docs`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/fees`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/docs/security`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
  let coins: MetadataRoute.Sitemap = [];
  try {
    const { pools } = await api.pools({ sort: "new", limit: 100 });
    coins = pools
      .filter((pool) => !isPlatformTicker(pool.symbol))
      .map((pool) => ({ url: `${base}/coins/${pool.mint}`, changeFrequency: "hourly" as const, priority: 0.6 }));
  } catch {
    // The index being down should not take the sitemap with it.
  }
  return [...fixed, ...coins];
}
