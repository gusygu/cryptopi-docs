-- src/db/ddl-str.sql
-- -------------------------------------------------------------------
-- Strategy Aux schema & tables required by /api/str-aux/*
-- Idempotent: safe to run multiple times.
-- -------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS strategy_aux;

-- ===================================================================
-- Main session row (one row per (base,quote,window,app_session_id))
-- ===================================================================
CREATE TABLE IF NOT EXISTS strategy_aux.str_aux_session (
  id                 BIGSERIAL PRIMARY KEY,

  pair_base          TEXT NOT NULL,
  pair_quote         TEXT NOT NULL DEFAULT 'USDT',
  window_key         TEXT NOT NULL,           -- '30m' | '1h' | '3h'
  app_session_id     TEXT NOT NULL,

  -- openings
  opening_stamp      BOOLEAN NOT NULL DEFAULT FALSE,
  opening_ts         BIGINT,
  opening_price      NUMERIC,

  -- price/greatests
  last_price         NUMERIC,
  last_update_ms     BIGINT,
  price_min          NUMERIC DEFAULT NULL,
  price_max          NUMERIC DEFAULT NULL,
  bench_pct_min      DOUBLE PRECISION DEFAULT NULL,
  bench_pct_max      DOUBLE PRECISION DEFAULT NULL,
  greatest_drv_abs   DOUBLE PRECISION DEFAULT 0,
  greatest_pct24h_abs DOUBLE PRECISION DEFAULT 0,
  greatest_bench_abs DOUBLE PRECISION DEFAULT 0,

  -- session knobs
  eta_pct            DOUBLE PRECISION DEFAULT 0.05,  -- for UI/guards
  eps_shift_pct      DOUBLE PRECISION DEFAULT 0.20,  -- epsilon for deltaGFM_pct
  k_cycles           INTEGER DEFAULT 32,

  -- shift & swap running state
  shifts             INTEGER NOT NULL DEFAULT 0,
  swaps              INTEGER NOT NULL DEFAULT 0,
  ui_epoch           INTEGER DEFAULT 0,

  -- (NEW) consecutive counters to persist across restarts
  above_count        INTEGER NOT NULL DEFAULT 0,
  below_count        INTEGER NOT NULL DEFAULT 0,

  -- (NEW) last swap bookkeeping
  last_swap_ms       BIGINT,
  last_swap_dir      SMALLINT,     -- +1 means +→-, -1 means -→+, 0/NULL if none

  -- GFM anchors
  gfm_anchor_price   NUMERIC,      -- baseline price for gfm ref
  gfm_calc_price_last NUMERIC,     -- calc price used in last gfm run
  gfm_r_last         DOUBLE PRECISION, -- latest raw gfm (0..1)
  gfm_delta_last     DOUBLE PRECISION, -- latest delta (as fraction, NOT %)

  -- compatibility flags
  shift_stamp        BOOLEAN NOT NULL DEFAULT FALSE,

  CONSTRAINT uq_str_aux_session UNIQUE (pair_base, pair_quote, window_key, app_session_id)
);

CREATE INDEX IF NOT EXISTS idx_str_aux_session_lookup
  ON strategy_aux.str_aux_session (pair_base, pair_quote, window_key, app_session_id);

-- Back/forward compatible guards (idempotent adds)
ALTER TABLE strategy_aux.str_aux_session
  ADD COLUMN IF NOT EXISTS above_count         INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS below_count         INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_swap_ms        BIGINT,
  ADD COLUMN IF NOT EXISTS last_swap_dir       SMALLINT,
  ADD COLUMN IF NOT EXISTS greatest_pct24h_abs DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shift_stamp         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gfm_delta_last      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gfm_calc_price_last NUMERIC,
  ADD COLUMN IF NOT EXISTS gfm_r_last          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS ui_epoch            INTEGER DEFAULT 0;

-- ===================================================================
-- Event log (opening | swap | shift)
-- ===================================================================
CREATE TABLE IF NOT EXISTS strategy_aux.str_aux_event (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES strategy_aux.str_aux_session(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,      -- 'opening' | 'swap' | 'shift'
  payload      JSONB,
  created_ms   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_str_aux_event_session
  ON strategy_aux.str_aux_event (session_id, created_ms DESC);
