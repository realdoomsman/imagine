import { PublicKey } from "@solana/web3.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pubkey } from "../actions.ts";
import { sql } from "../db.ts";
import { coinPageUrl, imageUrl, metadataUri } from "../files.ts";
import { connection } from "../solana.ts";

/**
 * Coin metadata, hosted here.
 *
 * The browser sends the image straight from disk with the name, ticker,
 * description and socials. We store the image and a Metaplex-shaped JSON
 * document in Postgres and serve both from `API_PUBLIC_ORIGIN`; the JSON's
 * URI is what `imagine.launch` writes into the Token-2022 mint, which is what
 * StonkFun, Raydium, Jupiter and wallets read.
 *
 * The coin's website is always its IMAGINE page, so the document is keyed by
 * a mint chosen up front, and a launch only accepts this document's URI for
 * its own mint. Once that mint exists on chain the document is frozen:
 * nobody can swap a live coin's image.
 */
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

/** A social link worth publishing: an absolute http(s) URL, or nothing. */
function webLink(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export async function metadataRoutes(app: FastifyInstance) {
  // A handful a minute is a launch; hundreds is someone using us as free storage.
  app.post("/metadata", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (request, reply) => {
    const fields: Record<string, string> = {};
    let image: { buffer: Buffer; type: string } | null = null;

    for await (const part of request.parts({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 8 } })) {
      if (part.type === "file") {
        if (!IMAGE_TYPES.includes(part.mimetype)) {
          return reply.code(400).send({ error: "image must be PNG, JPEG, GIF or WebP" });
        }
        const buffer = await part.toBuffer();
        if (part.file.truncated) {
          return reply.code(400).send({ error: "image must be 4 MB or smaller" });
        }
        image = { buffer, type: part.mimetype };
      } else if (typeof part.value === "string") {
        fields[part.fieldname] = part.value;
      }
    }
    if (!image) return reply.code(400).send({ error: "an image is required" });
    const body = FieldsSchema.parse(fields);

    if (await connection.getAccountInfo(new PublicKey(body.mint))) {
      return reply.code(409).send({ error: "this mint already exists; its metadata can no longer change" });
    }

    const twitter = webLink(body.twitter);
    const telegram = webLink(body.telegram);
    const document = {
      name: body.name,
      symbol: body.symbol,
      description: body.description,
      image: imageUrl(body.mint),
      showName: true,
      createdOn: "https://imagine.fun",
      website: coinPageUrl(body.mint),
      ...(twitter ? { twitter } : {}),
      ...(telegram ? { telegram } : {}),
      properties: { files: [{ uri: imageUrl(body.mint), type: image.type }], category: "image" },
    };
    await sql`
      INSERT INTO coin_files (mint, name, symbol, image, image_type, metadata)
      VALUES (${body.mint}, ${body.name}, ${body.symbol}, ${image.buffer}, ${image.type},
              ${JSON.stringify(document)}::text::jsonb)
      ON CONFLICT (mint) DO UPDATE SET
        name = EXCLUDED.name, symbol = EXCLUDED.symbol, image = EXCLUDED.image,
        image_type = EXCLUDED.image_type, metadata = EXCLUDED.metadata, created_at = NOW()
    `;
    return { uri: metadataUri(body.mint), image: imageUrl(body.mint) };
  });
}

/**
 * The public file routes, at the root (not under /api): `/files/meta/<mint>.json`
 * and `/files/img/<mint>`. Immutable once the mint exists, so cached hard.
 */
export async function fileRoutes(app: FastifyInstance) {
  const mintParam = z.object({ mint: pubkey });

  app.get("/files/meta/:file", { config: { rateLimit: false } }, async (request, reply) => {
    const { file } = z.object({ file: z.string().max(64) }).parse(request.params);
    const match = /^([1-9A-HJ-NP-Za-km-z]{32,44})\.json$/.exec(file);
    if (!match) return reply.code(404).send({ error: "not found" });
    const [row] = await sql`SELECT metadata FROM coin_files WHERE mint = ${match[1]!}`;
    if (!row) return reply.code(404).send({ error: "not found" });
    return reply
      .header("cache-control", "public, max-age=300")
      .header("access-control-allow-origin", "*")
      .type("application/json")
      .send(row.metadata);
  });

  app.get("/files/img/:mint", { config: { rateLimit: false } }, async (request, reply) => {
    const parsed = mintParam.safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ error: "not found" });
    const [row] = await sql`SELECT image, image_type FROM coin_files WHERE mint = ${parsed.data.mint}`;
    if (!row) return reply.code(404).send({ error: "not found" });
    return reply
      .header("cache-control", "public, max-age=300")
      .header("access-control-allow-origin", "*")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
      .type(row.image_type as string)
      .send(row.image as Buffer);
  });
}
