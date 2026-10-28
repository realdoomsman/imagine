import { createPublicKey, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { IMAGINE_PROGRAM_ID, metadataUri, poolPda } from "@imagine/sdk";
import { pubkey } from "../actions.ts";
import { loadKeypair, readSession } from "../auth.ts";
import { sql } from "../db.ts";
import { coinPageUrl, imageUrl, metadataDocumentUrl } from "../files.ts";
import { connection } from "../solana.ts";
import { launchMintKeypair } from "./account.ts";

/**
 * Coin metadata, hosted here.
 *
 * The browser sends the image straight from disk with the name, ticker,
 * description and socials. We store the image and a Metaplex-shaped JSON
 * document in Postgres and serve both from `API_PUBLIC_ORIGIN`. The URI
 * `imagine.launch` writes into the Token-2022 mint (what Raydium, Jupiter,
 * explorers and wallets read) is fixed by the program to
 * https://api.imagine.fun/files/meta/<mint>.json, which is this document in
 * production.
 *
 * The coin's website is always its IMAGINE page, so the document is keyed by
 * a mint chosen up front, and the program only accepts that mint's own
 * document URI. Once that mint exists on chain the document is frozen:
 * nobody can swap a live coin's image.
 *
 * Before then, the first upload for a mint is accepted from anyone (a mint
 * address is unknown to others until its launch), but replacing a stored
 * document needs proof of being the one who will launch it: a signature by
 * the mint key over `metadataProofMessage(mint)` (a wallet launch holds that
 * key in the page), or the `mintNonce` the signed-in account's
 * `/me/launch/mint` returned. Re-sending identical content is always fine.
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
  /** Base58 ed25519 signature by the mint key over `metadataProofMessage(mint)`. */
  mintSignature: z.string().max(100).optional(),
  /** The nonce `/me/launch/mint` returned for this mint (signed-in accounts). */
  mintNonce: z.string().regex(/^[0-9a-f]{32}$/).optional(),
});

/** What the mint key signs to prove it may replace the mint's stored metadata. */
export const metadataProofMessage = (mint: string) => `imagine-metadata:${mint}`;

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyMintSignature(mint: string, signature: string): boolean {
  let sig: Uint8Array;
  try {
    sig = bs58.decode(signature);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, new PublicKey(mint).toBuffer()]),
    format: "der",
    type: "spki",
  });
  return verify(null, Buffer.from(metadataProofMessage(mint)), key, sig);
}

/** Whether this request proves it is the one launching `mint`. */
async function provesMint(request: FastifyRequest, body: z.infer<typeof FieldsSchema>): Promise<boolean> {
  if (body.mintSignature && verifyMintSignature(body.mint, body.mintSignature)) return true;
  if (!body.mintNonce) return false;
  const session = await readSession(request);
  if (!session) return false;
  const wallet = await loadKeypair(session.account);
  return launchMintKeypair(wallet, body.mintNonce).publicKey.toBase58() === body.mint;
}

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
    const json = JSON.stringify(document);
    const stored = (await provesMint(request, body))
      ? await sql`
          INSERT INTO coin_files (mint, name, symbol, image, image_type, metadata)
          VALUES (${body.mint}, ${body.name}, ${body.symbol}, ${image.buffer}, ${image.type}, ${json}::text::jsonb)
          ON CONFLICT (mint) DO UPDATE SET
            name = EXCLUDED.name, symbol = EXCLUDED.symbol, image = EXCLUDED.image,
            image_type = EXCLUDED.image_type, metadata = EXCLUDED.metadata, created_at = NOW()
          RETURNING mint
        `
      : await sql`
          INSERT INTO coin_files (mint, name, symbol, image, image_type, metadata)
          VALUES (${body.mint}, ${body.name}, ${body.symbol}, ${image.buffer}, ${image.type}, ${json}::text::jsonb)
          ON CONFLICT (mint) DO NOTHING
          RETURNING mint
        `;
    if (stored.length === 0) {
      const [same] = await sql`
        SELECT 1 FROM coin_files
        WHERE mint = ${body.mint} AND name = ${body.name} AND symbol = ${body.symbol}
          AND image = ${image.buffer} AND image_type = ${image.type} AND metadata = ${json}::text::jsonb
      `;
      if (!same) {
        return reply.code(409).send({ error: "metadata for this mint is already stored; only its launcher can replace it" });
      }
    }
    // `uri` goes into the mint (fixed by the program); `document` is where this
    // API serves it, the same URL in production.
    return { uri: metadataUri(body.mint), document: metadataDocumentUrl(body.mint), image: imageUrl(body.mint) };
  });
}

/**
 * Whether a stored document may be served: its mint is not created yet (a
 * launch in progress), or it has an IMAGINE pool. A mint that exists without
 * one was launched on LaunchLab directly with a document uploaded here — it
 * must not borrow IMAGINE's hosting, its name or a link to a page that does
 * not exist. Verdicts are cached (bounded); a pool never goes away, so only
 * the "not created yet" answer is short-lived.
 */
const VERDICT_TTL_MS = { launched: 60 * 60_000, pending: 30_000 } as const;
const MAX_VERDICTS = 5_000;
const verdicts = new Map<string, { ok: boolean; until: number }>();

async function servable(mint: string): Promise<boolean> {
  const [listed] = await sql`SELECT 1 FROM pools WHERE mint = ${mint}`;
  if (listed) return true;
  const cached = verdicts.get(mint);
  if (cached && cached.until > Date.now()) return cached.ok;
  const key = new PublicKey(mint);
  const [mintInfo, poolInfo] = await connection.getMultipleAccountsInfo([key, poolPda(key)]);
  const ok = !mintInfo || poolInfo?.owner.equals(IMAGINE_PROGRAM_ID) === true;
  verdicts.delete(mint);
  verdicts.set(mint, { ok, until: Date.now() + (mintInfo ? VERDICT_TTL_MS.launched : VERDICT_TTL_MS.pending) });
  if (verdicts.size > MAX_VERDICTS) verdicts.delete(verdicts.keys().next().value as string);
  return ok;
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
    if (!match || !pubkey.safeParse(match[1]).success) return reply.code(404).send({ error: "not found" });
    const [row] = await sql`SELECT metadata FROM coin_files WHERE mint = ${match[1]!}`;
    if (!row || !(await servable(match[1]!))) return reply.code(404).send({ error: "not found" });
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
    if (!row || !(await servable(parsed.data.mint))) return reply.code(404).send({ error: "not found" });
    return reply
      .header("cache-control", "public, max-age=300")
      .header("access-control-allow-origin", "*")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
      .type(row.image_type as string)
      .send(row.image as Buffer);
  });
}
