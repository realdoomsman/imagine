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
    /** Each lock earns at most its SOL value when locked × its multiplier. */
    capped: boolean;
    /** Lamports the open locks can still earn in total. */
    rewardCapacity: string;
  };
  /** Realised fee flow over the last 24 hours, lamports; rewards track the coin's own volume. */
  rewardRate: {
    lockersPerDay: string;
    feesPerDay: string;
    waitingAtPump: string;
    siteVolume: string;
    trades: number;
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
  /** Capped pools: the most this lock may ever be paid, lamports. */
  rewardCap: string | null;
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
  /** The pool's frozen lock window, so an extend offers only legal terms. */
  minLockSecs: number | null;
  maxLockSecs: number | null;
  /** Capped pools: the most this lock may ever be paid, lamports. */
  rewardCap: string | null;
}

/**
 * Server-rendered pages all reach the API from this container's one egress
 * address, so they would share a single rate-limit bucket that one busy
 * visitor could exhaust for everyone. The server identifies itself with a
 * key only it holds (never NEXT_PUBLIC, so never in a bundle); the browser
 * sends nothing and is limited per visitor as usual.
 */
function serverHeaders(): Record<string, string> {
  if (typeof window !== "undefined") return {};
  const key = process.env.VISE_INTERNAL_KEY;
  return key ? { "x-vise-internal": key } : {};
}

/**
 * Thin fetch wrapper.
 *
 * `no-store` on every call: this is live financial state, and a stale reward
 * number is worse than a slow one. `credentials: include` so the account
 * session cookie rides along to the API's origin.
 */
async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    credentials: "include",
    ...init,
    headers: { ...serverHeaders(), ...init?.headers },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`api ${path} failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export class ApiError extends Error {
  readonly status: number;
  /** Whatever else the API put beside `error`, e.g. a mint to resume. */
  readonly detail: Record<string, unknown>;
  constructor(status: number, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  // FormData sets its own multipart boundary; anything else is JSON.
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: body instanceof FormData ? {} : { "content-type": "application/json" },
    credentials: "include",
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => ({ error: response.statusText }));
    const record = typeof detail === "object" && detail !== null ? (detail as Record<string, unknown>) : {};
    throw new ApiError(
      response.status,
      typeof record.error === "string" ? record.error : `request failed (${response.status})`,
      record,
    );
  }
  return (await response.json()) as T;
}

/** The API's Google sign-in start; after Google it returns the browser to `returnTo`. */
export function googleSignInUrl(returnTo: string): string {
  return `${BASE}/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`;
}

export interface AccountInfo {
  email: string;
  name: string | null;
  picture: string | null;
  wallet: string;
  createdAt: string;
}

export interface Holding {
  mint: string;
  amount: string;
  decimals: number;
  tokenProgram: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  priceLamports: number | null;
  hasPool: boolean;
}

export interface WalletPosition extends PortfolioPosition {
  secondsLeft: number;
  matured: boolean;
  earlyExitBurn: string;
}

export interface WalletView {
  account: AccountInfo;
  wallet: string;
  sol: string;
  /** Withdrawable SOL: balance less rent and a network fee. */
  solAvailable: string;
  holdings: Holding[];
  positions: WalletPosition[];
  totals: { pending: string; claimed: string; positions: number };
  actions: Array<{
    kind: string;
    detail: Record<string, unknown>;
    signature: string | null;
    failed: boolean;
    at: string;
  }>;
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
  config: () =>
    get<{ cluster: string; treasury: string; tradeFeeBps: number; googleClientId: string }>(
      "/config",
    ),

  /** VISE accounts: Google sign-in and the wallet the API holds for it. */
  me: () => get<{ account: AccountInfo }>("/api/me"),
  wallet: () => get<WalletView>("/api/me/wallet"),
  loginWithGoogle: (credential: string) =>
    post<{ account: AccountInfo }>("/api/auth/google", { credential }),
  logout: () => post<{ ok: true }>("/api/auth/logout", {}),
  act: (action: Record<string, unknown>) =>
    post<{ signature: string } & Record<string, string | number>>("/api/me/action", action),
  withdraw: (body: { to: string; amount: string; mint?: string }) =>
    post<{ signature: string }>("/api/me/withdraw", body),
  exportKey: () => post<{ wallet: string; secretKey: string }>("/api/me/export-key", {}),
  /** Pin the coin's image and metadata JSON; returns the URI pump.fun reads. */
  pinMetadata: (form: FormData) => post<{ uri: string; image: string }>("/api/metadata", form),
  launchFromAccount: (body: Record<string, unknown>) =>
    post<{ mint: string; pool: string; lockAmount: string; signatures: Array<{ label: string; signature: string }> }>(
      "/api/me/launch",
      body,
    ),
};
