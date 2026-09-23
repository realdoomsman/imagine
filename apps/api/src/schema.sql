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
