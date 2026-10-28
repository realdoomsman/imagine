-- IMAGINE indexer schema.
--
-- Chain is the source of truth; this is a read model built from program events
-- so list pages, charts and leaderboards do not need hundreds of RPC calls.
-- Every row is reconstructible by replaying logs from `indexer_cursor.slot`.
--
-- Reward amounts are in the pool's quote asset, in its base units (lamports
-- for SOL-paired coins, 10^-8 SPYx for SPYx-paired ones, …), so they are only
-- comparable within one quote. Cross-quote figures (leaderboards, stats) are
-- converted to USD at read time.

CREATE TABLE IF NOT EXISTS pools (
  mint                     TEXT PRIMARY KEY,
  pool                     TEXT NOT NULL UNIQUE,
  creator                  TEXT NOT NULL,
  reward_vault             TEXT NOT NULL,
  -- ATA of the reward vault for a token quote; NULL when rewards are native SOL.
  reward_token_account     TEXT,
  token_vault              TEXT NOT NULL,
  token_program            TEXT NOT NULL,
  launchlab_pool           TEXT NOT NULL,
  quote_mint               TEXT NOT NULL,
  quote_token_program      TEXT NOT NULL,
  quote_symbol             TEXT NOT NULL,
  quote_name               TEXT NOT NULL,
  quote_decimals           SMALLINT NOT NULL,
  quote_category           TEXT NOT NULL,
  quote_logo_url           TEXT,
  name                     TEXT,
  symbol                   TEXT,
  image_url                TEXT,
  metadata_uri             TEXT,
  description              TEXT,
  twitter                  TEXT,
  telegram                 TEXT,
  website                  TEXT,
  treasury_share_bps       INTEGER NOT NULL,
  creator_share_bps        INTEGER NOT NULL,
  min_lock_secs            INTEGER NOT NULL,
  max_lock_secs            INTEGER NOT NULL,
  max_multiplier_bps       INTEGER NOT NULL,
  early_unlock_penalty_bps INTEGER NOT NULL,
  total_locked             NUMERIC(40, 0) NOT NULL DEFAULT 0,
  total_weight             NUMERIC(50, 0) NOT NULL DEFAULT 0,
  lifetime_inflow          NUMERIC(40, 0) NOT NULL DEFAULT 0,
  lifetime_rewards         NUMERIC(40, 0) NOT NULL DEFAULT 0,
  lifetime_burned          NUMERIC(40, 0) NOT NULL DEFAULT 0,
  open_positions           INTEGER NOT NULL DEFAULT 0,
  token_supply             NUMERIC(40, 0),
  token_decimals           SMALLINT NOT NULL DEFAULT 6,
  -- Quote UI units (base units / 10^quote_decimals) per whole coin.
  price_quote              DOUBLE PRECISION,
  -- Quote base units.
  market_cap_quote         NUMERIC(40, 0),
  curve_progress           REAL,
  graduated                BOOLEAN NOT NULL DEFAULT FALSE,
  -- Unlisted pools: still indexed and reachable by their lockers' portfolios,
  -- but left out of lists, leaderboards and stats. Set by hand.
  hidden                   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The reconciler re-reads the stalest pools first.
CREATE INDEX IF NOT EXISTS pools_updated_at_idx ON pools (updated_at);
CREATE INDEX IF NOT EXISTS pools_created_at_idx ON pools (created_at DESC);
CREATE INDEX IF NOT EXISTS pools_quote_mint_idx ON pools (quote_mint);

CREATE TABLE IF NOT EXISTS positions (
  address        TEXT PRIMARY KEY,
  mint           TEXT NOT NULL REFERENCES pools (mint) ON DELETE CASCADE,
  owner          TEXT NOT NULL,
  idx            INTEGER NOT NULL,
  amount         NUMERIC(40, 0) NOT NULL,
  weight         NUMERIC(50, 0) NOT NULL,
  multiplier_bps INTEGER NOT NULL,
  lock_start     TIMESTAMPTZ NOT NULL,
  lock_end       TIMESTAMPTZ NOT NULL,
  claimed        NUMERIC(40, 0) NOT NULL DEFAULT 0,
  closed         BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS positions_owner_idx ON positions (owner) WHERE NOT closed;
CREATE INDEX IF NOT EXISTS positions_mint_idx ON positions (mint) WHERE NOT closed;
CREATE INDEX IF NOT EXISTS positions_weight_idx ON positions (mint, weight DESC);
-- The diamond board: live locks that have not ended yet.
CREATE INDEX IF NOT EXISTS positions_live_lock_end_idx ON positions (lock_end) WHERE NOT closed;

-- Append-only event log. Drives the live feed, the reward chart, and APR,
-- which is computed from realised inflow rather than projected volume.
-- kind: 0 buy fee, 1 sell fee, 2 creator share, 3 donation (FeeDeposited);
-- 4 a sync (RewardsSynced: what the pool actually took in, every source once);
-- 5 synced inflow with no transaction in the read model (history from before
-- its cursor), reconstructed from the pool's lifetime counters at startup —
-- charted, never counted in a 24h/7d rate. Its signature is
-- `history-gap:<mint>:<lifetime inflow>`.
CREATE TABLE IF NOT EXISTS fee_events (
  id          BIGSERIAL PRIMARY KEY,
  signature   TEXT NOT NULL,
  mint        TEXT NOT NULL,
  kind        SMALLINT NOT NULL,
  payer       TEXT,
  amount      NUMERIC(40, 0) NOT NULL,
  to_lockers  NUMERIC(40, 0) NOT NULL DEFAULT 0,
  slot        BIGINT NOT NULL,
  at          TIMESTAMPTZ NOT NULL,
  UNIQUE (signature, mint, amount, kind)
);

CREATE INDEX IF NOT EXISTS fee_events_mint_at_idx ON fee_events (mint, at DESC);
CREATE INDEX IF NOT EXISTS fee_events_at_idx ON fee_events (at DESC);

CREATE TABLE IF NOT EXISTS lock_events (
  id        BIGSERIAL PRIMARY KEY,
  signature TEXT NOT NULL,
  mint      TEXT NOT NULL,
  owner     TEXT NOT NULL,
  kind      TEXT NOT NULL,
  amount    NUMERIC(40, 0) NOT NULL DEFAULT 0,
  weight    NUMERIC(50, 0) NOT NULL DEFAULT 0,
  lock_end  TIMESTAMPTZ,
  slot      BIGINT NOT NULL,
  at        TIMESTAMPTZ NOT NULL,
  UNIQUE (signature, mint, owner, kind, amount)
);

CREATE INDEX IF NOT EXISTS lock_events_mint_at_idx ON lock_events (mint, at DESC);

CREATE TABLE IF NOT EXISTS claim_events (
  id        BIGSERIAL PRIMARY KEY,
  signature TEXT NOT NULL,
  mint      TEXT NOT NULL,
  owner     TEXT NOT NULL,
  amount    NUMERIC(40, 0) NOT NULL,
  slot      BIGINT NOT NULL,
  at        TIMESTAMPTZ NOT NULL,
  UNIQUE (signature, mint, owner, amount)
);

CREATE INDEX IF NOT EXISTS claim_events_owner_idx ON claim_events (owner, at DESC);
CREATE INDEX IF NOT EXISTS claim_events_mint_idx ON claim_events (mint, at DESC);

CREATE TABLE IF NOT EXISTS indexer_cursor (
  id        SMALLINT PRIMARY KEY DEFAULT 1,
  slot      BIGINT NOT NULL DEFAULT 0,
  signature TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT indexer_cursor_singleton CHECK (id = 1)
);

INSERT INTO indexer_cursor (id, slot) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- What the indexer/keeper process last reported, for the API's /health:
-- indexer catch-up time and cursor, keeper wallet balance and last run.
CREATE TABLE IF NOT EXISTS service_status (
  name       TEXT PRIMARY KEY,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Single-holder leases. The keeper takes one before every send, so two
-- indexer processes overlapping during a deploy never both crank.
CREATE TABLE IF NOT EXISTS leases (
  name       TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Every sync the keeper sent. Observability, not accounting: the pool account
-- is the ledger, this is the log of who cranked it and when.
CREATE TABLE IF NOT EXISTS keeper_runs (
  id        BIGSERIAL PRIMARY KEY,
  mint      TEXT NOT NULL,
  amount    NUMERIC(40, 0) NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS keeper_runs_mint_at_idx ON keeper_runs (mint, at DESC);

-- Coin metadata hosted here: the image and the Metaplex-shaped JSON document
-- the mint's on-chain URI points at (/files/meta/<mint>.json,
-- /files/img/<mint>). Keyed by the mint chosen up front, because the
-- document's website is that coin's IMAGINE page. A launch refuses any other
-- URI, and a row is frozen once its mint exists on chain.
CREATE TABLE IF NOT EXISTS coin_files (
  mint        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  image       BYTEA NOT NULL,
  image_type  TEXT NOT NULL,
  metadata    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IMAGINE accounts: a Google identity and the wallet the API holds for it.
-- wallet_secret is AES-256-GCM under WALLET_MASTER_KEY; the database alone
-- cannot recover a key. Rows are never deleted — an account that exported its
-- key and left still has history worth keeping.
CREATE TABLE IF NOT EXISTS accounts (
  id            BIGSERIAL PRIMARY KEY,
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  name          TEXT,
  picture       TEXT,
  wallet_pubkey TEXT NOT NULL UNIQUE,
  wallet_secret BYTEA NOT NULL,
  -- Bumped by logout; a session token carries the epoch it was issued under
  -- and is refused once they differ, so one sign-out ends every session.
  session_epoch INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- What each account asked the API to sign, and the signature that resulted.
CREATE TABLE IF NOT EXISTS account_actions (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts (id),
  kind       TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature  TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS account_actions_account_at_idx ON account_actions (account_id, at DESC);
