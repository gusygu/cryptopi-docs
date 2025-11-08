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
