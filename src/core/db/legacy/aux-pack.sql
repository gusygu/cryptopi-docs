/* ============================================================
   CryptoPill • AUX PACK (core + str + mea + cin)
   Idempotent DDL for a blank or existing DB.
   Conventions: UUID ids, timestamptz, NOT NULL + sensible defaults.
   ============================================================ */
create extension if not exists "uuid-ossp";

/* ---------- CORE ---------- */
create table if not exists cin_session (
  session_id uuid primary key default uuid_generate_v4(),
  window_label text not null default '',
  window_bins int  not null default 0,
  window_ms   bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists settings_coin_universe (
  symbol text primary key,
  meta jsonb not null default '{}'::jsonb,
  constraint symbol_upper check (symbol = upper(symbol))
);

create table if not exists session_coin_universe (
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  primary key (session_id, symbol)
);

create table if not exists combo_set (
  combo_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  k int not null,
  signature text not null,
  created_at timestamptz not null default now(),
  unique(session_id, signature)
);
create table if not exists combo_member (
  combo_id uuid not null references combo_set(combo_id) on delete cascade,
  position int not null,
  symbol text not null references settings_coin_universe(symbol),
  primary key (combo_id, position)
);

/* generic matrices */
create table if not exists mat_registry (
  mat_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  name text not null,           -- e.g. 'id_pct', 'MEA'
  symbol text not null,         -- row anchor; '' allowed for global
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

/* ---------- STR (vectors) ---------- */
create table if not exists str_vectors (
  vectors_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  v_inner double precision not null default 0,
  v_outer double precision not null default 0,
  spread  double precision not null default 0,
  v_tendency jsonb not null default '{"score":0,"direction":0,"strength":0,"slope":0,"r":0}',
  v_swap jsonb,
  summary jsonb not null default '{"scale":100,"bins":0,"samples":0,"inner":{"scaled":0,"unitless":0,"weightSum":0}}',
  created_at timestamptz not null default now()
);
create index if not exists idx_str_vectors_session_sym on str_vectors(session_id, symbol);

/* ---------- MEA (per-symbol scalar) ---------- */
create table if not exists mea_result (
  mea_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  value double precision not null,
  components jsonb not null, -- { bulk, n_of_coins, tier, mood, ... }
  created_at timestamptz not null default now(),
  unique(session_id, symbol)
);
create index if not exists idx_mea_session_sym on mea_result(session_id, symbol);

/* ---------- CIN (a_ij: profit, imprint, luggage) ---------- */
do $$ begin
  create type cin_metric as enum ('profit','imprint','luggage');
exception when duplicate_object then null; end $$;

create table if not exists cin_cycle (
  cycle_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  label text not null default '',
  created_at timestamptz not null default now()
);

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

/* ---------- OPS (orders + fills) ---------- */
do $$ begin
  create type ops_side as enum ('buy','sell');
exception when duplicate_object then null; end $$;
do $$ begin
  create type ops_status as enum ('requested','placed','rejected','filled','cancelled','expired');
exception when duplicate_object then null; end $$;

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

/* ---------- Ledger inputs (id_pct + balances + metrics) ---------- */
create table if not exists id_pct_pairs (
  base text not null,
  quote text not null,
  id_pct double precision not null,
  ts_epoch_ms bigint not null,
  primary key (base, quote, ts_epoch_ms)
);
create or replace view id_pct_latest as
select distinct on (base, quote) base, quote, id_pct, ts_epoch_ms
from id_pct_pairs
order by base, quote, ts_epoch_ms desc;

create table if not exists balances (
  asset text not null,
  amount numeric not null,
  ts_epoch_ms bigint not null,
  primary key (asset, ts_epoch_ms)
);
create or replace view wallet_balances_latest as
select distinct on (asset) asset, amount, ts_epoch_ms
from balances
order by asset, ts_epoch_ms desc;

create table if not exists metrics (
  metric_key text not null,
  value double precision not null,
  ts_epoch_ms bigint not null,
  primary key (metric_key, ts_epoch_ms)
);

create table if not exists pair_availability (
  base text not null,
  quote text not null,
  tradable boolean not null,
  ts_epoch_ms bigint not null,
  primary key (base, quote, ts_epoch_ms)
);
