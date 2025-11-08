-- ======
-- SETTINGS
-- ======

CREATE SCHEMA IF NOT EXISTS settings;


-- Key/value singleton settings (row-per-setting for observability/versioning)
CREATE TABLE IF NOT EXISTS settings.app_settings (
key text PRIMARY KEY,
value jsonb NOT NULL,
updated_at timestamptz NOT NULL DEFAULT now()
);


-- Poller interval and defaults (canonical keys)
INSERT INTO settings.app_settings(key, value) VALUES
('poll_interval_ms', '{"ms":40000}'),
('default_window', '{"label":"30m"}'),
('default_bins', '{"bins":128}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();


-- Windows registry: UI and API must use these values
CREATE TABLE IF NOT EXISTS settings.windows (
label text PRIMARY KEY, -- e.g., '1m','5m','30m','1h'
duration_ms bigint NOT NULL, -- precise duration for schedulers
bins_default int NOT NULL CHECK (bins_default > 0),
display_order int NOT NULL DEFAULT 100
);


-- Example windows
INSERT INTO settings.windows(label, duration_ms, bins_default, display_order) VALUES
('1m', 60000, 256, 10),
('5m', 300000, 256, 20),
('30m', 1800000, 128, 30),
('1h', 3600000, 128, 40)
ON CONFLICT (label) DO NOTHING;


-- Coin universe – drives sampling & matrix coverage
CREATE TABLE IF NOT EXISTS settings.coin_universe (
symbol text PRIMARY KEY, -- 'BTCUSDT'
enabled boolean NOT NULL DEFAULT true,
sort_order int NOT NULL DEFAULT 100,
base_asset text,
quote_asset text,
metadata jsonb NOT NULL DEFAULT '{}'
);


-- Poller/book-keeping state
CREATE TABLE IF NOT EXISTS settings.poller_state (
name text PRIMARY KEY, -- 'market.klines','market.orderbook', etc
last_run_ts timestamptz,
cursor jsonb NOT NULL DEFAULT '{}',
updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE INDEX IF NOT EXISTS idx_poller_state_updated_at ON settings.poller_state(updated_at DESC);

-- ==============
-- MARKET
-- ==============

CREATE SCHEMA IF NOT EXISTS market;


-- Klines (candles)
CREATE TABLE IF NOT EXISTS market.klines (
symbol text NOT NULL REFERENCES market.symbols(symbol) ON UPDATE CASCADE,
window_label text NOT NULL REFERENCES settings.windows(label) ON UPDATE CASCADE,
open_time timestamptz NOT NULL,
close_time timestamptz NOT NULL,
open numeric(38,18) NOT NULL,
high numeric(38,18) NOT NULL,
low numeric(38,18) NOT NULL,
close numeric(38,18) NOT NULL,
volume numeric(38,18) NOT NULL,
quote_volume numeric(38,18),
trades int,
taker_buy_base numeric(38,18),
taker_buy_quote numeric(38,18),
is_closed boolean NOT NULL,
ts_ingested timestamptz NOT NULL DEFAULT now(),
PRIMARY KEY (symbol, window_label, open_time)
);


CREATE INDEX IF NOT EXISTS idx_klines_symbol_time_desc ON market.klines(symbol, open_time DESC);


-- 24h ticker snapshots
CREATE TABLE IF NOT EXISTS market.ticker_24h (
symbol text NOT NULL REFERENCES market.symbols(symbol) ON UPDATE CASCADE,
ts timestamptz NOT NULL,
price numeric(38,18),
price_change_pct numeric(20,10),
high_price numeric(38,18),
low_price numeric(38,18),
volume numeric(38,18),
quote_volume numeric(38,18),
metadata jsonb NOT NULL DEFAULT '{}',
PRIMARY KEY (symbol, ts)
);


-- Order book snapshots (depth-limited); raw arrays/jsonb for speed
CREATE TABLE IF NOT EXISTS market.orderbook_snapshots (
symbol text NOT NULL REFERENCES market.symbols(symbol) ON UPDATE CASCADE,
ts timestamptz NOT NULL,
last_update_id bigint,
bids jsonb NOT NULL, -- [[price,qty],...]
asks jsonb NOT NULL, -- [[price,qty],...]
depth int NOT NULL,
PRIMARY KEY (symbol, ts)
);


-- Wallet balances (core values)
CREATE TABLE IF NOT EXISTS market.wallet_balances (
asset text NOT NULL,
ts timestamptz NOT NULL,
free numeric(38,18) NOT NULL,
locked numeric(38,18) NOT NULL,
metadata jsonb NOT NULL DEFAULT '{}',
PRIMARY KEY (asset, ts)
);

-- ================
-- STR-AUX
-- ================

CREATE SCHEMA IF NOT EXISTS str_aux;


-- Orderbook samples (synchronized to poll cadence)
CREATE TABLE IF NOT EXISTS str_aux.ob_samples (
symbol text NOT NULL REFERENCES market.symbols(symbol),
ts timestamptz NOT NULL,
mid numeric(38,18) NOT NULL,
spread numeric(38,18) NOT NULL,
v_inner numeric(38,18),
v_outer numeric(38,18),
depth_bid numeric(38,18),
depth_ask numeric(38,18),
src_snapshot_ts timestamptz NOT NULL,
PRIMARY KEY (symbol, ts)
);


-- Kline samples aligned to app windows (returns, deltas, etc.)
CREATE TABLE IF NOT EXISTS str_aux.kline_samples (
symbol text NOT NULL REFERENCES market.symbols(symbol),
window_label text NOT NULL REFERENCES settings.windows(label),
ts timestamptz NOT NULL, -- aligned boundary
ret_pct numeric(20,10),
delta_abs numeric(38,18),
volatility numeric(20,10),
src_open_time timestamptz NOT NULL,
src_close_time timestamptz NOT NULL,
PRIMARY KEY (symbol, window_label, ts)
);


-- Vector rollup used by UI (what StrAuxClient expects)
CREATE TABLE IF NOT EXISTS str_aux.vectors (
symbol text NOT NULL REFERENCES market.symbols(symbol),
window_label text NOT NULL REFERENCES settings.windows(label),
ts timestamptz NOT NULL,
v_inner numeric(38,18) NOT NULL DEFAULT 0,
v_outer numeric(38,18) NOT NULL DEFAULT 0,
spread numeric(38,18) NOT NULL DEFAULT 0,
v_tendency jsonb NOT NULL DEFAULT '{"score":0,"direction":0,"strength":0,"slope":0,"r":0}',
v_swap jsonb,
summary jsonb NOT NULL DEFAULT '{"scale":100,"bins":0,"samples":0,"inner":{"scaled":0,"unitless":0,"weightSum":0}}',
PRIMARY KEY (symbol, window_label, ts)
);


CREATE INDEX IF NOT EXISTS idx_vectors_latest ON str_aux.vectors(symbol, window_label, ts DESC);

-- =================
-- CIN-AUX
-- =================

CREATE SCHEMA IF NOT EXISTS cin_aux;


-- Sessions
CREATE TABLE IF NOT EXISTS cin_aux.sessions (
session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_ts timestamptz NOT NULL DEFAULT now(),
window_label text NOT NULL REFERENCES settings.windows(label),
user_tag text, -- optional: per-user or device tag
meta jsonb NOT NULL DEFAULT '{}'
);


-- Cascade ledger (multi-coin paths: BTC->ETH->BNB...)
CREATE TABLE IF NOT EXISTS cin_aux.ledger (
ledger_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
session_id uuid NOT NULL REFERENCES cin_aux.sessions(session_id) ON DELETE CASCADE,
step_no int NOT NULL,
symbol_from text NOT NULL,
symbol_to text NOT NULL,
qty_in numeric(38,18) NOT NULL,
qty_out numeric(38,18) NOT NULL,
fee numeric(38,18) NOT NULL DEFAULT 0,
pnl numeric(38,18) NOT NULL DEFAULT 0,
ts timestamptz NOT NULL DEFAULT now(),
UNIQUE(session_id, step_no)
);


-- Per-symbol results for a session
CREATE TABLE IF NOT EXISTS cin_aux.results (
result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
session_id uuid NOT NULL REFERENCES cin_aux.sessions(session_id) ON DELETE CASCADE,
symbol text NOT NULL,
score numeric(20,10) NOT NULL,
rank int,
ts timestamptz NOT NULL DEFAULT now(),
UNIQUE(session_id, symbol, ts)
);


CREATE INDEX IF NOT EXISTS idx_cin_results_rank ON cin_aux.results(session_id, ts DESC, rank);

-- ===================
-- MEA-DYNAMICS
-- ===================

CREATE SCHEMA IF NOT EXISTS mea_dynamics;


-- MEA poll snapshots (driven by poller)
CREATE TABLE IF NOT EXISTS mea_dynamics.mea_poll (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
symbol text NOT NULL,
window_label text NOT NULL REFERENCES settings.windows(label),
ts timestamptz NOT NULL,
bulk_per_coin numeric(38,18) NOT NULL,
tiers jsonb NOT NULL, -- 5-tier reactivity coefficients
mood jsonb NOT NULL, -- combination weights (vTendency, GFM, vSwap)
mea_value numeric(38,18) NOT NULL,
inputs jsonb NOT NULL DEFAULT '{}'
);


-- Latest (per symbol, per window)
CREATE TABLE IF NOT EXISTS mea_dynamics.mea_latest (
symbol text PRIMARY KEY,
window_label text NOT NULL REFERENCES settings.windows(label),
ts timestamptz NOT NULL,
mea_value numeric(38,18) NOT NULL,
snapshot_id uuid NOT NULL REFERENCES mea_dynamics.mea_poll(id) ON DELETE CASCADE
);


-- Page usage / dynamics events
CREATE TABLE IF NOT EXISTS mea_dynamics.dynamics_events (
event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
session_id uuid REFERENCES cin_aux.sessions(session_id) ON DELETE SET NULL,
page text NOT NULL, -- e.g., 'str-aux','cin-aux','mea'
event_type text NOT NULL, -- e.g., 'view','hover','sort','filter','click'
event_payload jsonb NOT NULL DEFAULT '{}',
ts timestamptz NOT NULL DEFAULT now()
);


CREATE INDEX IF NOT EXISTS idx_mea_poll_symbol_time ON mea_dynamics.mea_poll(symbol, window_label, ts DESC);
CREATE INDEX IF NOT EXISTS idx_dyn_events_time ON mea_dynamics.dynamics_events(ts DESC);

-- ===================
-- MATRICES
-- ===================

CREATE SCHEMA IF NOT EXISTS matrices;


-- Enumerated types
DO $$ BEGIN
CREATE TYPE matrices.matrix_type AS ENUM ('bm','pct24h','elta','id_pct','pct_drv','ref','pct_ref');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- Generic container for all matrices
CREATE TABLE IF NOT EXISTS matrices.values_store (
matrix matrices.matrix_type NOT NULL,
symbol text NOT NULL,
window_label text NOT NULL REFERENCES settings.windows(label),
ts timestamptz NOT NULL,
bins int NOT NULL CHECK (bins > 0),
values double precision[] NOT NULL, -- length=bins
summary jsonb NOT NULL DEFAULT '{}', -- e.g., min,max,mean,stdev
PRIMARY KEY (matrix, symbol, window_label, ts)
);


CREATE INDEX IF NOT EXISTS idx_matrices_latest ON matrices.values_store(matrix, symbol, window_label, ts DESC);


-- Convenience views per matrix
CREATE OR REPLACE VIEW matrices.benchmark AS SELECT * FROM matrices.values_store WHERE matrix='benchmark';
CREATE OR REPLACE VIEW matrices.pct24h AS SELECT * FROM matrices.values_store WHERE matrix='pct24h';
CREATE OR REPLACE VIEW matrices.delta AS SELECT * FROM matrices.values_store WHERE matrix='delta';
CREATE OR REPLACE VIEW matrices.id_pct AS SELECT * FROM matrices.values_store WHERE matrix='id_pct';
CREATE OR REPLACE VIEW matrices.pct_drv AS SELECT * FROM matrices.values_store WHERE matrix='pct_drv';
CREATE OR REPLACE VIEW matrices.ref AS SELECT * FROM matrices.values_store WHERE matrix='ref';
CREATE OR REPLACE VIEW matrices.pct_ref AS SELECT * FROM matrices.values_store WHERE matrix='pct_ref';

-- ===================
-- 7) Ingestion cursors & light job queue
-- ===================

CREATE SCHEMA IF NOT EXISTS ingest;


-- Per-symbol/window klines cursor
CREATE TABLE IF NOT EXISTS ingest.klines_cursor (
symbol text NOT NULL,
window_label text NOT NULL REFERENCES settings.windows(label),
last_open_time timestamptz,
PRIMARY KEY(symbol, window_label)
);


-- Generic job queue (poller/ETL)
DO $$ BEGIN
CREATE TYPE ingest.job_kind AS ENUM ('fetch_klines','fetch_ticker','fetch_orderbook','compute_str_vectors','compute_matrices','compute_mea');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


DO $$ BEGIN
CREATE TYPE ingest.job_status AS ENUM ('queued','running','succeeded','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS ingest.jobs (
job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
kind ingest.job_kind NOT NULL,
payload jsonb NOT NULL DEFAULT '{}',
status ingest.job_status NOT NULL DEFAULT 'queued',
attempts int NOT NULL DEFAULT 0,
scheduled_for timestamptz NOT NULL DEFAULT now(),
started_at timestamptz,
finished_at timestamptz,
error text
);


CREATE INDEX IF NOT EXISTS idx_jobs_sched ON ingest.jobs(status, scheduled_for);

-- ===================
-- 8) Upsert helpers (examples)
-- ===================

-- market.klines upsert
CREATE OR REPLACE FUNCTION market.upsert_kline(
p_symbol text,
p_window text,
p_open_time timestamptz,
p_close_time timestamptz,
p_open numeric, p_high numeric, p_low numeric, p_close numeric,
p_volume numeric, p_quote_volume numeric, p_trades int,
p_taker_buy_base numeric, p_taker_buy_quote numeric, p_is_closed boolean
) RETURNS void AS $$
BEGIN
INSERT INTO market.klines(symbol, window_label, open_time, close_time, open, high, low, close, volume, quote_volume, trades, taker_buy_base, taker_buy_quote, is_closed)
VALUES (p_symbol, p_window, p_open_time, p_close_time, p_open, p_high, p_low, p_close, p_volume, p_quote_volume, p_trades, p_taker_buy_base, p_taker_buy_quote, p_is_closed)
ON CONFLICT (symbol, window_label, open_time)
DO UPDATE SET close_time = EXCLUDED.close_time,
open = EXCLUDED.open,
high = EXCLUDED.high,
low = EXCLUDED.low,
close= EXCLUDED.close,
volume=EXCLUDED.volume,
quote_volume=EXCLUDED.quote_volume,
trades=EXCLUDED.trades,
taker_buy_base=EXCLUDED.taker_buy_base,
taker_buy_quote=EXCLUDED.taker_buy_quote,
is_closed=EXCLUDED.is_closed,
ts_ingested=now();
END; $$ LANGUAGE plpgsql;


-- matrices generic upsert
CREATE OR REPLACE FUNCTION matrices.upsert_values(
p_matrix matrices.matrix_type,
p_symbol text,
p_window text,
p_ts timestamptz,
p_bins int,
p_values double precision[],
p_summary jsonb
) RETURNS void AS $$
BEGIN
INSERT INTO matrices.values_store(matrix, symbol, window_label, ts, bins, values, summary)
VALUES (p_matrix, p_symbol, p_window, p_ts, p_bins, p_values, p_summary)
ON CONFLICT (matrix, symbol, window_label, ts)
DO UPDATE SET bins = EXCLUDED.bins,
values = EXCLUDED.values,
summary = EXCLUDED.summary;
END; $$ LANGUAGE plpgsql;

-- ===================
-- 9) Minimal views for “latest”
-- ===================

-- Latest vectors for UI
CREATE OR REPLACE VIEW str_aux.vectors_latest AS
SELECT DISTINCT ON (symbol, window_label)
symbol, window_label, ts, v_inner, v_outer, spread, v_tendency, v_swap, summary
FROM str_aux.vectors
ORDER BY symbol, window_label, ts DESC;


-- Latest matrix per type & symbol
CREATE OR REPLACE VIEW matrices.latest AS
SELECT DISTINCT ON (matrix, symbol, window_label)
matrix, symbol, window_label, ts, bins, values, summary
FROM matrices.values_store
ORDER BY matrix, symbol, window_label, ts DESC;

-- ===================
-- 10) Bootstrap & populate (tie-in to “populate DB with API”)
-- ===================

-- Align coin universe to Binance symbols you intend to track
INSERT INTO settings.coin_universe(symbol, enabled, sort_order, base_asset, quote_asset)
VALUES
('BTCUSDT', true, 10, 'BTC', 'USDT'),
('ETHUSDT', true, 20, 'ETH', 'USDT'),
('BNBUSDT', true, 30, 'BNB', 'USDT'),
('SOLUSDT', true, 40, 'SOL', 'USDT'),
('ADAUSDT', true, 50, 'ADA', 'USDT'),
('XRPUSDT', true, 60, 'XRP', 'USDT'),
('DOGEUSDT', true, 70, 'DOGE','USDT')
ON CONFLICT (symbol) DO UPDATE SET enabled = EXCLUDED.enabled;


-- Mirror into market.symbols (or fetch/insert via API first)
INSERT INTO market.symbols(symbol, base_asset, quote_asset)
SELECT symbol, base_asset, quote_asset FROM settings.coin_universe
ON CONFLICT (symbol) DO NOTHING;


-- Initialize kline cursors
INSERT INTO ingest.klines_cursor(symbol, window_label, last_open_time)
SELECT cu.symbol, w.label, NULL
FROM settings.coin_universe cu CROSS JOIN settings.windows w
WHERE cu.enabled = true
ON CONFLICT (symbol, window_label) DO NOTHING;