/* ============================================================
   CryptoPill DB Conventions
   - IDs: UUID across app & DB (uuid_generate_v4()).
   - Timestamps: created_at / updated_at (timestamptz, DB defaults).
   - Labels/Text: NOT NULL with DEFAULT '' unless truly optional.
   - Namespacing: cin_* (control), str_* (streams), mea_* (allocs).
   - Sessions: everything ties to cin_session.session_id (uuid).
   - Symbols: always UPPERCASE (constraint enforced).
   - Coin Universe: settings_coin_universe + session_coin_universe snapshot.
   ============================================================ */
create extension if not exists "uuid-ossp";

-- sessions
create table if not exists cin_session (
  session_id uuid primary key default uuid_generate_v4(),
  window_label text not null default '',
  window_bins int not null default 0,
  window_ms   bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- global coin universe
create table if not exists settings_coin_universe (
  symbol text primary key,
  meta jsonb not null default '{}'::jsonb,
  constraint symbol_upper check (symbol = upper(symbol))
);

-- per-session snapshot
create table if not exists session_coin_universe (
  session_id uuid not null references cin_session(session_id) on delete cascade,
  symbol text not null references settings_coin_universe(symbol) on delete restrict,
  primary key (session_id, symbol)
);

-- generic matrices
create table if not exists mat_registry (
  mat_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references cin_session(session_id) on delete cascade,
  name text not null,
  symbol text not null,
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

-- optional: combinations registry
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
