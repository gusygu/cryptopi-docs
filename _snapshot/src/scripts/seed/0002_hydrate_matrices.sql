-- scripts/seeds/0002_hydrate_matrices.sql

-- Create a session/snapshot
WITH s AS (
  INSERT INTO cin_session(window_label, window_bins, window_ms)
  VALUES ('H1@128', 128, 3600000)
  RETURNING session_id
),
snap AS (
  INSERT INTO session_coin_universe(session_id, symbol)
  SELECT (SELECT session_id FROM s), symbol
  FROM settings_coin_universe
  ON CONFLICT DO NOTHING
  RETURNING session_id, symbol
),
cols AS ( SELECT symbol, row_number() OVER (ORDER BY symbol) AS j FROM settings_coin_universe ),
rows AS ( SELECT symbol, row_number() OVER (ORDER BY symbol) AS i FROM settings_coin_universe ),

-- Register each row's matrix for 'id_pct'
regs AS (
  INSERT INTO mat_registry(session_id, name, symbol, window_label, bins, meta)
  SELECT DISTINCT (SELECT session_id FROM s), 'id_pct', r.symbol, 'H1@128', 128, '{}'::jsonb
  FROM rows r
  RETURNING mat_id, symbol
)
-- Fill cells (i=row asset, j=column asset) using id_pct_latest
INSERT INTO mat_cell (mat_id, i, j, v)
SELECT rg.mat_id, ri.i, cj.j,
       COALESCE(lp.id_pct, 0.0)
FROM regs rg
JOIN rows ri ON ri.symbol = rg.symbol          -- row anchor
JOIN cols cj                                    -- all columns
LEFT JOIN id_pct_latest lp
       ON lp.base = ri.symbol AND lp.quote = cj.symbol
ON CONFLICT DO NOTHING;
