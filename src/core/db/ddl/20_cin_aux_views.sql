-- 20_cin_aux_views.sql
-- Minimal cin-aux integration: raw account trades + moves import.

BEGIN;

------------------------------------------------------------
-- 1) Raw account trades from Binance (idempotent storage)
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
  account_email    text,
  raw              jsonb       NOT NULL,
  PRIMARY KEY (symbol, trade_id)
);

CREATE INDEX IF NOT EXISTS account_trades_symbol_time_idx
  ON market.account_trades (symbol, trade_time);

ALTER TABLE market.account_trades
  ADD COLUMN IF NOT EXISTS account_email text;

------------------------------------------------------------
-- 2) Import moves from account_trades into cin_aux.rt_move
--    (one move per trade, idempotent per (session, symbol, trade_id))
------------------------------------------------------------

CREATE OR REPLACE FUNCTION cin_aux.import_moves_from_account_trades(
  p_session_id BIGINT,
  p_account_email TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  r   record;
  cnt integer := 0;
  v_from_asset text;
  v_to_asset   text;
  v_notional   numeric;
  v_units      numeric;
  v_from_units numeric;
  v_side       text;
BEGIN
  -- Only consider trades not yet mapped to moves for this session
  FOR r IN
    SELECT
      t.symbol,
      s.base_asset,
      s.quote_asset,
      t.trade_id              AS trade_id,
      t.price::numeric        AS price,
      t.qty::numeric          AS qty,
      t.quote_qty::numeric    AS quote_qty,
      t.commission::numeric   AS commission,
      t.commission_asset,
      t.trade_time            AS trade_time,
      t.is_buyer,
      (t.raw ->> 'notionalUsdt')::numeric AS raw_notional_usdt,
      (t.raw ->> 'fromPriceUsdt')::numeric AS raw_from_price_usdt,
      (t.raw ->> 'toPriceUsdt')::numeric   AS raw_to_price_usdt
    FROM market.account_trades t
    JOIN market.symbols s ON s.symbol = t.symbol
    LEFT JOIN cin_aux.rt_move m
      ON m.session_id   = p_session_id
     AND m.src_symbol   = t.symbol
     AND m.src_trade_id = t.trade_id
    WHERE m.move_id IS NULL
      AND (
        p_account_email IS NULL
        OR t.account_email IS NULL
        OR LOWER(t.account_email) = LOWER(p_account_email)
      )
  LOOP
    v_side := CASE WHEN r.is_buyer THEN 'BUY' ELSE 'SELL' END;
    v_from_units := CASE WHEN r.is_buyer THEN r.quote_qty ELSE r.qty END;

    IF r.quote_asset = 'USDT' THEN
      v_notional := r.quote_qty;
      IF r.is_buyer THEN
        v_from_asset := 'USDT';
        v_to_asset   := r.base_asset;
        v_units      := r.qty;
      ELSE
        v_from_asset := r.base_asset;
        v_to_asset   := 'USDT';
        v_units      := r.quote_qty;
      END IF;
    ELSE
      v_notional := COALESCE(
        r.raw_notional_usdt,
        CASE
          WHEN r.raw_from_price_usdt IS NOT NULL THEN r.quote_qty * r.raw_from_price_usdt
          ELSE NULL
        END,
        CASE
          WHEN r.raw_to_price_usdt IS NOT NULL THEN r.qty * r.raw_to_price_usdt
          ELSE NULL
        END,
        r.quote_qty
      );
      IF r.is_buyer THEN
        v_from_asset := r.quote_asset;
        v_to_asset   := r.base_asset;
        v_units      := r.qty;
      ELSE
        v_from_asset := r.base_asset;
        v_to_asset   := r.quote_asset;
        v_units      := r.quote_qty;
      END IF;
    END IF;

    INSERT INTO cin_aux.rt_move (
      session_id, ts,
      from_asset, to_asset,
      executed_usdt,
      fee_usdt, slippage_usdt,
      ref_usdt_target,
      planned_usdt,
      dev_ref_usdt,
      comp_principal_usdt, comp_profit_usdt,
      p_bridge_in_usdt, p_bridge_out_usdt,
      from_units,
      lot_units_used,
      trace_usdt, profit_consumed_usdt, principal_hit_usdt,
      to_units_received,
      residual_from_after,
      notes,
      src_symbol, src_trade_id, src_side
    )
    VALUES (
      p_session_id,
      r.trade_time,
      v_from_asset,
      v_to_asset,
      v_notional,
      0, 0,
      NULL,
      NULL,
      NULL,
      v_notional, 0,
      NULL, NULL,
      v_from_units,
      NULL,
      0, 0, 0,
      v_units,
      NULL,
      format('binance:%s#%s', r.symbol, r.trade_id),
      r.symbol, r.trade_id, v_side
    )
    ON CONFLICT (session_id, src_symbol, src_trade_id) DO NOTHING;

    IF FOUND THEN
      cnt := cnt + 1;
    END IF;
  END LOOP;

  RETURN cnt;
END;
$$;

COMMIT;
