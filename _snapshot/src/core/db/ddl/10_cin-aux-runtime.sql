BEGIN;
-- Runtime trade ledger (BIGINT session lineage per prior strategy_aux)
CREATE TABLE IF NOT EXISTS cin_aux.rt_session (
  session_id   BIGSERIAL PRIMARY KEY,
  window_label TEXT NOT NULL DEFAULT '1h',
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  closed       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS cin_aux.rt_balance (
  session_id        BIGINT NOT NULL REFERENCES cin_aux.rt_session(session_id) ON DELETE CASCADE,
  asset_id          TEXT   NOT NULL,
  opening_principal NUMERIC NOT NULL DEFAULT 0,
  opening_profit    NUMERIC NOT NULL DEFAULT 0,
  principal_usdt    NUMERIC NOT NULL DEFAULT 0,
  profit_usdt       NUMERIC NOT NULL DEFAULT 0,
  closing_principal NUMERIC,
  closing_profit    NUMERIC,
  PRIMARY KEY (session_id, asset_id)
);

CREATE TABLE IF NOT EXISTS cin_aux.rt_reference (
  session_id  BIGINT NOT NULL REFERENCES cin_aux.rt_session(session_id) ON DELETE CASCADE,
  asset_id    TEXT   NOT NULL,
  ref_usdt    NUMERIC NOT NULL,
  source_tag  TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, asset_id)
);

CREATE TABLE IF NOT EXISTS cin_aux.rt_lot (
  lot_id      BIGSERIAL PRIMARY KEY,
  session_id  BIGINT NOT NULL REFERENCES cin_aux.rt_session(session_id) ON DELETE CASCADE,
  asset_id    TEXT   NOT NULL,
  origin_move_id BIGINT,
  p_in_usdt   NUMERIC NOT NULL,
  units_total NUMERIC NOT NULL,
  units_free  NUMERIC NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rt_lot_nonneg CHECK (units_free >= 0 AND units_total >= 0 AND units_free <= units_total)
);

CREATE TABLE IF NOT EXISTS cin_aux.rt_move (
  move_id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES cin_aux.rt_session(session_id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_asset TEXT NOT NULL,
  to_asset   TEXT NOT NULL,
  executed_usdt NUMERIC NOT NULL,
  fee_usdt      NUMERIC NOT NULL DEFAULT 0,
  slippage_usdt NUMERIC NOT NULL DEFAULT 0,
  ref_usdt_target NUMERIC,
  planned_usdt    NUMERIC,
  dev_ref_usdt    NUMERIC,
  comp_principal_usdt NUMERIC NOT NULL DEFAULT 0,
  comp_profit_usdt    NUMERIC NOT NULL DEFAULT 0,
  p_bridge_in_usdt    NUMERIC,
  p_bridge_out_usdt   NUMERIC,
  lot_units_used      NUMERIC,
  trace_usdt          NUMERIC NOT NULL DEFAULT 0,
  profit_consumed_usdt NUMERIC NOT NULL DEFAULT 0,
  principal_hit_usdt   NUMERIC NOT NULL DEFAULT 0,
  to_units_received    NUMERIC,
  residual_from_after  NUMERIC,
  notes                TEXT
);
CREATE INDEX IF NOT EXISTS idx_rt_move_session_ts ON cin_aux.rt_move(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_rt_move_from ON cin_aux.rt_move(session_id, from_asset, ts DESC);
CREATE INDEX IF NOT EXISTS idx_rt_move_to   ON cin_aux.rt_move(session_id, to_asset, ts DESC);

CREATE TABLE IF NOT EXISTS cin_aux.rt_move_lotlink (
  move_id BIGINT NOT NULL REFERENCES cin_aux.rt_move(move_id) ON DELETE CASCADE,
  lot_id  BIGINT NOT NULL REFERENCES cin_aux.rt_lot(lot_id)   ON DELETE RESTRICT,
  units_used NUMERIC NOT NULL,
  p_in_usdt  NUMERIC NOT NULL,
  PRIMARY KEY (move_id, lot_id)
);

CREATE TABLE IF NOT EXISTS cin_aux.rt_mark (
  session_id BIGINT NOT NULL REFERENCES cin_aux.rt_session(session_id) ON DELETE CASCADE,
  asset_id   TEXT   NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  price_usdt NUMERIC,
  bulk_usdt  NUMERIC NOT NULL,
  PRIMARY KEY (session_id, asset_id, ts)
);

CREATE TABLE IF NOT EXISTS cin_aux.rt_imprint_luggage (
  session_id BIGINT PRIMARY KEY REFERENCES cin_aux.rt_session(session_id) ON DELETE CASCADE,
  imprint_principal_churn_usdt  NUMERIC NOT NULL,
  imprint_profit_churn_usdt     NUMERIC NOT NULL,
  imprint_generated_profit_usdt NUMERIC NOT NULL,
  imprint_trace_sum_usdt        NUMERIC NOT NULL,
  imprint_devref_sum_usdt       NUMERIC NOT NULL,
  luggage_total_principal_usdt  NUMERIC NOT NULL,
  luggage_total_profit_usdt     NUMERIC NOT NULL
);


-- Add stamps to runtime heads
ALTER TABLE cin_aux.rt_session
ADD COLUMN IF NOT EXISTS opening_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS opening_session_id uuid,
ADD COLUMN IF NOT EXISTS opening_ts timestamptz,
ADD COLUMN IF NOT EXISTS print_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS print_ts timestamptz;


ALTER TABLE cin_aux.rt_balance
ADD COLUMN IF NOT EXISTS opening_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS opening_session_id uuid,
ADD COLUMN IF NOT EXISTS opening_ts timestamptz,
ADD COLUMN IF NOT EXISTS print_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS print_ts timestamptz;


ALTER TABLE cin_aux.rt_move
ADD COLUMN IF NOT EXISTS opening_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS opening_session_id uuid,
ADD COLUMN IF NOT EXISTS opening_ts timestamptz,
ADD COLUMN IF NOT EXISTS print_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS print_ts timestamptz;


ALTER TABLE cin_aux.rt_lot
ADD COLUMN IF NOT EXISTS opening_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS opening_session_id uuid,
ADD COLUMN IF NOT EXISTS opening_ts timestamptz,
ADD COLUMN IF NOT EXISTS print_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS print_ts timestamptz;


ALTER TABLE cin_aux.rt_mark
ADD COLUMN IF NOT EXISTS opening_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS opening_session_id uuid,
ADD COLUMN IF NOT EXISTS opening_ts timestamptz,
ADD COLUMN IF NOT EXISTS print_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS print_ts timestamptz;


ALTER TABLE cin_aux.rt_imprint_luggage
ADD COLUMN IF NOT EXISTS opening_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS opening_session_id uuid,
ADD COLUMN IF NOT EXISTS opening_ts timestamptz,
ADD COLUMN IF NOT EXISTS print_stamp boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS print_ts timestamptz;
COMMIT;
