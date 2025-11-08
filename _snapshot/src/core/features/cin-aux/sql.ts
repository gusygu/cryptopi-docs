/**
 * core/features/cin-aux/sql.ts
 * Parameterized SQL used by the repo layer.
 */

export const SQL = {
  // Call into the canonical function that executes a move and writes all rows.
  EXEC_MOVE: `
    SELECT strategy_aux.cin_exec_move_v2(
      p_session_id => $1::uuid,
      p_ts         => $2::timestamptz,
      p_from_asset => $3::text,
      p_to_asset   => $4::text,
      p_units      => $5::numeric,
      p_price_usdt => $6::numeric,
      p_fee_usdt   => $7::numeric,
      p_slippage_usdt => $8::numeric,
      p_p_bridge_in_usdt  => $9::numeric,
      p_p_bridge_out_usdt => $10::numeric,
      p_dev_ref_usdt      => $11::numeric,
      p_ref_target_usdt   => $12::numeric,
      p_note       => $13::text
    ) AS move_id;
  `,

  // Hydration view for moves
  MOVES_BY_SESSION: `
    SELECT *
    FROM strategy_aux.v_cin_move_attrib
    WHERE session_id = $1::uuid
    ORDER BY ts;
  `,

  // Session rollup view
  SESSION_ROLLUP: `
    SELECT *
    FROM strategy_aux.v_cin_session_rollup
    WHERE session_id = $1::uuid;
  `,
};