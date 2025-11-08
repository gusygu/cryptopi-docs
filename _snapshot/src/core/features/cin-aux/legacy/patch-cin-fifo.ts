#!/usr/bin/env tsx
import "dotenv/config";
import { getPool } from "../../../db/client";

const PATCH = `
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
    RAISE EXCEPTION 'Not enough units in lots to consume: need %, short %', p_units_need, v_remain;
  END IF;

  RETURN;
END;
$$ LANGUAGE plpgsql;
`;

async function main() {
  const pool = getPool();
  try {
    await pool.query(PATCH);
    console.log("cin_consume_fifo_lots: patched.");
  } finally {
    await pool.end();
  }
}
main().catch((e)=>{ console.error(e); process.exit(1); });
