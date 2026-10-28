import { sql } from "./db.ts";

/**
 * Liveness of the background role, as the HTTP role reports it.
 *
 * The indexer and keeper run in their own process (ROLE=indexer), so they
 * publish what /health needs into `service_status`, and the API reads it back:
 * how far behind the chain the read model may be, and the keeper's wallet
 * balance and last run.
 */

/** The keeper wallet is reported low below 0.03 SOL, in its logs and on /health. */
export const KEEPER_LOW_BALANCE = 30_000_000n;
/** Below 0.02 SOL the keeper stops sending rather than drain itself. */
export const KEEPER_MIN_BALANCE = 20_000_000n;

/** The read model is reported stale once its last complete catch-up is older than this. */
export const INDEXER_MAX_LAG_SECS = 180;
/** A background process that has not written its status for this long is reported down. */
export const STATUS_STALE_SECS = 300;

export type ServiceName = "indexer" | "keeper";

/** Merge `detail` into the service's row (JSON merge, so writers can update a subset). */
export async function writeStatus(name: ServiceName, detail: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify(detail, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
  await sql`
    INSERT INTO service_status (name, detail, updated_at)
    VALUES (${name}, ${json}::text::jsonb, NOW())
    ON CONFLICT (name) DO UPDATE SET detail = service_status.detail || EXCLUDED.detail, updated_at = NOW()
  `;
}

export interface StatusRow {
  name: string;
  detail: Record<string, unknown>;
  updated_at: Date;
}

export async function readStatus(): Promise<StatusRow[]> {
  const rows = await sql`SELECT name, detail, updated_at FROM service_status`;
  return rows.map((row) => ({
    name: row.name as string,
    detail: (row.detail ?? {}) as Record<string, unknown>,
    updated_at: new Date(row.updated_at as string | Date),
  }));
}

const secondsSince = (iso: unknown, now: number): number | null => {
  if (typeof iso !== "string") return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 1000)) : null;
};

export interface IndexerHealth {
  reporting: boolean;
  /** Seconds since the last pass that brought the read model level with the chain. */
  lagSeconds: number | null;
  caughtUpAt: string | null;
  lastEventAt: string | null;
  cursorSlot: number | null;
  websocket: string | null;
}

export interface KeeperHealth {
  enabled: boolean;
  reporting: boolean;
  wallet: string | null;
  balanceLamports: string | null;
  balanceSol: number | null;
  low: boolean;
  belowFloor: boolean;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastError: string | null;
  lastSentAt: string | null;
}

export interface Health {
  status: "ok" | "degraded";
  warnings: string[];
  indexer: IndexerHealth;
  keeper: KeeperHealth;
}

/**
 * Turn the status rows into the report /health serves. Pure, so the
 * thresholds are testable without a database.
 */
export function assessHealth(rows: StatusRow[], now = Date.now()): Health {
  const warnings: string[] = [];
  const indexerRow = rows.find((row) => row.name === "indexer");
  const keeperRow = rows.find((row) => row.name === "keeper");

  const idx = indexerRow?.detail ?? {};
  const indexerReporting = !!indexerRow && (now - indexerRow.updated_at.getTime()) / 1000 <= STATUS_STALE_SECS;
  const lagSeconds = secondsSince(idx.caughtUpAt, now);
  const indexer: IndexerHealth = {
    reporting: indexerReporting,
    lagSeconds,
    caughtUpAt: typeof idx.caughtUpAt === "string" ? idx.caughtUpAt : null,
    lastEventAt: typeof idx.lastEventAt === "string" ? idx.lastEventAt : null,
    cursorSlot: typeof idx.cursorSlot === "number" ? idx.cursorSlot : null,
    websocket: typeof idx.websocket === "string" ? idx.websocket : null,
  };
  if (!indexerRow) warnings.push("indexer has never reported");
  else if (!indexerReporting) warnings.push(`indexer silent for ${Math.round((now - indexerRow.updated_at.getTime()) / 1000)}s`);
  if (indexerRow && (lagSeconds === null || lagSeconds > INDEXER_MAX_LAG_SECS)) {
    warnings.push(lagSeconds === null ? "indexer has not caught up yet" : `indexer ${lagSeconds}s behind the chain`);
  }

  const kp = keeperRow?.detail ?? {};
  const enabled = kp.enabled === true;
  const keeperReporting = !!keeperRow && (now - keeperRow.updated_at.getTime()) / 1000 <= STATUS_STALE_SECS;
  const balance = typeof kp.balanceLamports === "string" && /^\d+$/.test(kp.balanceLamports) ? BigInt(kp.balanceLamports) : null;
  const intervalMs = typeof kp.intervalMs === "number" ? kp.intervalMs : 60_000;
  const keeper: KeeperHealth = {
    enabled,
    reporting: keeperReporting,
    wallet: typeof kp.wallet === "string" ? kp.wallet : null,
    balanceLamports: balance?.toString() ?? null,
    balanceSol: balance === null ? null : Number(balance) / 1e9,
    low: balance !== null && balance < KEEPER_LOW_BALANCE,
    belowFloor: balance !== null && balance < KEEPER_MIN_BALANCE,
    lastRunAt: typeof kp.lastRunAt === "string" ? kp.lastRunAt : null,
    lastRunOk: typeof kp.lastRunOk === "boolean" ? kp.lastRunOk : null,
    lastError: typeof kp.lastError === "string" ? kp.lastError : null,
    lastSentAt: typeof kp.lastSentAt === "string" ? kp.lastSentAt : null,
  };
  if (!keeperRow) warnings.push("keeper has never reported");
  else if (!enabled) warnings.push("keeper disabled (KEEPER_KEYPAIR not set)");
  else {
    if (!keeperReporting) warnings.push(`keeper silent for ${Math.round((now - keeperRow.updated_at.getTime()) / 1000)}s`);
    if (keeper.belowFloor) warnings.push(`keeper wallet ${keeper.balanceSol} SOL is below the 0.02 SOL floor; cranks stopped`);
    else if (keeper.low) warnings.push(`keeper wallet ${keeper.balanceSol} SOL is below 0.03 SOL; top it up`);
    const sinceRun = secondsSince(keeper.lastRunAt, now);
    const runBudget = Math.max((3 * intervalMs) / 1000, 300);
    if (sinceRun === null || sinceRun > runBudget) {
      warnings.push(sinceRun === null ? "keeper has not completed a run" : `keeper last ran ${sinceRun}s ago`);
    }
    if (keeper.lastRunOk === false) warnings.push(`keeper last run failed: ${keeper.lastError ?? "unknown error"}`);
  }

  return { status: warnings.length === 0 ? "ok" : "degraded", warnings, indexer, keeper };
}
