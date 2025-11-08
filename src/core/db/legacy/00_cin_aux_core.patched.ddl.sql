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

-- ============================================================================
-- CIN-AUX PATCH ADDITIONS  (generated 2025-10-22 10:34:04 UTC)
-- - Constraints for non-negative sums and units
-- - Helpful indexes for common lookups
-- - Reporting views for hydration (moves + session rollup)
-- ============================================================================

-- SAFETY: ensure schema exists (no-op if already present)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'strategy_aux') THEN
    EXECUTE 'CREATE SCHEMA strategy_aux';
  END IF;
END $$;

-- ---------- Constraints ----------
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'strategy_aux' AND table_name = 'cin_move'
  ) THEN
    BEGIN
      ALTER TABLE strategy_aux.cin_move
        ADD CONSTRAINT chk_cin_move_comp_sum_nonneg
        CHECK (comp_principal_usdt >= 0 AND comp_profit_usdt >= 0);
    EXCEPTION WHEN duplicate_object THEN
      -- constraint already exists
      NULL;
    END;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'strategy_aux' AND table_name = 'cin_lot'
  ) THEN
    BEGIN
      ALTER TABLE strategy_aux.cin_lot
        ADD CONSTRAINT chk_cin_lot_units
        CHECK (units_total >= 0 AND units_free >= 0 AND units_free <= units_total);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

-- ---------- Indexes ----------
CREATE INDEX IF NOT EXISTS idx_cin_move_session_from_ts
  ON strategy_aux.cin_move (session_id, from_asset, ts DESC);

CREATE INDEX IF NOT EXISTS idx_cin_move_session_to_ts
  ON strategy_aux.cin_move (session_id, to_asset, ts DESC);

CREATE INDEX IF NOT EXISTS idx_cin_move_lotlink_lot
  ON strategy_aux.cin_move_lotlink (lot_id);

-- ---------- Views ----------
CREATE OR REPLACE VIEW strategy_aux.v_cin_move_attrib AS
SELECT m.move_id, m.session_id, m.ts, m.from_asset, m.to_asset,
       m.executed_usdt, m.fee_usdt, m.slippage_usdt,
       m.comp_principal_usdt, m.comp_profit_usdt,
       m.trace_usdt, m.profit_consumed_usdt, m.principal_hit_usdt,
       m.dev_ref_usdt, m.p_bridge_in_usdt, m.p_bridge_out_usdt, m.lot_units_used
FROM strategy_aux.cin_move m
ORDER BY m.session_id, m.ts;

CREATE OR REPLACE VIEW strategy_aux.v_cin_session_rollup AS
SELECT b.session_id,
       SUM(b.opening_principal) AS opening_principal_usdt,
       SUM(b.opening_profit)    AS opening_profit_usdt,
       SUM(b.closing_principal) AS closing_principal_usdt,
       SUM(b.closing_profit)    AS closing_profit_usdt
FROM strategy_aux.cin_balance b
GROUP BY b.session_id;
