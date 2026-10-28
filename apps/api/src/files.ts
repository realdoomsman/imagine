import { env } from "./env.ts";

/**
 * Where this API serves a coin's self-hosted metadata. The URI written into
 * the mint is fixed by the program instead (`metadataUri` from the SDK,
 * https://api.imagine.fun/files/meta/<mint>.json); in production
 * `API_PUBLIC_ORIGIN` is that origin, so the two coincide, while a local fork
 * serves the same document from its own origin.
 */
export const metadataDocumentUrl = (mint: string) => `${env.apiPublicOrigin}/files/meta/${mint}.json`;
export const imageUrl = (mint: string) => `${env.apiPublicOrigin}/files/img/${mint}`;

/** The website written into every coin launched here: its own IMAGINE page. */
export const coinPageUrl = (mint: string) => `https://imagine.fun/coins/${mint}`;
