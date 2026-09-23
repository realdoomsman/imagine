import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { sql } from "./db.ts";
import { env } from "./env.ts";
import { poolRoutes } from "./routes/pools.ts";
import { portfolioRoutes } from "./routes/portfolio.ts";
import { txRoutes } from "./routes/tx.ts";
import { connection } from "./solana.ts";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  trustProxy: true,
  bodyLimit: 32 * 1024,
});

await app.register(cors, {
  origin: env.corsOrigins.includes("*") ? true : env.corsOrigins,
  methods: ["GET", "POST"],
});

// Transaction building hits RPC, so it is the expensive surface. The limit is
// generous enough for a human trading quickly and tight enough that a scraper
// cannot turn our RPC budget into their free node.
await app.register(rateLimit, {
  max: 240,
  timeWindow: "1 minute",
  allowList: (request) => request.url === "/health",
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

app.get("/health", async () => {
  const [{ ok }] = await sql`SELECT 1 AS ok`;
  const slot = await connection.getSlot("confirmed");
  return { ok: ok === 1, slot, cluster: env.cluster };
});

app.get("/config", async () => ({
  cluster: env.cluster,
  rpcUrl: env.rpcUrl,
  treasury: env.treasury.toBase58(),
  tradeFeeBps: env.tradeFeeBps,
}));

await app.register(poolRoutes, { prefix: "/api" });
await app.register(portfolioRoutes, { prefix: "/api" });
await app.register(txRoutes, { prefix: "/api" });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: env.port, host: env.host });
