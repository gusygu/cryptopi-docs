-- CryptoPi • CIN core DDL (clean)
-- Safe to run multiple times on PostgreSQL ≥ 13

BEGIN;

CREATE SCHEMA IF NOT EXISTS strategy_aux;

-- Sessions
CREATE TABLE IF NOT EXISTS strategy_aux.cin_session (
  session_id   BIGSERIAL PRIMARY KEY,
  window_label TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  closed       BOOLEAN NOT NULL DEFAULT FALSE
);

-- Buckets per asset
CREATE TABLE IF NOT EXISTS strategy_aux.cin_balance (
  session_id        BIGINT NOT NULL REFERENCES strategy_aux.cin_session(session_id) ON DELETE CASCADE,
  asset_id          TEXT   NOT NULL,
  opening_principal NUMERIC NOT NULL DEFAULT 0,
  opening_profit    NUMERIC NOT NULL DEFAULT 0,
  principal_usdt    NUMERIC NOT NULL DEFAULT 0,
  profit_usdt       NUMERIC NOT NULL DEFAULT 0,
  closing_principal NUMERIC,
  closing_profit    NUMERIC,
  PRIMARY KEY (session_id, asset_id)
);

-- Reference (target allocation)
CREATE TABLE IF NOT EXISTS strategy_aux.cin_reference (
  session_id  BIGINT NOT NULL REFERENCES strategy_aux.cin_session(session_id) ON DELETE CASCADE,
  asset_id    TEXT   NOT NULL,
  ref_usdt    NUMERIC NOT NULL,
  source_tag  TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, asset_id)
);

-- Acquisition lots
CREATE TABLE IF NOT EXISTS strategy_aux.cin_lot (
  lot_id         BIGSERIAL PRIMARY KEY,
  session_id     BIGINT NOT NULL REFERENCES strategy_aux.cin_session(session_id) ON DELETE CASCADE,
  asset_id       TEXT   NOT NULL,
  origin_move_id BIGINT,
  p_in_usdt      NUMERIC NOT NULL,
  units_total    NUMERIC NOT NULL,
  units_free     NUMERIC NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cin_lot_nonneg CHECK (units_free >= 0)
);

-- Moves
CREATE TABLE IF NOT EXISTS strategy_aux.cin_move (
  move_id              BIGSERIAL PRIMARY KEY,
  session_id           BIGINT NOT NULL REFERENCES strategy_aux.cin_session(session_id) ON DELETE CASCADE,
  ts                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_asset           TEXT NOT NULL,
  to_asset             TEXT NOT NULL,
  executed_usdt        NUMERIC NOT NULL,
  fee_usdt             NUMERIC NOT NULL DEFAULT 0,
  slippage_usdt        NUMERIC NOT NULL DEFAULT 0,
  -- planning
  ref_usdt_target      NUMERIC,
  planned_usdt         NUMERIC,
  dev_ref_usdt         NUMERIC,
  -- composition snapshot
  comp_principal_usdt  NUMERIC NOT NULL DEFAULT 0,
  comp_profit_usdt     NUMERIC NOT NULL DEFAULT 0,
  -- lot consumption summary
  p_bridge_in_usdt     NUMERIC,
  p_bridge_out_usdt    NUMERIC,
  lot_units_used       NUMERIC,
  trace_usdt           NUMERIC NOT NULL DEFAULT 0,
  profit_consumed_usdt NUMERIC NOT NULL DEFAULT 0,
  principal_hit_usdt   NUMERIC NOT NULL DEFAULT 0,
  -- destination fill
  to_units_received    NUMERIC,
  -- audit
  residual_from_after  NUMERIC,
  notes                TEXT
);

-- Lot links per move (when consumption spans multiple lots)
CREATE TABLE IF NOT EXISTS strategy_aux.cin_move_lotlink (
  move_id    BIGINT NOT NULL REFERENCES strategy_aux.cin_move(move_id) ON DELETE CASCADE,
  lot_id     BIGINT NOT NULL REFERENCES strategy_aux.cin_lot(lot_id)  ON DELETE RESTRICT,
  units_used NUMERIC NOT NULL,
  p_in_usdt  NUMERIC NOT NULL,
  PRIMARY KEY (move_id, lot_id)
);

-- Price/bulk marks
CREATE TABLE IF NOT EXISTS strategy_aux.cin_mark (
  session_id BIGINT NOT NULL REFERENCES strategy_aux.cin_session(session_id) ON DELETE CASCADE,
  asset_id   TEXT   NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  price_usdt NUMERIC,
  bulk_usdt  NUMERIC NOT NULL,
  PRIMARY KEY (session_id, asset_id, ts)
);

-- Close rollup
CREATE TABLE IF NOT EXISTS strategy_aux.cin_imprint_luggage (
  session_id                       BIGINT PRIMARY KEY REFERENCES strategy_aux.cin_session(session_id) ON DELETE CASCADE,
  imprint_principal_churn_usdt     NUMERIC NOT NULL,
  imprint_profit_churn_usdt        NUMERIC NOT NULL,
  imprint_generated_profit_usdt    NUMERIC NOT NULL,
  imprint_trace_sum_usdt           NUMERIC NOT NULL,
  imprint_devref_sum_usdt          NUMERIC NOT NULL,
  luggage_total_principal_usdt     NUMERIC NOT NULL,
  luggage_total_profit_usdt        NUMERIC NOT NULL
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_cin_move_session_ts      ON strategy_aux.cin_move(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_cin_lot_session_asset    ON strategy_aux.cin_lot(session_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_cin_mark_session_asset_ts ON strategy_aux.cin_mark(session_id, asset_id, ts);

COMMIT;
