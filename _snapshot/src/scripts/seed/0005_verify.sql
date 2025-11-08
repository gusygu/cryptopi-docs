-- windows & universe
TABLE settings.windows;
SELECT count(*) AS enabled_symbols FROM settings.coin_universe WHERE enabled;

-- mirrored symbols and cursors
SELECT count(*) AS market_symbols FROM market.symbols;
SELECT count(*) AS kline_cursors FROM ingest.klines_cursor;

-- FK sanity (any not valid?)
SELECT conrelid::regclass AS table, conname, pg_catalog.pg_get_constraintdef(oid)
FROM pg_constraint
WHERE convalidated = false;

-- session exists?
SELECT session_id, window_label, created_at FROM cin_aux.sessions ORDER BY created_at DESC LIMIT 1;
