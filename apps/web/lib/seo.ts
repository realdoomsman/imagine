import type { Metadata } from "next";
import { X_HANDLE, X_URL } from "@/components/site-header-links";

export const SITE_URL = "https://imagine.fun";
export const SITE_NAME = "IMAGINE";
export const TAGLINE = "Lock the meme. Earn its pair.";
export const SITE_TITLE = "IMAGINE — Imagine everyone locks";
export const SITE_DESCRIPTION =
  "Launch a coin on Raydium, paired with anything. Every trade pays the holders who lock it — in whatever it's paired with. Lock longer, earn a bigger cut.";
/** The shorter line share cards carry under the title. */
export const SITE_CARD_DESCRIPTION = `${TAGLINE} Lock-to-earn vaults for coins launched on Raydium LaunchLab.`;

/**
 * Metadata for one page: its title and description, a canonical URL, and the
 * Open Graph / X card for that page. Next merges `openGraph` and `twitter`
 * shallowly, so a page that set only a title would otherwise share the home
 * page's card text and `og:url`. The card image comes from the nearest
 * `opengraph-image` file either way.
 */
export function pageMetadata({
  title,
  description,
  cardDescription = description,
  path,
  type = "website",
}: {
  /** Short page title; the layout's template appends "· IMAGINE" (the home page's is used as is). */
  title: string;
  description: string;
  /** What the share card says, when it should differ from the meta description. */
  cardDescription?: string;
  /** Site-relative path starting with "/". */
  path: string;
  type?: "website" | "article";
}): Metadata {
  const home = path === "/";
  const url = home ? SITE_URL : `${SITE_URL}${path}`;
  const cardTitle = home ? title : `${title} · ${SITE_NAME}`;
  return {
    title: home ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    openGraph: { title: cardTitle, description: cardDescription, url, siteName: SITE_NAME, type },
    twitter: {
      card: "summary_large_image",
      title: cardTitle,
      description: cardDescription,
      ...(X_HANDLE ? { site: X_HANDLE, creator: X_HANDLE } : {}),
    },
  };
}

/** schema.org Organization + WebSite for the root layout, as one JSON-LD graph. */
export function siteJsonLd(description: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}/brand/imagine-512.png`,
          width: 512,
          height: 512,
        },
        slogan: TAGLINE,
        ...(X_URL ? { sameAs: [X_URL] } : {}),
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        description,
        inLanguage: "en",
        publisher: { "@id": `${SITE_URL}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/coins?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}
