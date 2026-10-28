const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/**
 * A StonkFun pair asset: what a coin is priced in, what its trades pay in, and
 * so what its lockers earn. SOL, USDC, an xStock like NVDAx, a currency…
 */
export interface QuoteInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  tokenProgram: string;
  category: string;
  logoUrl: string | null;
  /** USD per one whole token; null when no price source answers. */
  usdPrice: number | null;
}

export interface PoolSummary {
  mint: string;
  symbol: string | null;
  name: string | null;
  image_url: string | null;
  creator: string;
  quote: QuoteInfo;
  total_locked: string;
  total_weight: string;
  token_supply: string | null;
  token_decimals: number;
  /** Quote base units. */
  lifetime_rewards: string;
  /** Quote base units. */
  lifetime_inflow: string;
  open_positions: number;
  creator_share_bps: number;
  treasury_share_bps: number;
  max_multiplier_bps: number;
  /** Quote UI units per one whole coin. */
  price_quote: number | null;
  price_usd: number | null;
  /** Quote base units. */
  market_cap_quote: string | null;
  market_cap_usd: number | null;
  curve_progress: number | null;
  graduated: boolean;
  created_at: string;
  lockedFraction: number;
  apr: number | null;
}

export type CurveStatus = "curve" | "migrating" | "graduated";

export interface PoolDetail {
  mint: string;
  /** Total supply in base units; size tiers are a share of it. */
  tokenSupply: string | null;
  tokenDecimals: number;
  quote: QuoteInfo;
  links: { stonkfun: string; raydium: string | null };
  /** Quote base units at spot; null when the price is unknown. */
  marketCapQuote: string | null;
  marketCapUsd: number | null;
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
    /** Holds a token-quoted pool's rewards; null when the pair is SOL. */
    rewardTokenAccount: string | null;
    /** The coin's LaunchLab pool state. */
    launchlabPool: string;
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
    /** Every amount below is quote base units. */
    lifetimeInflow: string;
    lifetimeRewards: string;
    lifetimeBurned: string;
    creatorClaimable: string;
    treasuryClaimable: string;
    undistributed: string;
    streamEnd: number;
    openPositions: number;
    createdAt: number;
    /** Quote base units the open locks can still earn in total (each lock is capped at its value × multiplier). */
    rewardCapacity: string;
  };
  /** Realised fee flow over the last 24 hours, quote base units. */
  rewardRate: {
    lockersPerDay: string;
    feesPerDay: string;
    /** Sitting in the vault, not yet booked by `sync`. */
    unsynced: string;
    siteVolume: string;
    trades: number;
  };
  curve: {
    status: CurveStatus;
    progress: number;
    priceQuote: number;
    priceUsd: number | null;
    realQuote: string;
    fundRaising: string;
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
  /** The most this lock may ever be paid, quote base units. */
  rewardCap: string;
  /** Gave up its earnings for good: tokens locked, earns nothing. */
  renounced: boolean;
}

/** Fee history for the reward chart: slots of `bucketSecs` from `since` (unix seconds) to now. */
export interface RewardHistory {
  since: number;
  bucketSecs: number;
  /** The pool's creation, unix seconds; null if unknown. */
  createdAt: number | null;
  buckets: Array<{ bucket: string; inflow: string | null; to_lockers: string | null }>;
}

export interface PortfolioPosition {
  address: string;
  mint: string | null;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  decimals: number;
  /** The pair asset this lock earns in; null if the pool could not be read. */
  quote: QuoteInfo | null;
  index: number;
  amount: string;
  weight: string;
  multiplierBps: number;
  lockStart: number;
  lockEnd: number;
  /** Quote base units. */
  claimed: string;
  /** Quote base units. */
  pending: string;
  share: number;
  /** The pool's frozen lock window, so an extend offers only legal terms. */
  minLockSecs: number | null;
  maxLockSecs: number | null;
  /** The most this lock may ever be paid, quote base units. */
  rewardCap: string;
  /** Gave up its earnings for good: tokens locked, earns nothing. */
  renounced: boolean;
}

export interface PortfolioTotals {
  pendingUsd: number | null;
  claimedUsd: number | null;
  positions: number;
}

export interface LeaderboardEarner {
  owner: string;
  earned_usd: number | null;
  coins: number;
  last_claim: string | null;
  earned: Array<{ quote: QuoteInfo; amount: string }>;
}

export interface LeaderboardCoin {
  mint: string;
  symbol: string | null;
  name: string | null;
  image_url: string | null;
  quote: QuoteInfo;
  lifetime_rewards: string;
  lifetime_inflow: string;
  lifetime_rewards_usd: number | null;
  open_positions: number;
  total_locked: string;
  token_supply: string | null;
}

export interface LeaderboardDiamond {
  owner: string;
  mint: string;
  symbol: string | null;
  image_url: string | null;
  amount: string;
  multiplier_bps: number;
  /** ISO timestamp. */
  lock_end: string;
  term_secs: number;
  token_decimals: number;
}

export type Leaderboard =
  | { board: "earners"; rows: LeaderboardEarner[] }
  | { board: "coins"; rows: LeaderboardCoin[] }
  | { board: "diamond"; rows: LeaderboardDiamond[] };

export interface Stats {
  pools: number;
  open_positions: number;
  trades_24h: number;
  paid_to_lockers_usd: number | null;
  total_inflow_usd: number | null;
  lockers_24h_usd: number | null;
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
  const key = process.env.IMAGINE_INTERNAL_KEY;
  return key ? { "x-imagine-internal": key } : {};
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
    throw new ApiError(response.status, `api ${path} failed: ${response.status} ${detail.slice(0, 200)}`);
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
  /** Quote UI units per one whole coin, for a coin with a pool. */
  priceQuote: number | null;
  priceUsd: number | null;
  hasPool: boolean;
  /** The coin's pair, when it has a pool. */
  quote: QuoteInfo | null;
  /** Set when the holding is itself a pair asset (NVDAx, USDC…). */
  asset: QuoteInfo | null;
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
  totals: PortfolioTotals;
  actions: Array<{
    kind: string;
    detail: Record<string, unknown>;
    signature: string | null;
    failed: boolean;
    at: string;
  }>;
}

export interface ActivityRow {
  type: string;
  owner: string;
  amount: string;
  at: string;
  signature: string;
}

export const api = {
  pools: (params: { sort?: string; limit?: number; search?: string; category?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.sort) query.set("sort", params.sort);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.search) query.set("search", params.search);
    if (params.category) query.set("category", params.category);
    return get<{ pools: PoolSummary[] }>(`/api/pools?${query}`);
  },
  pool: (mint: string) => get<PoolDetail>(`/api/pools/${mint}`),
  lockers: (mint: string) =>
    get<{ lockers: Locker[]; totalWeight: string }>(`/api/pools/${mint}/lockers`),
  rewards: (mint: string) => get<RewardHistory>(`/api/pools/${mint}/rewards`),
  activity: (mint: string) => get<{ activity: ActivityRow[] }>(`/api/pools/${mint}/activity`),
  /** Every pair StonkFun can launch against right now. */
  quotes: () => get<QuoteInfo[]>("/api/quotes"),
  portfolio: (owner: string) =>
    get<{ positions: PortfolioPosition[]; totals: PortfolioTotals }>(`/api/portfolio/${owner}`),
  leaderboard: <B extends Leaderboard["board"]>(board: B) =>
    get<Extract<Leaderboard, { board: B }>>(`/api/leaderboard?board=${board}`),
  stats: () => get<Stats>("/api/stats"),
  config: () =>
    get<{ cluster: string; treasury: string; tradeFeeBps: number; googleClientId: string }>("/config"),

  /** Imagine wallet: Google sign-in and the wallet the API holds for it. */
  me: () => get<{ account: AccountInfo }>("/api/me"),
  wallet: () => get<WalletView>("/api/me/wallet"),
  loginWithGoogle: (credential: string) =>
    post<{ account: AccountInfo }>("/api/auth/google", { credential }),
  logout: () => post<{ ok: true }>("/api/auth/logout", {}),
  act: (action: Record<string, unknown>) =>
    post<{ signature: string } & Record<string, unknown>>("/api/me/action", action),
  withdraw: (body: { to: string; amount: string; mint?: string }) =>
    post<{ signature: string }>("/api/me/withdraw", body),
  exportKey: () => post<{ wallet: string; secretKey: string }>("/api/me/export-key", {}),
  /** Store the coin's image and metadata JSON; returns the URI the coin is created with. */
  pinMetadata: (form: FormData) => post<{ uri: string; image: string }>("/api/metadata", form),
  /** Choose the mint for an account launch, so its metadata can link to its page. */
  launchMint: () => post<{ mint: string; nonce: string }>("/api/me/launch/mint", {}),
  launchFromAccount: (body: Record<string, unknown>) =>
    post<{ mint: string; pool: string; lockAmount: string; signatures: Array<{ label: string; signature: string }> }>(
      "/api/me/launch",
      body,
    ),
};
