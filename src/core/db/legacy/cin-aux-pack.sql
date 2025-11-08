-- ============================================================================
-- CIN-AUX PACK (Consolidated DDL + Functions + Views)
-- Generated: 2025-10-22 10:34:04 UTC
-- Notes:
--   * Safe to apply multiple times (idempotent guards included)
--   * Canonicalize on this pack to avoid drift/duplicates
-- ============================================================================

-- Ensure schema exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'strategy_aux') THEN
    EXECUTE 'CREATE SCHEMA strategy_aux';
  END IF;
END $$;

SET search_path = strategy_aux, public;

-- === CORE DDL (from 00_cin_aux_core.ddl.sql, possibly user-modified) ===
-- CryptoPi • CIN core DDL (clean)
-- Safe to run multiple times on PostgreSQL ≥ 13

-- 1) sessions
create table if not exists cin_session (
  session_id uuid primary key default uuid_generate_v4(),
  window_label text not null default '',
  window_bins int not null default 0,
  window_ms   bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) global coin universe (settings scope)
create table if not exists settings_coin_universe (
  symbol text primary key,
  meta jsonb not null default '{}'::jsonb,
  constraint symbol_upper check (symbol = upper(symbol))
);

-- 3) per-session snapshot of the universe (so calculations are reproducible)
create table if not exists session_coin_universe (
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  primary key (session_id, symbol)
);

-- 4) optional: combinations of coins for k-combos (if/when needed)
create table if not exists combo_set (
  combo_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  k int not null,               -- size of combo
  signature text not null,      -- e.g., 'BTCUSDT|ETHUSDT|SOLUSDT' (sorted)
  created_at timestamptz not null default now(),
  unique(session_id, signature)
);

create table if not exists combo_member (
  combo_id uuid not null references combo_set(combo_id) on delete cascade,
  position int not null,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  primary key (combo_id, position)
);

-- 5) generic matrices registry + cells
create table if not exists mat_registry (
  mat_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  name text not null,             -- 'id_pct', 'vTendency', 'MEA', etc.
  symbol text not null,           -- row anchor (or use '' for global)
  window_label text not null default '',
  bins int not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_matreg_session_name_sym on mat_registry(session_id, name, symbol);

create table if not exists mat_cell (
  cell_id uuid primary key default uuid_generate_v4(),
  mat_id uuid not null references mat_registry(mat_id) on delete cascade,
  i int not null,
  j int not null,
  v double precision not null,
  unique(mat_id, i, j)
);

-- 6) str-aux vectors
create table if not exists str_vectors (
  vectors_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  v_inner double precision not null default 0,
  v_outer double precision not null default 0,
  spread double precision not null default 0,
  v_tendency jsonb not null default '{"score":0,"direction":0,"strength":0,"slope":0,"r":0}',
  v_swap jsonb,
  summary jsonb not null default '{"scale":100,"bins":0,"samples":0,"inner":{"scaled":0,"unitless":0,"weightSum":0}}',
  created_at timestamptz not null default now()
);
create index if not exists idx_str_vectors_session_sym on str_vectors(session_id, symbol);

-- 7) mea outputs per symbol
create table if not exists mea_result (
  mea_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  value double precision not null,
  components jsonb not null,
  created_at timestamptz not null default now(),
  unique(session_id, symbol)
);
create index if not exists idx_mea_session_sym on mea_result(session_id, symbol);

-- 8) cin-aux ledger — a_ij grid (ai = coin, aj = profit/imprint/luggage) per session and cycle
create table if not exists cin_cycle (
  cycle_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  label text not null default '',
  created_at timestamptz not null default now()
);

-- columns j = profit, imprint, luggage
create type cin_metric as enum ('profit','imprint','luggage');

create table if not exists cin_ledger (
  entry_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  cycle_id uuid not null references cin_cycle(cycle_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  metric cin_metric not null,
  -- values are per (coin_i, metric_j)
  value double precision not null default 0,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(session_id, cycle_id, symbol, metric)
);

BEGIN;

-- 1) sessions
create table if not exists cin_session (
  session_id uuid primary key default uuid_generate_v4(),
  window_label text not null default '',
  window_bins int not null default 0,
  window_ms   bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) global coin universe (settings scope)
create table if not exists settings_coin_universe (
  symbol text primary key,
  meta jsonb not null default '{}'::jsonb,
  constraint symbol_upper check (symbol = upper(symbol))
);

-- 3) per-session snapshot of the universe (so calculations are reproducible)
create table if not exists session_coin_universe (
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  primary key (session_id, symbol)
);

-- 4) optional: combinations of coins for k-combos (if/when needed)
create table if not exists combo_set (
  combo_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  k int not null,               -- size of combo
  signature text not null,      -- e.g., 'BTCUSDT|ETHUSDT|SOLUSDT' (sorted)
  created_at timestamptz not null default now(),
  unique(session_id, signature)
);

create table if not exists combo_member (
  combo_id uuid not null references combo_set(combo_id) on delete cascade,
  position int not null,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  primary key (combo_id, position)
);

-- 5) generic matrices registry + cells
create table if not exists mat_registry (
  mat_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  name text not null,             -- 'id_pct', 'vTendency', 'MEA', etc.
  symbol text not null,           -- row anchor (or use '' for global)
  window_label text not null default '',
  bins int not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_matreg_session_name_sym on mat_registry(session_id, name, symbol);

create table if not exists mat_cell (
  cell_id uuid primary key default uuid_generate_v4(),
  mat_id uuid not null references mat_registry(mat_id) on delete cascade,
  i int not null,
  j int not null,
  v double precision not null,
  unique(mat_id, i, j)
);

-- 6) str-aux vectors
create table if not exists str_vectors (
  vectors_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  v_inner double precision not null default 0,
  v_outer double precision not null default 0,
  spread double precision not null default 0,
  v_tendency jsonb not null default '{"score":0,"direction":0,"strength":0,"slope":0,"r":0}',
  v_swap jsonb,
  summary jsonb not null default '{"scale":100,"bins":0,"samples":0,"inner":{"scaled":0,"unitless":0,"weightSum":0}}',
  created_at timestamptz not null default now()
);
create index if not exists idx_str_vectors_session_sym on str_vectors(session_id, symbol);

-- 7) mea outputs per symbol
create table if not exists mea_result (
  mea_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  value double precision not null,
  components jsonb not null,
  created_at timestamptz not null default now(),
  unique(session_id, symbol)
);
create index if not exists idx_mea_session_sym on mea_result(session_id, symbol);

-- 8) cin-aux ledger — a_ij grid (ai = coin, aj = profit/imprint/luggage) per session and cycle
create table if not exists cin_cycle (
  cycle_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  label text not null default '',
  created_at timestamptz not null default now()
);

-- columns j = profit, imprint, luggage
create type cin_metric as enum ('profit','imprint','luggage');

create table if not exists cin_ledger (
  entry_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  cycle_id uuid not null references cin_cycle(cycle_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  metric cin_metric not null,
  -- values are per (coin_i, metric_j)
  value double precision not null default 0,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(session_id, cycle_id, symbol, metric)
);

-- (optional) view: wide matrix-like pivot for the UI grid
create or replace view cin_grid_view as
select
  session_id, cycle_id, symbol,
  max(case when metric='profit'  then value end) as profit,
  max(case when metric='imprint' then value end) as imprint,
  max(case when metric='luggage' then value end) as luggage
from cin_ledger
group by session_id, cycle_id, symbol;





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


-- === FUNCTIONS (from 01_cin_aux_function.sql) ===
-- CryptoPi • CIN core functions (clean)

CREATE SCHEMA IF NOT EXISTS strategy_aux;

-- Ensure balance row
CREATE OR REPLACE FUNCTION strategy_aux.cin_ensure_balance_row(
  p_session_id BIGINT,
  p_asset_id   TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO strategy_aux.cin_balance(session_id, asset_id)
  VALUES (p_session_id, p_asset_id)
  ON CONFLICT (session_id, asset_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Register acquisition → creates a lot on destination
CREATE OR REPLACE FUNCTION strategy_aux.cin_register_acquisition(
  p_session_id BIGINT,
  p_move_id    BIGINT,
  p_asset_id   TEXT,
  p_units      NUMERIC,
  p_price_usdt NUMERIC
) RETURNS BIGINT AS $$
DECLARE v_lot_id BIGINT;
BEGIN
  INSERT INTO strategy_aux.cin_lot(session_id, asset_id, origin_move_id, p_in_usdt, units_total, units_free)
  VALUES (p_session_id, p_asset_id, p_move_id, p_price_usdt, p_units, p_units)
  RETURNING lot_id INTO v_lot_id;
  RETURN v_lot_id;
END;
$$ LANGUAGE plpgsql;

-- FIFO lot consumption (UNAMBIGUOUS + stable order)
CREATE OR REPLACE FUNCTION strategy_aux.cin_consume_fifo_lots(
  p_session_id BIGINT,
  p_asset_id   TEXT,
  p_units_need NUMERIC
) RETURNS TABLE (lot_id BIGINT, units_used NUMERIC, p_in_usdt NUMERIC) AS $$
DECLARE
  v_remain NUMERIC := p_units_need;
  v_use    NUMERIC;
  v_row    RECORD;
BEGIN
  FOR v_row IN
    SELECT l.lot_id, l.units_free, l.p_in_usdt
    FROM strategy_aux.cin_lot AS l
    WHERE l.session_id = p_session_id
      AND l.asset_id   = p_asset_id
      AND l.units_free > 0
    ORDER BY l.created_at, l.lot_id
  LOOP
    EXIT WHEN v_remain <= 0;

    v_use := LEAST(v_row.units_free, v_remain);

    UPDATE strategy_aux.cin_lot AS l
       SET units_free = l.units_free - v_use
     WHERE l.lot_id = v_row.lot_id;

    lot_id     := v_row.lot_id;
    units_used := v_use;
    p_in_usdt  := v_row.p_in_usdt;
    v_remain   := v_remain - v_use;

    RETURN NEXT;
  END LOOP;

  IF v_remain > 0 THEN
    RAISE EXCEPTION 'Not enough units in lots to consume: need %, short %',
      p_units_need, v_remain;
  END IF;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Execute move (v2): updates buckets, optional lot consumption, creates destination lot
CREATE OR REPLACE FUNCTION strategy_aux.cin_exec_move_v2(
  p_session_id        BIGINT,
  p_ts                TIMESTAMPTZ,
  p_from_asset        TEXT,
  p_to_asset          TEXT,
  p_executed_usdt     NUMERIC,
  p_fee_usdt          NUMERIC,
  p_slippage_usdt     NUMERIC,
  p_ref_usdt_target   NUMERIC,
  p_planned_usdt      NUMERIC,
  p_available_usdt    NUMERIC,
  p_price_from_usdt   NUMERIC,
  p_price_to_usdt     NUMERIC,
  p_price_bridge_usdt NUMERIC
) RETURNS BIGINT AS $$
DECLARE
  v_move_id       BIGINT;
  v_p_from        NUMERIC;
  v_r_from        NUMERIC;
  v_take_p        NUMERIC;
  v_take_r        NUMERIC;
  v_residual_after NUMERIC;
  v_dev_ref       NUMERIC;
  v_to_units      NUMERIC;
  v_units_needed  NUMERIC;
  v_weighted_pin  NUMERIC := 0;
  v_total_units   NUMERIC := 0;
  v_trace_usdt    NUMERIC := 0;
  v_profit_consumed NUMERIC := 0;
  v_principal_hit   NUMERIC := 0;
  rec RECORD;
BEGIN
  -- plan deviation
  v_dev_ref := p_executed_usdt
               - LEAST(COALESCE(p_ref_usdt_target, p_executed_usdt),
                       COALESCE(p_available_usdt,  p_executed_usdt));

  -- ensure balances exist
  PERFORM strategy_aux.cin_ensure_balance_row(p_session_id, p_from_asset);
  PERFORM strategy_aux.cin_ensure_balance_row(p_session_id, p_to_asset);

  -- read & lock source buckets
  SELECT principal_usdt, profit_usdt
    INTO v_p_from, v_r_from
  FROM strategy_aux.cin_balance
  WHERE session_id = p_session_id AND asset_id = p_from_asset
  FOR UPDATE;

  -- composition: principal first, then profit
  v_take_p := LEAST(p_executed_usdt, v_p_from);
  v_take_r := p_executed_usdt - v_take_p;

  -- fees on source (profit first, then principal)
  UPDATE strategy_aux.cin_balance
     SET principal_usdt = principal_usdt - v_take_p - GREATEST(p_fee_usdt - GREATEST(v_r_from - v_take_r, 0), 0),
         profit_usdt    = profit_usdt    - v_take_r - LEAST(p_fee_usdt, GREATEST(v_r_from - v_take_r, 0))
   WHERE session_id = p_session_id AND asset_id = p_from_asset;

  -- credit destination composition
  UPDATE strategy_aux.cin_balance
     SET principal_usdt = principal_usdt + v_take_p,
         profit_usdt    = profit_usdt    + v_take_r
   WHERE session_id = p_session_id AND asset_id = p_to_asset;

  -- residual after move (audit)
  SELECT principal_usdt + profit_usdt
    INTO v_residual_after
  FROM strategy_aux.cin_balance
  WHERE session_id = p_session_id AND asset_id = p_from_asset;

  -- destination units (optional)
  IF p_price_to_usdt IS NOT NULL AND p_price_to_usdt <> 0 THEN
    v_to_units := p_executed_usdt / p_price_to_usdt;
  END IF;

  -- lot consumption (guarded)
  IF p_price_bridge_usdt IS NOT NULL AND p_price_bridge_usdt <> 0 THEN
    v_units_needed := p_executed_usdt / p_price_bridge_usdt;

    IF EXISTS (
      SELECT 1 FROM strategy_aux.cin_lot
      WHERE session_id = p_session_id AND asset_id = p_from_asset AND units_free > 0
    ) THEN
      FOR rec IN
        SELECT * FROM strategy_aux.cin_consume_fifo_lots(p_session_id, p_from_asset, v_units_needed)
      LOOP
        v_total_units  := v_total_units + rec.units_used;
        v_weighted_pin := v_weighted_pin + rec.units_used * rec.p_in_usdt;

        INSERT INTO strategy_aux.cin_move_lotlink(move_id, lot_id, units_used, p_in_usdt)
        VALUES (NULL, rec.lot_id, rec.units_used, rec.p_in_usdt); -- temp NULL, patched after move insert
      END LOOP;

      IF v_total_units > 0 THEN
        v_weighted_pin := v_weighted_pin / v_total_units;
        v_trace_usdt   := p_executed_usdt - (v_total_units * v_weighted_pin);
        IF v_trace_usdt > 0 THEN
          v_profit_consumed := v_trace_usdt;
        ELSIF v_trace_usdt < 0 THEN
          v_principal_hit := -v_trace_usdt;
        END IF;
      END IF;
    END IF;
  END IF;

  -- write move
  INSERT INTO strategy_aux.cin_move (
    session_id, ts, from_asset, to_asset,
    executed_usdt, fee_usdt, slippage_usdt,
    ref_usdt_target, planned_usdt, dev_ref_usdt,
    comp_principal_usdt, comp_profit_usdt,
    p_bridge_in_usdt, p_bridge_out_usdt, lot_units_used, trace_usdt,
    profit_consumed_usdt, principal_hit_usdt,
    to_units_received, residual_from_after
  ) VALUES (
    p_session_id, p_ts, p_from_asset, p_to_asset,
    p_executed_usdt, p_fee_usdt, p_slippage_usdt,
    p_ref_usdt_target, p_planned_usdt, v_dev_ref,
    v_take_p, v_take_r,
    CASE WHEN v_total_units > 0 THEN v_weighted_pin ELSE NULL END,
    p_price_bridge_usdt, v_total_units, COALESCE(v_trace_usdt,0),
    COALESCE(v_profit_consumed,0), COALESCE(v_principal_hit,0),
    v_to_units, v_residual_after
  ) RETURNING move_id INTO v_move_id;

  -- patch temporary lotlinks
  UPDATE strategy_aux.cin_move_lotlink
     SET move_id = v_move_id
   WHERE move_id IS NULL;

  -- create destination lot
  IF v_to_units IS NOT NULL AND v_to_units > 0 AND p_price_to_usdt IS NOT NULL THEN
    PERFORM strategy_aux.cin_register_acquisition(p_session_id, v_move_id, p_to_asset, v_to_units, p_price_to_usdt);
  END IF;

  RETURN v_move_id;
END;
$$ LANGUAGE plpgsql;

-- Add mark
CREATE OR REPLACE FUNCTION strategy_aux.cin_add_mark(
  p_session_id BIGINT,
  p_asset_id   TEXT,
  p_ts         TIMESTAMPTZ,
  p_bulk_usdt  NUMERIC
) RETURNS VOID AS $$
BEGIN
  INSERT INTO strategy_aux.cin_mark(session_id, asset_id, ts, bulk_usdt)
  VALUES (p_session_id, p_asset_id, p_ts, p_bulk_usdt)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Close session (rollup)
CREATE OR REPLACE FUNCTION strategy_aux.cin_close_session_v2(
  p_session_id BIGINT
) RETURNS VOID AS $$
BEGIN
  UPDATE strategy_aux.cin_balance b
     SET closing_principal = b.principal_usdt,
         closing_profit    = m.bulk_usdt - b.principal_usdt
  FROM (
    SELECT DISTINCT ON (asset_id) asset_id, bulk_usdt
    FROM strategy_aux.cin_mark
    WHERE session_id = p_session_id
    ORDER BY asset_id, ts DESC
  ) m
  WHERE b.session_id = p_session_id AND b.asset_id = m.asset_id;

  INSERT INTO strategy_aux.cin_imprint_luggage(
    session_id,
    imprint_principal_churn_usdt,
    imprint_profit_churn_usdt,
    imprint_generated_profit_usdt,
    imprint_trace_sum_usdt,
    imprint_devref_sum_usdt,
    luggage_total_principal_usdt,
    luggage_total_profit_usdt
  )
  SELECT
    p_session_id,
    COALESCE((SELECT SUM(comp_principal_usdt) FROM strategy_aux.cin_move WHERE session_id = p_session_id),0),
    COALESCE((SELECT SUM(comp_profit_usdt)    FROM strategy_aux.cin_move WHERE session_id = p_session_id),0),
    (SELECT COALESCE(SUM(closing_profit),0)   FROM strategy_aux.cin_balance WHERE session_id = p_session_id)
      - (SELECT COALESCE(SUM(opening_profit),0) FROM strategy_aux.cin_balance WHERE session_id = p_session_id)
      - COALESCE((SELECT SUM(fee_usdt + slippage_usdt) FROM strategy_aux.cin_move WHERE session_id = p_session_id),0),
    COALESCE((SELECT SUM(trace_usdt)   FROM strategy_aux.cin_move WHERE session_id = p_session_id),0),
    COALESCE((SELECT SUM(dev_ref_usdt) FROM strategy_aux.cin_move WHERE session_id = p_session_id),0),
    COALESCE((SELECT SUM(closing_principal) FROM strategy_aux.cin_balance WHERE session_id = p_session_id),0),
    COALESCE((SELECT SUM(closing_profit)    FROM strategy_aux.cin_balance WHERE session_id = p_session_id),0)
  ON CONFLICT (session_id) DO UPDATE
  SET imprint_principal_churn_usdt = EXCLUDED.imprint_principal_churn_usdt,
      imprint_profit_churn_usdt    = EXCLUDED.imprint_profit_churn_usdt,
      imprint_generated_profit_usdt= EXCLUDED.imprint_generated_profit_usdt,
      imprint_trace_sum_usdt       = EXCLUDED.imprint_trace_sum_usdt,
      imprint_devref_sum_usdt      = EXCLUDED.imprint_devref_sum_usdt,
      luggage_total_principal_usdt = EXCLUDED.luggage_total_principal_usdt,
      luggage_total_profit_usdt    = EXCLUDED.luggage_total_profit_usdt;

  UPDATE strategy_aux.cin_session
     SET ended_at = COALESCE(ended_at, now()),
         closed   = TRUE
   WHERE session_id = p_session_id;
END;
$$ LANGUAGE plpgsql;


-- === PATCH ADDITIONS (constraints, indexes, views) ===

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


-- ============================================================================
-- End of CIN-AUX PACK (generated 2025-10-22 10:34:04 UTC)
-- ============================================================================

ALTER TABLE strategy_aux.cin_session
  ALTER COLUMN window_label SET DEFAULT '1h';

UPDATE strategy_aux.cin_session
   SET window_label = '1h'
 WHERE window_label IS NULL;

-- ============================================================================
-- DB: Tables + Seed (SQL)
-- ============================================================================

-- 1. price deltas per pair per tick
CREATE TABLE IF NOT EXISTS id_pct_pairs (
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  id_pct DOUBLE PRECISION NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (base, quote, ts_epoch_ms)
);

-- 2. latest snapshot view (fast lookup for the API)
CREATE OR REPLACE VIEW id_pct_latest AS
SELECT DISTINCT ON (base, quote)
  base, quote, id_pct, ts_epoch_ms
FROM id_pct_pairs
ORDER BY base, quote, ts_epoch_ms DESC;

-- 3. generic metrics (store matrices, vectors, etc.)
CREATE TABLE IF NOT EXISTS metrics (
  metric_key TEXT NOT NULL,          -- e.g. 'pct24h:BTC|USDT', 'vector:BTC', 'benchmark:total'
  value DOUBLE PRECISION NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (metric_key, ts_epoch_ms)
);

-- 4. balances (historical) and latest shortcut
CREATE TABLE IF NOT EXISTS balances (
  asset TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (asset, ts_epoch_ms)
);

CREATE OR REPLACE VIEW wallet_balances_latest AS
SELECT DISTINCT ON (asset) asset, amount, ts_epoch_ms
FROM balances
ORDER BY asset, ts_epoch_ms DESC;

-- 5. OPTIONAL: availability snapshot (if you don’t already have it)
CREATE TABLE IF NOT EXISTS pair_availability (
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  tradable BOOLEAN NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (base, quote, ts_epoch_ms)
);

-- ─── Seed minimal data ─────────────────────────────────────────────
-- balances
INSERT INTO balances (asset, amount, ts_epoch_ms) VALUES
  ('USDT', 10000, extract(epoch from now())*1000),
  ('BTC',     1.2, extract(epoch from now())*1000),
  ('ETH',    12.5, extract(epoch from now())*1000),
  ('SOL',   350.0, extract(epoch from now())*1000)
ON CONFLICT DO NOTHING;

-- a few id_pct pairs (dummy % deltas)
WITH now_ms AS (
  SELECT (extract(epoch from now())*1000)::BIGINT AS t
)
INSERT INTO id_pct_pairs (base, quote, id_pct, ts_epoch_ms)
SELECT * FROM (
  SELECT 'BTC','USDT',  0.9,  (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','USDT',  0.6,  (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','USDT',  1.1,  (SELECT t FROM now_ms) UNION ALL
  SELECT 'BTC','ETH',   0.3,  (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','BTC',  -0.4,  (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','BTC',   1.2,  (SELECT t FROM now_ms) UNION ALL
  SELECT 'BTC','SOL',   0.8,  (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','SOL',   0.2,  (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','ETH',  -0.1,  (SELECT t FROM now_ms)
) s
ON CONFLICT DO NOTHING;

-- availability (optional)
WITH now_ms AS (
  SELECT (extract(epoch from now())*1000)::BIGINT AS t
)
INSERT INTO pair_availability (base, quote, tradable, ts_epoch_ms)
SELECT * FROM (
  SELECT 'BTC','USDT', true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','USDT', true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','USDT', true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'BTC','ETH',  true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','BTC',  true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','BTC',  true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'BTC','SOL',  true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','SOL',  true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','ETH',  true, (SELECT t FROM now_ms)
) s
ON CONFLICT DO NOTHING;


-- ops requests (app wants to place/cancel)
create type ops_side as enum ('buy','sell');
create type ops_status as enum ('requested','placed','rejected','filled','cancelled','expired');

create table if not exists ops_order (
  order_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol),
  side ops_side not null,
  qty numeric(36,18) not null,
  px  numeric(36,18),              -- nullable for market
  kind text not null default 'market', -- 'market'|'limit'|...
  status ops_status not null default 'requested',
  paper bool not null default true,    -- true = simulate
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- fills (even paper trading emits fills)
create table if not exists ops_fill (
  fill_id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references ops_order(order_id) on delete cascade,
  symbol text not null,
  qty  numeric(36,18) not null,
  px   numeric(36,18) not null,
  fee  numeric(36,18) not null default 0,
  created_at timestamptz not null default now()
);

-- cycles
create table if not exists cin_cycle (
  cycle_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  label text not null default '',
  created_at timestamptz not null default now()
);

-- ledger (a_ij grid: j in {profit,imprint,luggage})
create type if not exists cin_metric as enum ('profit','imprint','luggage');

create table if not exists cin_ledger (
  entry_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  cycle_id uuid not null references cin_cycle(cycle_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  metric cin_metric not null,
  value double precision not null default 0,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(session_id, cycle_id, symbol, metric)
);

create or replace view cin_grid_view as
select
  session_id, cycle_id, symbol,
  max(case when metric='profit'  then value end) as profit,
  max(case when metric='imprint' then value end) as imprint,
  max(case when metric='luggage' then value end) as luggage
from cin_ledger
group by session_id, cycle_id, symbol;

-- ops (market operations: paper/live)
create type if not exists ops_side as enum ('buy','sell');
create type if not exists ops_status as enum ('requested','placed','rejected','filled','cancelled','expired');

create table if not exists ops_order (
  order_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol),
  side ops_side not null,
  qty numeric(36,18) not null,
  px  numeric(36,18),
  kind text not null default 'market',
  status ops_status not null default 'requested',
  paper bool not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ops_fill (
  fill_id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references ops_order(order_id) on delete cascade,
  symbol text not null,
  qty  numeric(36,18) not null,
  px   numeric(36,18) not null,
  fee  numeric(36,18) not null default 0,
  created_at timestamptz not null default now()
);
