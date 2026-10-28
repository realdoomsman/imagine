import { env } from "./env.ts";

/**
 * Where a coin's self-hosted metadata lives. The JSON URI is written into the
 * mint at launch, so these are public, stable URLs on `API_PUBLIC_ORIGIN`.
 */
export const metadataUri = (mint: string) => `${env.apiPublicOrigin}/files/meta/${mint}.json`;
export const imageUrl = (mint: string) => `${env.apiPublicOrigin}/files/img/${mint}`;

/** The website written into every coin launched here: its own IMAGINE page. */
export const coinPageUrl = (mint: string) => `https://imagine.fun/coins/${mint}`;
