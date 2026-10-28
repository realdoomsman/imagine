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
import { proofRoutes } from "./routes/proof.ts";
import { clientIp, registerRpcProxy } from "./rpc-proxy.ts";
import { txRoutes } from "./routes/tx.ts";
import { platformConfig } from "./raydium.ts";
import { chainConfig, connection } from "./solana.ts";
import { assessHealth, readStatus, type Health } from "./status.ts";
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

// Polled by the platform and by anyone else who likes. Everything it reports
// is held for 10s, so polling never becomes an RPC call or a query each.
const HEALTH_TTL_MS = 10_000;

interface HealthReport extends Health {
  /** This process can serve: the database answers. */
  ok: boolean;
  db: boolean;
  slot: number | null;
  cluster: string;
}

let healthCache: { at: number; report: Promise<HealthReport> } | null = null;

async function buildHealth(): Promise<HealthReport> {
  const [slot, rows] = await Promise.all([
    connection.getSlot("confirmed").catch(() => null),
    readStatus().catch(() => null),
  ]);
  const db = rows !== null;
  const health = assessHealth(rows ?? []);
  const warnings = [...(db ? [] : ["database unreachable"]), ...(slot === null ? ["RPC unreachable"] : []), ...health.warnings];
  return {
    ok: db,
    status: warnings.length === 0 ? "ok" : "degraded",
    db,
    slot,
    cluster: env.cluster,
    warnings,
    indexer: health.indexer,
    keeper: health.keeper,
  };
}

function health() {
  if (!healthCache || Date.now() - healthCache.at >= HEALTH_TTL_MS) {
    healthCache = { at: Date.now(), report: buildHealth() };
  }
  return healthCache.report;
}

/**
 * Liveness of this process plus a report on the background role: indexer lag,
 * keeper balance and last run. 503 only when this process cannot serve (no
 * database); a stale indexer or a low keeper shows as `status: "degraded"`
 * with warnings, so a deploy health check never couples the API to the indexer.
 */
app.get("/health", { config: { rateLimit: false } }, async (_request, reply) => {
  const report = await health();
  return reply.code(report.db ? 200 : 503).send(report);
});

/** For uptime monitors: 503 whenever anything above is degraded. */
app.get("/ready", { config: { rateLimit: false } }, async (_request, reply) => {
  const report = await health();
  return reply.code(report.status === "ok" ? 200 : 503).send(report);
});

app.get("/config", async () => {
  const config = await chainConfig();
  // The pool's on-chain trading fee on every curve trade anywhere: the
  // platform's LaunchLab creator_fee_rate (millionths), whose "creator" is the
  // pool vault.
  const platform = await platformConfig(config.launchlabPlatform);
  return {
    cluster: env.cluster,
    treasury: config.treasury.toBase58(),
    tradeFeeBps: config.tradeFeeBps,
    poolFeeBps: Number(platform.creatorFeeRate / 100n),
    platform: config.launchlabPlatform.toBase58(),
    launchAlt: env.launchAlt?.toBase58() ?? null,
    googleClientId: env.googleClientId,
  };
});

await app.register(poolRoutes, { prefix: "/api" });
await app.register(metadataRoutes, { prefix: "/api" });
await app.register(fileRoutes);
await app.register(portfolioRoutes, { prefix: "/api" });
await app.register(proofRoutes, { prefix: "/api" });
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

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "shutting down");
  // In-flight requests get this long to finish; then the process goes regardless.
  setTimeout(() => {
    app.log.error("shutdown timed out");
    process.exit(1);
  }, 15_000).unref();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: env.port, host: env.host });
