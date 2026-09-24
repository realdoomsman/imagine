import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pubkey } from "../actions.ts";
import { sql } from "../db.ts";
import { env } from "../env.ts";

/**
 * Pin a coin's image and metadata document.
 *
 * The browser sends the image straight from disk with the name, ticker,
 * description and socials; we hand it to pump.fun's own pinning endpoint,
 * which writes the Metaplex-shaped JSON pump reads and returns its IPFS URI.
 * The same host pump's frontend uses, so a coin launched here looks exactly
 * like one launched there.
 *
 * The coin's website is always its VISE page, so it has to be pinned for a
 * mint chosen up front. The URI is recorded against that mint, and a launch
 * only accepts a URI pinned here for its own mint: every VISE coin links
 * back to where it is locked.
 */
const PUMP_IPFS = "https://pump.fun/api/ipfs";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const FieldsSchema = z.object({
  mint: pubkey,
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(10),
  description: z.string().trim().max(1000).default(""),
  twitter: z.string().trim().url().max(200).or(z.literal("")).default(""),
  telegram: z.string().trim().url().max(200).or(z.literal("")).default(""),
});

/** The website written into every coin launched on VISE: its own coin page. */
export function coinPageUrl(mint: string): string {
  return `${env.siteOrigin}/coins/${mint}`;
}

interface PumpPinResponse {
  metadataUri: string;
  metadata: { image: string };
}

export async function metadataRoutes(app: FastifyInstance) {
  // Pinning proxies a 4 MB upload to a third party: a handful a minute is a
  // launch, hundreds is someone using us as free storage.
  app.post("/metadata", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (request, reply) => {
    const fields: Record<string, string> = {};
    let image: { buffer: Buffer; type: string; filename: string } | null = null;

    for await (const part of request.parts({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 8 } })) {
      if (part.type === "file") {
        if (!IMAGE_TYPES.includes(part.mimetype)) {
          return reply.code(400).send({ error: "image must be PNG, JPEG, GIF or WebP" });
        }
        const buffer = await part.toBuffer();
        if (part.file.truncated) {
          return reply.code(400).send({ error: "image must be 4 MB or smaller" });
        }
        image = { buffer, type: part.mimetype, filename: part.filename };
      } else if (typeof part.value === "string") {
        fields[part.fieldname] = part.value;
      }
    }
    if (!image) return reply.code(400).send({ error: "an image is required" });
    const body = FieldsSchema.parse(fields);

    const form = new FormData();
    form.append("file", new Blob([image.buffer], { type: image.type }), image.filename || "image");
    form.append("name", body.name);
    form.append("symbol", body.symbol);
    form.append("description", body.description);
    if (body.twitter) form.append("twitter", body.twitter);
    if (body.telegram) form.append("telegram", body.telegram);
    form.append("website", coinPageUrl(body.mint));
    form.append("showName", "true");

    const response = await fetch(PUMP_IPFS, { method: "POST", body: form });
    if (!response.ok) {
      request.log.error({ status: response.status, body: (await response.text()).slice(0, 300) }, "pin failed");
      return reply.code(502).send({ error: "could not pin the metadata right now; try again in a moment" });
    }
    const pinned = (await response.json()) as PumpPinResponse;
    if (!pinned.metadataUri) return reply.code(502).send({ error: "pinning service returned no URI" });
    await sql`
      INSERT INTO pinned_metadata (uri, mint) VALUES (${pinned.metadataUri}, ${body.mint})
      ON CONFLICT (uri) DO UPDATE SET mint = EXCLUDED.mint
    `;
    return { uri: pinned.metadataUri, image: pinned.metadata.image };
  });
}
