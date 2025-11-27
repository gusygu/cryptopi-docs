-- Views for cin-aux runtime analytics and moo alignment.

-- ensure rt_move has provenance columns before views reference them
ALTER TABLE IF EXISTS cin_aux.rt_move
  ADD COLUMN IF NOT EXISTS src_symbol text,
  ADD COLUMN IF NOT EXISTS src_trade_id bigint,
  ADD COLUMN IF NOT EXISTS src_side text;

ALTER TABLE IF EXISTS cin_aux.rt_move
  ADD COLUMN IF NOT EXISTS from_units numeric;

------------------------------------------------------------
-- 1) Runtime session summary
------------------------------------------------------------

CREATE OR REPLACE VIEW cin_aux.v_rt_session_summary AS
SELECT
  s.session_id,
  s.window_label,
  s.started_at,
  s.ended_at,
  s.closed,
  il.imprint_principal_churn_usdt,
  il.imprint_profit_churn_usdt,
  il.imprint_generated_profit_usdt,
  il.imprint_trace_sum_usdt,
  il.imprint_devref_sum_usdt,
  il.luggage_total_principal_usdt,
  il.luggage_total_profit_usdt
FROM cin_aux.rt_session s
LEFT JOIN cin_aux.rt_imprint_luggage il
  ON il.session_id = s.session_id;

------------------------------------------------------------
-- 2) Per-asset PnL + last mark
------------------------------------------------------------

CREATE OR REPLACE VIEW cin_aux.v_rt_asset_pnl AS
WITH latest_mark AS (
  SELECT DISTINCT ON (session_id, asset_id)
    session_id,
    asset_id,
    ts,
    price_usdt,
    bulk_usdt
  FROM cin_aux.rt_mark
  ORDER BY session_id, asset_id, ts DESC
)
SELECT
  b.session_id,
  b.asset_id,
  b.opening_principal,
  b.opening_profit,
  b.principal_usdt,
  b.profit_usdt,
  lm.ts AS last_mark_ts,
  lm.price_usdt AS price_usdt,
  COALESCE(lm.bulk_usdt, 0) AS bulk_usdt,
  (b.principal_usdt + b.profit_usdt) AS mtm_value_usdt
FROM cin_aux.rt_balance b
LEFT JOIN latest_mark lm
  ON lm.session_id = b.session_id
 AND lm.asset_id   = b.asset_id;

------------------------------------------------------------
-- 3) Reconciliation: cin vs binance reference
------------------------------------------------------------

CREATE OR REPLACE VIEW cin_aux.v_rt_session_recon AS
WITH asset_pnl AS (
  SELECT
    session_id,
    SUM(mtm_value_usdt) AS cin_total_mtm_usdt
  FROM cin_aux.v_rt_asset_pnl
  GROUP BY session_id
),
ref_total AS (
  SELECT
    session_id,
    SUM(ref_usdt) AS ref_total_usdt
  FROM cin_aux.rt_reference
  GROUP BY session_id
)
SELECT
  s.session_id,
  s.window_label,
  s.started_at,
  s.ended_at,
  a.cin_total_mtm_usdt,
  r.ref_total_usdt,
  (a.cin_total_mtm_usdt - r.ref_total_usdt) AS delta_usdt,
  CASE
    WHEN r.ref_total_usdt = 0 OR r.ref_total_usdt IS NULL THEN NULL
    ELSE (a.cin_total_mtm_usdt - r.ref_total_usdt) / r.ref_total_usdt
  END AS delta_ratio
FROM cin_aux.rt_session s
LEFT JOIN asset_pnl a ON a.session_id = s.session_id
LEFT JOIN ref_total r ON r.session_id = s.session_id;

------------------------------------------------------------
-- 4) Derived move PnL view
------------------------------------------------------------

DROP VIEW IF EXISTS cin_aux.v_rt_move_pnl;
CREATE OR REPLACE VIEW cin_aux.v_rt_move_pnl AS
SELECT
  m.move_id,
  m.session_id,
  m.ts,
  m.from_asset,
  m.to_asset,
  m.executed_usdt,
  m.fee_usdt,
  m.slippage_usdt,
  m.ref_usdt_target,
  m.planned_usdt,
  m.dev_ref_usdt,
  m.comp_principal_usdt,
  m.comp_profit_usdt,
  m.p_bridge_in_usdt,
  m.p_bridge_out_usdt,
  m.from_units,
  m.lot_units_used,
  m.trace_usdt,
  m.profit_consumed_usdt,
  m.principal_hit_usdt,
  m.to_units_received,
  m.residual_from_after,
  m.notes,
  m.comp_profit_usdt AS pnl_for_move_usdt,
  CASE
    WHEN m.executed_usdt = 0 THEN NULL
    ELSE m.fee_usdt / m.executed_usdt
  END AS fee_rate,
  m.src_symbol,
  m.src_trade_id,
  m.src_side
FROM cin_aux.rt_move m;

CREATE OR REPLACE VIEW cin_aux.v_rt_asset_tau AS
SELECT
  session_id,
  to_asset AS asset_id,
  SUM(comp_profit_usdt - profit_consumed_usdt) AS imprint_usdt,
  SUM(fee_usdt + slippage_usdt + trace_usdt + principal_hit_usdt) AS luggage_usdt
FROM cin_aux.rt_move
GROUP BY session_id, to_asset;

------------------------------------------------------------
-- 5) Moo alignment view + link table
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cin_aux.session_link (
  cin_session_id uuid PRIMARY KEY
    REFERENCES cin_aux.sessions(session_id) ON DELETE CASCADE,
  rt_session_id bigint NOT NULL
    REFERENCES cin_aux.rt_session(session_id) ON DELETE CASCADE
);

CREATE OR REPLACE VIEW cin_aux.v_mea_alignment AS
SELECT
  sl.cin_session_id AS mea_session_uuid,
  sl.rt_session_id,
  mr.symbol,
  mr.value AS mea_value,
  mr.components,
  ap.mtm_value_usdt AS actual_luggage_usdt
FROM cin_aux.session_link sl
JOIN cin_aux.mea_result mr
  ON mr.session_id = sl.cin_session_id
LEFT JOIN cin_aux.v_rt_asset_pnl ap
  ON ap.session_id = sl.rt_session_id
 AND ap.asset_id   = mr.symbol;

CREATE OR REPLACE VIEW cin_aux.v_mea_alignment_scored AS
WITH base AS (
  SELECT
    mea_session_uuid,
    rt_session_id,
    symbol,
    mea_value,
    actual_luggage_usdt,
    SUM(mea_value) OVER (PARTITION BY mea_session_uuid) AS total_mea,
    SUM(actual_luggage_usdt) OVER (PARTITION BY mea_session_uuid) AS total_actual
  FROM cin_aux.v_mea_alignment
)
SELECT
  mea_session_uuid,
  rt_session_id,
  symbol,
  mea_value,
  actual_luggage_usdt,

  /* Normalized suggested weight */
  CASE 
    WHEN total_mea = 0 THEN NULL
    ELSE mea_value / total_mea
  END AS suggested_weight,

  /* Normalized actual weight */
  CASE 
    WHEN total_actual = 0 THEN NULL
    ELSE actual_luggage_usdt / total_actual
  END AS actual_weight,

  /* Difference */
  CASE 
    WHEN total_mea = 0 OR total_actual = 0 THEN NULL
    ELSE (actual_luggage_usdt / total_actual) - (mea_value / total_mea)
  END AS weight_delta,

  ABS(
    CASE 
      WHEN total_mea = 0 OR total_actual = 0 THEN NULL
      ELSE (actual_luggage_usdt / total_actual) - (mea_value / total_mea)
    END
  ) AS abs_delta,

  /* Severity levels */
  CASE
    WHEN total_mea = 0 OR total_actual = 0 THEN 'none'
    WHEN ABS((actual_luggage_usdt / total_actual) - (mea_value / total_mea)) < 0.01 THEN 'green'
    WHEN ABS((actual_luggage_usdt / total_actual) - (mea_value / total_mea)) < 0.05 THEN 'yellow'
    ELSE 'red'
  END AS severity_level,

  /* alignment score 0–100 */
  GREATEST(
    0,
    LEAST(
      100,
      100 - (ABS(
        CASE 
          WHEN total_mea = 0 OR total_actual = 0 THEN 0
          ELSE (actual_luggage_usdt / total_actual) - (mea_value / total_mea)
        END
      ) * 100 * 2)
    )
  ) AS alignment_score,

  /* Rebalance trigger */
  CASE 
    WHEN ABS(
      CASE 
        WHEN total_mea = 0 OR total_actual = 0 THEN 0
        ELSE (actual_luggage_usdt / total_actual) - (mea_value / total_mea)
      END
    ) > 0.03
    THEN TRUE
    ELSE FALSE
  END AS need_rebalance

FROM base;

------------------------------------------------------------
-- 6) rt_session extra fields
------------------------------------------------------------

ALTER TABLE cin_aux.rt_session
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_closed boolean NOT NULL DEFAULT false;

------------------------------------------------------------
-- 7) Raw account trades table (+ idempotent index)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS market.account_trades (
  symbol           text        NOT NULL,
  trade_id         bigint      NOT NULL,
  order_id         bigint,
  price            numeric     NOT NULL,
  qty              numeric     NOT NULL,
  quote_qty        numeric     NOT NULL,
  commission       numeric,
  commission_asset text,
  trade_time       timestamptz NOT NULL,
  is_buyer         boolean,
  is_maker         boolean,
  is_best_match    boolean,
  raw              jsonb       NOT NULL,
  PRIMARY KEY (symbol, trade_id)
);

CREATE INDEX IF NOT EXISTS account_trades_symbol_time_idx
  ON market.account_trades (symbol, trade_time);

