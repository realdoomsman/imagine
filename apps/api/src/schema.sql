-- VISE indexer schema.
--
-- Chain is the source of truth; this is a read model built from program events
-- so list pages, charts and leaderboards do not need hundreds of RPC calls.
-- Every row is reconstructible by replaying logs from `indexer_cursor.slot`.

CREATE TABLE IF NOT EXISTS pools (
  mint                     TEXT PRIMARY KEY,
  pool                     TEXT NOT NULL UNIQUE,
  creator                  TEXT NOT NULL,
  reward_vault             TEXT NOT NULL,
  token_vault              TEXT NOT NULL,
  token_program            TEXT NOT NULL,
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
  lifetime_inflow          BIGINT NOT NULL DEFAULT 0,
  lifetime_rewards         BIGINT NOT NULL DEFAULT 0,
  lifetime_burned          NUMERIC(40, 0) NOT NULL DEFAULT 0,
  open_positions           INTEGER NOT NULL DEFAULT 0,
  token_supply             NUMERIC(40, 0),
  token_decimals           SMALLINT NOT NULL DEFAULT 6,
  price_lamports           DOUBLE PRECISION,
  market_cap_lamports      BIGINT,
  curve_progress           REAL,
  graduated                BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unlisted pools: still indexed and reachable by direct link (so their lockers
-- can manage positions), but left out of lists, leaderboards and stats. Set by
-- hand, e.g. for the mainnet smoke-test coin.
ALTER TABLE pools ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS pools_created_at_idx ON pools (created_at DESC);
CREATE INDEX IF NOT EXISTS pools_lifetime_rewards_idx ON pools (lifetime_rewards DESC);

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
  claimed        BIGINT NOT NULL DEFAULT 0,
  closed         BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS positions_owner_idx ON positions (owner) WHERE NOT closed;
CREATE INDEX IF NOT EXISTS positions_mint_idx ON positions (mint) WHERE NOT closed;
CREATE INDEX IF NOT EXISTS positions_weight_idx ON positions (mint, weight DESC);

-- Append-only event log. Drives the live feed, the reward chart, and APR,
-- which is computed from realised inflow rather than projected volume.
CREATE TABLE IF NOT EXISTS fee_events (
  id          BIGSERIAL PRIMARY KEY,
  signature   TEXT NOT NULL,
  mint        TEXT NOT NULL,
  kind        SMALLINT NOT NULL,
  payer       TEXT,
  amount      BIGINT NOT NULL,
  to_lockers  BIGINT NOT NULL DEFAULT 0,
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
  amount    BIGINT NOT NULL,
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

-- Every distribution the keeper sent. Observability, not accounting: the pool
-- account is the ledger, this is the log of who cranked it and when.
CREATE TABLE IF NOT EXISTS keeper_runs (
  id        BIGSERIAL PRIMARY KEY,
  mint      TEXT NOT NULL,
  lamports  BIGINT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS keeper_runs_mint_at_idx ON keeper_runs (mint, at DESC);

-- Coins created by the vise.fun launch flow. Only these may finish a launch
-- and get a VISE pool: the create stage registers the mint (never one that
-- already exists) and the finish stage refuses anything else.
CREATE TABLE IF NOT EXISTS launched_mints (
  mint    TEXT PRIMARY KEY,
  creator TEXT NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- VISE accounts: a Google identity and the wallet the API holds for it.
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
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bumped by logout; a session token carries the epoch it was issued under and
-- is refused once they differ, so one sign-out ends every session.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS session_epoch INTEGER NOT NULL DEFAULT 0;

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
