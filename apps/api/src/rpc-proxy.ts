import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import WebSocket from "ws";

/**
 * The browser's RPC, through this API, so the keyed provider URL (`RPC_URL`,
 * `RPC_WS_URL`) never ships in the site bundle.
 *
 *  - `POST /rpc` forwards single or batch JSON-RPC to `RPC_URL`;
 *  - `GET /rpc-ws` pipes PubSub to the provider's websocket.
 *
 * Both allow only the methods the site actually issues through web3.js and
 * the wallet adapter (anything else gets -32601) and count every call against
 * a per-IP budget. Account scans (getProgramAccounts, getTokenAccountsByOwner,
 * …) are never proxied: the site reads those through the API.
 */

/**
 * JSON-RPC the web app issues: balances (useTokenBalance), lookup tables and
 * mints (getAddressLookupTable / getMint → getAccountInfo), sending and
 * confirming (sendTransaction, simulateTransaction, confirmTransaction →
 * getSignatureStatuses + getBlockHeight), fees and blockhashes the wallet
 * adapter and web3.js ask for, and cheap cluster probes.
 */
const HTTP_METHODS: Record<string, true> = {
  getAccountInfo: true,
  getMultipleAccounts: true,
  getBalance: true,
  getTokenAccountBalance: true,
  getLatestBlockhash: true,
  isBlockhashValid: true,
  getBlockHeight: true,
  getSlot: true,
  getSignatureStatuses: true,
  getTransaction: true,
  getRecentPrioritizationFees: true,
  getFeeForMessage: true,
  getMinimumBalanceForRentExemption: true,
  simulateTransaction: true,
  sendTransaction: true,
  getGenesisHash: true,
  getHealth: true,
  getEpochInfo: true,
  getVersion: true,
};

/** PubSub: confirmTransaction, onAccountChange, slot probes, and web3.js's `ping` keepalive. */
const WS_METHODS: Record<string, true> = {
  accountSubscribe: true,
  accountUnsubscribe: true,
  signatureSubscribe: true,
  signatureUnsubscribe: true,
  slotSubscribe: true,
  slotUnsubscribe: true,
  ping: true,
};

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 20;
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_WS_PER_IP = 10;
const MAX_SUBS_PER_WS = 32;
/** Client frames buffered while the upstream socket is still connecting. */
const MAX_WS_BACKLOG = 32;
/** Clients only ever send small JSON frames; ws would otherwise buffer up to 100 MiB. */
const MAX_WS_PAYLOAD = 16 * 1024;

type RpcId = string | number | null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rpcError = (id: RpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

function callId(call: unknown): RpcId {
  const id = isRecord(call) ? call.id : null;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/**
 * The client's address. Railway's edge appends the address it accepted the
 * connection from as the right-most X-Forwarded-For entry; everything left of
 * it is whatever the client sent, so keying on it would let anyone reset
 * their own limit. Direct connections (the local rig) have no header.
 */
export function clientIp(request: FastifyRequest): string {
  const header = request.headers["x-forwarded-for"];
  const forwarded = Array.isArray(header) ? header.join(",") : header;
  return forwarded?.split(",").at(-1)?.trim() || request.socket.remoteAddress || "unknown";
}

/** Fixed one-minute windows per key; `hit` reports the seconds to wait when over budget. */
class Limiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly perMin: number;
  constructor(perMin: number) {
    this.perMin = perMin;
    setInterval(() => {
      const cutoff = Date.now() - 60_000;
      for (const [key, window] of this.windows) if (window.start < cutoff) this.windows.delete(key);
    }, 60_000).unref();
  }

  hit(key: string, cost = 1): number | null {
    const now = Date.now();
    let window = this.windows.get(key);
    if (!window || now - window.start >= 60_000) {
      window = { start: now, count: 0 };
      this.windows.set(key, window);
    }
    window.count += cost;
    return window.count > this.perMin ? Math.ceil((window.start + 60_000 - now) / 1000) : null;
  }
}

export async function registerRpcProxy(
  app: FastifyInstance,
  opts: { rpcUrl: string; wsUrl: string; perMin: number; allowedOrigins: string[] },
): Promise<void> {
  const limiter = opts.perMin > 0 ? new Limiter(opts.perMin) : null;
  const tooMany = (reply: FastifyReply, wait: number) =>
    reply
      .code(429)
      .header("retry-after", String(wait))
      .send({ error: `rate limit exceeded (${opts.perMin} RPC calls/min); retry in ${wait}s` });

  await app.register(websocket, { options: { maxPayload: MAX_WS_PAYLOAD } });

  // The global per-request limit is off here: every call in a batch counts
  // against the proxy's own budget instead.
  app.post("/rpc", { bodyLimit: MAX_BODY_BYTES, config: { rateLimit: false } }, async (request, reply) => {
    const batch = Array.isArray(request.body);
    const calls: unknown[] = batch ? (request.body as unknown[]) : [request.body];
    if (calls.length === 0 || calls.length > MAX_BATCH) {
      return reply.send(rpcError(null, -32600, `batch must hold 1-${MAX_BATCH} calls`));
    }
    const wait = limiter?.hit(clientIp(request), calls.length);
    if (wait) return tooMany(reply, wait);

    const allowed: unknown[] = [];
    const rejected: object[] = [];
    for (const call of calls) {
      if (!isRecord(call) || typeof call.method !== "string") rejected.push(rpcError(callId(call), -32600, "invalid request"));
      else if (!Object.hasOwn(HTTP_METHODS, call.method)) {
        rejected.push(rpcError(callId(call), -32601, `method ${call.method.slice(0, 64)} is not available through this proxy`));
      } else allowed.push(call);
    }
    if (allowed.length === 0) return reply.send(batch ? rejected : rejected[0]);

    let upstream: Response;
    try {
      upstream = await fetch(opts.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch ? allowed : allowed[0]),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (error) {
      request.log.warn({ err: String(error) }, "rpc proxy upstream failed");
      return reply.code(502).send(rpcError(null, -32603, "upstream RPC unavailable"));
    }
    const text = await upstream.text();
    if (rejected.length > 0 && upstream.ok) {
      try {
        const results: unknown = JSON.parse(text);
        if (Array.isArray(results)) return reply.send([...results, ...rejected]);
      } catch {
        // Not JSON: relayed as-is below.
      }
    }
    return reply.code(upstream.status).type("application/json").send(text);
  });

  const socketsPerIp = new Map<string, number>();
  app.get("/rpc-ws", { websocket: true, config: { rateLimit: false } }, (socket, request) => {
    // Browsers send Origin on websocket upgrades and CORS does not apply to
    // them, so other sites are refused here.
    const origin = request.headers.origin;
    if (origin && !opts.allowedOrigins.includes("*") && !opts.allowedOrigins.includes(origin)) {
      return socket.close(1008, "origin not allowed");
    }
    const ip = clientIp(request);
    const open = socketsPerIp.get(ip) ?? 0;
    if (open >= MAX_WS_PER_IP) return socket.close(1008, "too many connections");
    if (limiter?.hit(ip)) return socket.close(1008, "rate limit exceeded");
    socketsPerIp.set(ip, open + 1);

    const upstream = new WebSocket(opts.wsUrl);
    let clientGone = false;
    const backlog: string[] = [];
    /** Subscription ids confirmed by upstream, and in-flight (un)subscribe requests by client request id. */
    const subs = new Set<number>();
    const inflight = new Map<string | number, { unsubscribe: number | null }>();
    const reply = (id: RpcId, code: number, message: string) => socket.send(JSON.stringify(rpcError(id, code, message)));

    upstream.on("open", () => {
      for (const message of backlog) upstream.send(message);
      backlog.length = 0;
    });
    upstream.on("message", (data, isBinary) => {
      if (inflight.size > 0 && !isBinary) {
        try {
          const message: unknown = JSON.parse(data.toString());
          const id = callId(message);
          const pending = id === null ? undefined : inflight.get(id);
          if (id !== null && pending && isRecord(message)) {
            inflight.delete(id);
            if (pending.unsubscribe === null && typeof message.result === "number") subs.add(message.result);
            if (pending.unsubscribe !== null && message.result === true) subs.delete(pending.unsubscribe);
          }
        } catch {
          // Unparseable upstream frames are relayed untouched.
        }
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(data, { binary: isBinary });
    });
    upstream.on("close", () => socket.close(1011, "upstream closed"));
    upstream.on("error", (error) => {
      // Terminating a still-connecting upstream after the client left also lands here.
      if (clientGone) return;
      request.log.warn({ err: error.message }, "rpc-ws upstream error");
      socket.close(1011, "upstream RPC unavailable");
    });

    socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return socket.close(1003, "text frames only");
      const text = data.toString();
      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        return reply(null, -32700, "parse error");
      }
      const id = callId(message);
      if (!isRecord(message) || typeof message.method !== "string") return reply(id, -32600, "invalid request");
      const method = message.method;
      if (!Object.hasOwn(WS_METHODS, method)) {
        return reply(id, -32601, `method ${method.slice(0, 64)} is not available through this proxy`);
      }
      // web3.js's keepalive `ping` is not a user call; counting it would let a
      // few idle tabs behind one address exhaust the budget.
      if (method !== "ping" && limiter?.hit(ip)) {
        if (id !== null) reply(id, -32005, `rate limit exceeded (${opts.perMin} RPC calls/min)`);
        return;
      }
      if (method.endsWith("Subscribe") || method.endsWith("Unsubscribe")) {
        if (id === null) return reply(null, -32600, "subscription requests need an id");
        const unsubscribe = method.endsWith("Unsubscribe");
        const target = unsubscribe && Array.isArray(message.params) ? message.params[0] : null;
        if (unsubscribe && typeof target !== "number") return reply(id, -32602, "expected [subscriptionId]");
        if (!unsubscribe) {
          let pending = 0;
          for (const request of inflight.values()) if (request.unsubscribe === null) pending += 1;
          if (subs.size + pending >= MAX_SUBS_PER_WS) {
            return reply(id, -32005, `at most ${MAX_SUBS_PER_WS} subscriptions per connection`);
          }
        }
        inflight.set(id, { unsubscribe: unsubscribe ? (target as number) : null });
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
      else if (upstream.readyState === WebSocket.CONNECTING && backlog.length < MAX_WS_BACKLOG) backlog.push(text);
      else socket.close(1011, "upstream RPC unavailable");
    });

    socket.on("close", () => {
      clientGone = true;
      const left = (socketsPerIp.get(ip) ?? 1) - 1;
      if (left > 0) socketsPerIp.set(ip, left);
      else socketsPerIp.delete(ip);
      upstream.terminate();
    });
  });
}
