import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { sql } from "./db.ts";
import { assertApiEnv, env } from "./env.ts";
import { accountRoutes } from "./routes/account.ts";
import { fileRoutes, metadataRoutes } from "./routes/metadata.ts";
import { poolRoutes } from "./routes/pools.ts";
import { portfolioRoutes } from "./routes/portfolio.ts";
import { clientIp, registerRpcProxy } from "./rpc-proxy.ts";
import { txRoutes } from "./routes/tx.ts";
import { chainConfig, connection } from "./solana.ts";
import { timingSafeEqual } from "node:crypto";

const INTERNAL_KEY = process.env.IMAGINE_INTERNAL_KEY ? Buffer.from(process.env.IMAGINE_INTERNAL_KEY) : null;
function isInternal(header: string | string[] | undefined): boolean {
  if (!INTERNAL_KEY || typeof header !== "string") return false;
  const given = Buffer.from(header);
  return given.length === INTERNAL_KEY.length && timingSafeEqual(given, INTERNAL_KEY);
}

// Auth secrets load lazily so the indexer never needs them; this role does,
// so it checks them (and a mainnet CORS allowlist) before serving anything.
assertApiEnv();

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 32 * 1024,
});

await app.register(cors, {
  origin: env.corsOrigins.includes("*") ? true : env.corsOrigins,
  methods: ["GET", "POST"],
  // Session cookies ride on cross-origin requests from the site.
  credentials: true,
});
await app.register(cookie);
// Only /api/metadata reads multipart; the 4 MB ceiling is per file there.
await app.register(multipart);

// Transaction building hits RPC, so it is the expensive surface. The limit is
// generous enough for a human trading quickly and tight enough that a scraper
// cannot turn our RPC budget into their free node.
await app.register(rateLimit, {
  max: 240,
  timeWindow: "1 minute",
  keyGenerator: clientIp,
  // The web server's own renders: every visitor's page load reaches us from
  // its single address, so it proves itself with a shared key instead.
  allowList: (request) => isInternal(request.headers["x-imagine-internal"]),
});

app.setErrorHandler((error: unknown, request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: "invalid request",
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  request.log.error({ err: error }, "request failed");
  const status =
    error instanceof Error && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  const message = error instanceof Error ? error.message : "internal error";
  return reply.code(status).send({ error: status >= 500 ? "internal error" : message });
});

// Polled by the platform and by anyone else who likes; the slot is served
// from a value at most 10s old so polling never becomes an RPC call each.
const SLOT_TTL_MS = 10_000;
let slotCache: { at: number; slot: Promise<number> } | null = null;

app.get("/health", async () => {
  const [{ ok }] = await sql`SELECT 1 AS ok`;
  if (!slotCache || Date.now() - slotCache.at >= SLOT_TTL_MS) {
    slotCache = { at: Date.now(), slot: connection.getSlot("confirmed") };
  }
  return { ok: ok === 1, slot: await slotCache.slot, cluster: env.cluster };
});

app.get("/config", async () => {
  const config = await chainConfig();
  return {
    cluster: env.cluster,
    treasury: config.treasury.toBase58(),
    tradeFeeBps: config.tradeFeeBps,
    platform: config.launchlabPlatform.toBase58(),
    launchAlt: env.launchAlt?.toBase58() ?? null,
    googleClientId: env.googleClientId,
  };
});

await app.register(poolRoutes, { prefix: "/api" });
await app.register(metadataRoutes, { prefix: "/api" });
await app.register(fileRoutes);
await app.register(portfolioRoutes, { prefix: "/api" });
await app.register(txRoutes, { prefix: "/api" });
await app.register(accountRoutes, { prefix: "/api" });
// The site's RPC (NEXT_PUBLIC_RPC_URL / NEXT_PUBLIC_WS_URL): the keyed
// provider URL stays in this environment.
await registerRpcProxy(app, {
  rpcUrl: env.rpcUrl,
  wsUrl: env.rpcWsUpstream,
  perMin: env.rpcProxyPerMin,
  allowedOrigins: env.corsOrigins,
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: env.port, host: env.host });
