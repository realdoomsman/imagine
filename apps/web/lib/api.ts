const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export interface PoolSummary {
  mint: string;
  symbol: string | null;
  name: string | null;
  image_url: string | null;
  creator: string;
  total_locked: string;
  total_weight: string;
  token_supply: string | null;
  token_decimals: number;
  lifetime_rewards: string;
  lifetime_inflow: string;
  open_positions: number;
  creator_share_bps: number;
  treasury_share_bps: number;
  max_multiplier_bps: number;
  price_lamports: number | null;
  market_cap_lamports: string | null;
  curve_progress: number | null;
  graduated: boolean;
  created_at: string;
  lockedFraction: number;
  apr: number | null;
}

export interface PoolDetail {
  mint: string;
  /** Total supply in base units; size tiers are a share of it. */
  tokenSupply: string | null;
  tokenDecimals: number;
  metadata: {
    name: string | null;
    symbol: string | null;
    imageUrl: string | null;
    description: string | null;
    twitter: string | null;
    telegram: string | null;
    website: string | null;
  } | null;
  pool: {
    creator: string;
    rewardVault: string;
    tokenVault: string;
    tokenProgram: string;
    terms: {
      treasuryShareBps: number;
      creatorShareBps: number;
      minLockSecs: number;
      maxLockSecs: number;
      maxMultiplierBps: number;
      earlyUnlockPenaltyBps: number;
      minLockAmount: string;
      rewardStreamSecs: number;
      durationCurve: number;
      sizeTierBps: [number, number, number];
      sizeBonusBps: [number, number, number];
    };
    totalLocked: string;
    totalWeight: string;
    accRewardPerWeight: string;
    lifetimeInflow: string;
    lifetimeRewards: string;
    lifetimeBurned: string;
    creatorClaimable: string;
    treasuryClaimable: string;
    undistributed: string;
    streamEnd: number;
    openPositions: number;
    createdAt: number;
  };
  curve: {
    complete: boolean;
    progress: number;
    priceLamports: number;
    virtualSolReserves: string;
    realSolReserves: string;
  } | null;
}

export interface Locker {
  owner: string;
  index: number;
  amount: string;
  weight: string;
  multiplierBps: number;
  lockEnd: number;
  claimed: string;
  pending: string;
  share: number;
}

export interface PortfolioPosition {
  address: string;
  mint: string | null;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  decimals: number;
  index: number;
  amount: string;
  weight: string;
  multiplierBps: number;
  lockStart: number;
  lockEnd: number;
  claimed: string;
  pending: string;
  share: number;
}

/**
 * Thin fetch wrapper.
 *
 * `no-store` on every call: this is live financial state, and a stale reward
 * number is worse than a slow one.
 */
async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { cache: "no-store", ...init });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`api ${path} failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(
      typeof detail === "object" && detail && "error" in detail
        ? String((detail as { error: unknown }).error)
        : `request failed (${response.status})`,
    );
  }
  return (await response.json()) as T;
}

export const api = {
  pools: (params: { sort?: string; limit?: number; search?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.sort) query.set("sort", params.sort);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.search) query.set("search", params.search);
    return get<{ pools: PoolSummary[] }>(`/api/pools?${query}`);
  },
  pool: (mint: string) => get<PoolDetail>(`/api/pools/${mint}`),
  lockers: (mint: string) =>
    get<{ lockers: Locker[]; totalWeight: string }>(`/api/pools/${mint}/lockers`),
  rewards: (mint: string) =>
    get<{ buckets: Array<{ bucket: string; inflow: string; to_lockers: string }> }>(
      `/api/pools/${mint}/rewards`,
    ),
  activity: (mint: string) =>
    get<{
      activity: Array<{
        type: string;
        owner: string;
        amount: string;
        at: string;
        signature: string;
      }>;
    }>(`/api/pools/${mint}/activity`),
  portfolio: (owner: string) =>
    get<{
      positions: PortfolioPosition[];
      totals: { pending: string; claimed: string; positions: number };
    }>(`/api/portfolio/${owner}`),
  leaderboard: (board: string) =>
    get<{ board: string; rows: Array<Record<string, string | number | null>> }>(
      `/api/leaderboard?board=${board}`,
    ),
  stats: () =>
    get<{
      pools: number;
      paid_to_lockers: string;
      total_inflow: string;
      open_positions: number;
      lockers_24h: string;
      trades_24h: number;
    }>("/api/stats"),
};
