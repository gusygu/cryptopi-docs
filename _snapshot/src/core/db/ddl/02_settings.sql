-- Pre-clean views in the 'settings' schema so 02_settings can CREATE OR REPLACE cleanly.
-- We DO NOT drop tables. Only views, and only those we’ll recreate in 02.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.views
    WHERE table_schema = 'settings'
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS settings.%I CASCADE', r.table_name);
  END LOOP;
END$$;



set search_path = settings, public;

-- A) WINDOWS (timing primitives, used across modules)
create table if not exists settings.windows (
  window_label  text primary key              -- e.g. '1m', '15m', '4h'
);

-- ensure legacy deployments pick up new columns
alter table settings.windows
  add column if not exists amount int,
  add column if not exists unit   text;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'settings'
       and table_name = 'windows'
       and column_name = 'duration_ms'
  ) then
    update settings.windows
    set amount = coalesce(
          amount,
          case
            when duration_ms is null then null
            when duration_ms % 86400000 = 0 then (duration_ms / 86400000)::int
            when duration_ms % 3600000 = 0 then (duration_ms / 3600000)::int
            when duration_ms % 60000 = 0 then (duration_ms / 60000)::int
            else null
          end
        )
    where amount is null;

    update settings.windows
    set unit = coalesce(
          unit,
          case
            when duration_ms is null then null
            when duration_ms % 86400000 = 0 then 'day'
            when duration_ms % 3600000 = 0 then 'hour'
            when duration_ms % 60000 = 0 then 'minute'
            else null
          end
        )
    where unit is null;
  end if;
end$$;

-- derive missing values from label when possible
update settings.windows
set amount = coalesce(
      amount,
      case
        when window_label ~ '^[0-9]+'
        then (regexp_replace(window_label, '[^0-9].*$', '', 'g'))::int
        else null
      end
    )
where amount is null;

update settings.windows
set unit = coalesce(
      unit,
      case
        when lower(window_label) like '%m' then 'minute'
        when lower(window_label) like '%h' then 'hour'
        when lower(window_label) like '%d' then 'day'
        else 'minute'
      end
    )
where unit is null;

update settings.windows
set amount = coalesce(amount, 1)
where amount is null;

-- Finalise constraints on amount/unit
alter table settings.windows
  alter column amount set not null,
  alter column unit set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'windows_amount_positive'
      and conrelid = 'settings.windows'::regclass
  ) then
    alter table settings.windows
      add constraint windows_amount_positive check (amount > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'windows_unit_valid'
      and conrelid = 'settings.windows'::regclass
  ) then
    alter table settings.windows
      add constraint windows_unit_valid check (unit in ('minute','hour','day'));
  end if;
end$$;

-- reset duration_ms as generated column
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'settings'
       and table_name = 'windows'
       and column_name = 'duration_ms'
  ) then
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'settings'
         and table_name = 'windows'
         and column_name = 'duration_ms'
         and is_generated <> 'ALWAYS'
    ) then
      alter table settings.windows drop column duration_ms;
    else
      -- already generated properly; nothing to do
      return;
    end if;
  end if;

  alter table settings.windows
    add column duration_ms bigint generated always as (
      case unit
        when 'minute' then amount * 60000
        when 'hour'   then amount * 3600000
        when 'day'    then amount * 86400000
        else null
      end
    ) stored;
end$$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'settings'
      and table_name = 'windows'
      and column_name = 'amount'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'settings'
      and table_name = 'windows'
      and column_name = 'unit'
  ) then
    if not exists (
      select 1
      from pg_indexes
      where schemaname = 'settings'
        and indexname = 'ux_windows_amount_unit'
    ) then
      execute 'create unique index ux_windows_amount_unit on settings.windows(amount, unit)';
    end if;
  end if;
end$$;

-- upsert helper
create or replace function settings.sp_upsert_window(_label text, _amount int, _unit text)
returns void language sql as $$
  insert into settings.windows(window_label, amount, unit)
  values(_label, _amount, _unit)
  on conflict (window_label) do update
    set amount = excluded.amount,
        unit   = excluded.unit;
$$;


-- B) PARAMS (engine knobs; detached from universe)
create table if not exists params (
  params_id            smallint primary key default 1,   -- singleton
  primary_interval_ms  int     not null default 30000,
  secondary_enabled    boolean not null default false,
  secondary_cycles     int     not null default 3,
  str_cycles_m30       int     not null default 45,
  str_cycles_h1        int     not null default 90,
  str_cycles_h3        int     not null default 270,
  updated_at           timestamptz not null default now()
);

create index if not exists ix_params_updated_at on params(updated_at desc);

-- Ensure legacy plural table is renamed to singular expected by codebase
do $$
declare
  prof regclass := to_regclass('settings.profile');
  prof_plural regclass := to_regclass('settings.profiles');
begin
  if prof is null and prof_plural is not null then
    execute 'ALTER TABLE settings.profiles RENAME TO profile';
    prof := to_regclass('settings.profile');
  end if;

  if to_regclass('settings.ux_profiles_email_ci') is not null then
    execute 'DROP INDEX IF EXISTS settings.ux_profiles_email_ci';
  end if;
  if to_regclass('settings.ux_profiles_handle_ci') is not null then
    execute 'DROP INDEX IF EXISTS settings.ux_profiles_handle_ci';
  end if;

  if prof is not null then
    execute 'DROP TRIGGER IF EXISTS t_profiles_u ON settings.profile';
    execute 'DROP TRIGGER IF EXISTS t_profile_u ON settings.profile';
  end if;
end$$;

CREATE TABLE IF NOT EXISTS profile (
  id              smallint PRIMARY KEY,
  nickname        text,
  email           text,
  timezone        text,
  language        text,
  binance_key_id  text,
  binance_key_last4 text,
  locale          text,
  tz              text,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profile
  ALTER COLUMN id SET DEFAULT 1;

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS nickname        text,
  ADD COLUMN IF NOT EXISTS email           text,
  ADD COLUMN IF NOT EXISTS timezone        text,
  ADD COLUMN IF NOT EXISTS language        text,
  ADD COLUMN IF NOT EXISTS binance_key_id  text,
  ADD COLUMN IF NOT EXISTS binance_key_last4 text,
  ADD COLUMN IF NOT EXISTS locale          text,
  ADD COLUMN IF NOT EXISTS tz              text,
  ADD COLUMN IF NOT EXISTS params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

UPDATE profile
   SET timezone = COALESCE(timezone, tz, 'UTC'),
       language = COALESCE(language, locale, 'en'),
       tz       = COALESCE(tz, timezone, 'UTC'),
       locale   = COALESCE(locale, language, 'en')
 WHERE timezone IS NULL OR language IS NULL OR tz IS NULL OR locale IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_profile_email_ci
  ON profile ((lower(email)))
  WHERE email IS NOT NULL;

CREATE TRIGGER t_profile_u
BEFORE UPDATE ON profile
FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();


-- D) COIN UNIVERSE (operational catalog the app toggles)
create table if not exists coin_universe (
  symbol       text primary key,
  enabled      boolean not null default true,
  sort_order   integer,
  base_asset   text,
  quote_asset  text,
  metadata     jsonb not null default '{}'::jsonb
);

create unique index if not exists ux_coin_universe_symbol on coin_universe(symbol);
create index if not exists ix_coin_universe_enabled on coin_universe(enabled);

comment on table coin_universe is
  'Universe catalog that drives enabled symbols and derived coins.';

-- E) OPTIONAL MIRROR to market.symbols if it exists (idempotent)
-- 02_settings.sql
create or replace function settings.sp_mirror_universe_to_market()
returns void
language plpgsql
as $$
begin
  -- Only try to sync if market.symbols exists (keeps this idempotent in dev)
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'market' and table_name = 'symbols'
  ) then
    perform market.sp_sync_from_settings_universe();
  end if;
end
$$;


-- F) EXTERNAL ACCOUNTS (non-exchange providers, generic)
create table if not exists external_accounts (
  provider        text primary key,
  linked          boolean not null default false,
  account_hint    text,
  last_linked_at  timestamptz,
  key_fingerprint text,
  meta            jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

-- G) WALLETS and API CREDENTIALS (adjacent to profile)
create table if not exists wallets (
  wallet_id          uuid primary key default gen_random_uuid(),
  owner_profile_id   smallint not null default 1 references settings.profile(id) on update cascade,
  label              text not null,
  symbol             text not null,               -- optional FK to market.symbols (see below)
  network            text not null,
  address            text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  opening_stamp      boolean not null default false,
  opening_session_id uuid,
  opening_ts         timestamptz,
  print_stamp        boolean not null default false,
  print_ts           timestamptz
);

-- Conditional FK to market.symbols(symbol)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='market' and table_name='symbols'
  ) and not exists (
    select 1 from pg_constraint
    where conname='fk_wallet_symbol'
      and conrelid='settings.wallets'::regclass
  ) then
    execute $ddl$
      alter table settings.wallets
        add constraint fk_wallet_symbol
        foreign key (symbol) references market.symbols(symbol)
        on update cascade
        not valid
    $ddl$;
    -- validate if possible
    if exists (
      select 1 from pg_constraint
      where conname='fk_wallet_symbol'
        and conrelid='settings.wallets'::regclass
        and not convalidated
    ) then
      execute 'alter table settings.wallets validate constraint fk_wallet_symbol';
    end if;
  end if;
end$$;

-- Exchange API credentials (encrypted-at-rest using pgcrypto is recommended)
create table if not exists wallet_credentials (
  cred_id          uuid primary key default gen_random_uuid(),
  wallet_id        uuid not null references settings.wallets(wallet_id) on delete cascade,
  exchange         text not null,                 -- e.g., 'binance', 'bybit'
  api_key          text not null,
  api_secret_ct    bytea not null,               -- ciphertext
  passphrase_ct    bytea,                        -- optional ciphertext
  key_fingerprint  text,                         -- derived for quick compare
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (wallet_id, exchange)
);

-- H) SCR / CCR RULES (server/client cache rules remain read-only to app)
create table if not exists scr_rules (
  rule_id        text primary key,
  description    text not null,
  enabled        boolean not null default true,
  precedence     int not null default 100,
  rule_json      jsonb not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists ccr_rules (
  rule_id        text primary key,
  description    text not null,
  enabled        boolean not null default true,
  precedence     int not null default 100,
  rule_json      jsonb not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 03_settings_ops.sql (or keep inside 02 if you prefer)
set search_path = settings, public;

create or replace function sp_upsert_coin_universe(_symbols text[])
returns void language plpgsql as $$
declare
  s text; b text; q text;
begin
  foreach s in array _symbols loop
    b := regexp_replace(s, '(.*)(USDT|BTC|FDUSD|USDC)$', '\1');
    q := regexp_replace(s, '.*(USDT|BTC|FDUSD|USDC)$', '\1');
    insert into settings.coin_universe(symbol, base_asset, quote_asset, enabled)
    values (s, nullif(b,''), nullif(q,''), true)
    on conflict (symbol) do update
      set enabled     = true,
          base_asset  = coalesce(settings.coin_universe.base_asset,  excluded.base_asset),
          quote_asset = coalesce(settings.coin_universe.quote_asset, excluded.quote_asset);
  end loop;

  -- optional mirror + seed cursors
  perform settings.sp_mirror_universe_to_market();

  if exists (select 1 from information_schema.tables
             where table_schema='ingest' and table_name='klines_cursor') then
    insert into ingest.klines_cursor(symbol, window_label)
    select cu.symbol, w.window_label
    from settings.coin_universe cu
    cross join settings.windows w
    where cu.enabled = true
    on conflict (symbol, window_label) do nothing;
  end if;
end$$;

-- view to surface binance linkage without secrets
create or replace view settings.v_profile_binance as
select p.id as profile_id, p.email,
       ea.linked as binance_linked,
       ea.account_hint,
       ea.key_fingerprint
from settings.profile p
left join settings.external_accounts ea
  on ea.provider = 'binance';
-- ------- review ------
create or replace function settings.sp_upsert_external_account(
  _provider text,
  _linked boolean,
  _account_hint text,
  _key_fingerprint text,
  _meta jsonb
) returns void language sql as $$
  insert into settings.external_accounts(provider, linked, account_hint, key_fingerprint, meta, last_linked_at, updated_at)
  values(_provider, coalesce(_linked,false), _account_hint, _key_fingerprint, coalesce(_meta,'{}'::jsonb), now(), now())
  on conflict (provider) do update
    set linked          = excluded.linked,
        account_hint    = excluded.account_hint,
        key_fingerprint = excluded.key_fingerprint,
        meta            = excluded.meta,
        last_linked_at  = case when excluded.linked then now() else settings.external_accounts.last_linked_at end,
        updated_at      = now();
$$;


-- settings_ops.sql
set search_path = settings, public;

create or replace function settings.sp_sync_coin_universe(
  _symbols      text[],            -- desired universe from UI
  _auto_disable boolean default true  -- disable anything not in _symbols
)
returns table(enabled_count int, disabled_count int)  -- quick feedback
language plpgsql as $$
begin
  -- de-dup desired symbols
  create temporary table _desired(symbol text primary key) on commit drop;
  insert into _desired(symbol)
  select distinct s from unnest(_symbols) as s;

  -- enable/insert desired
  with upserts as (
    insert into settings.coin_universe(symbol, enabled)
    select d.symbol, true
    from _desired d
    on conflict(symbol) do update set enabled = true
    returning symbol
  )
  select count(*) into enabled_count from upserts;

  -- optionally disable everything NOT in desired
  if _auto_disable then
    with disables as (
      update settings.coin_universe cu
         set enabled = false
       where cu.enabled = true
         and not exists (select 1 from _desired d where d.symbol = cu.symbol)
      returning symbol
    )
    select count(*) into disabled_count from disables;
  else
    disabled_count := 0;
  end if;

  -- seed cursors for all desired (idempotent)
  if exists (select 1 from information_schema.tables
             where table_schema='ingest' and table_name='klines_cursor')
  then
    insert into ingest.klines_cursor(symbol, window_label)
    select d.symbol, w.window_label
    from _desired d
    cross join settings.windows w
    on conflict (symbol, window_label) do nothing;

    -- clean cursors for newly disabled
    if _auto_disable then
      delete from ingest.klines_cursor kc
      where not exists (select 1 from _desired d where d.symbol = kc.symbol);
    end if;
  end if;

  -- optional mirror to market
  perform settings.sp_mirror_universe_to_market();

  return;
end$$;


-- inbox to drop the whole list
create table if not exists settings.universe_batch_ops (
  op_id        bigserial primary key,
  symbols      text[] not null,
  auto_disable boolean not null default true,
  created_at   timestamptz not null default now()
);

create or replace function settings.trg_apply_universe_batch()
returns trigger language plpgsql as $$
begin
  perform settings.sp_sync_coin_universe(new.symbols, new.auto_disable);
  return new;
end$$;

drop trigger if exists trg_apply_universe_batch on settings.universe_batch_ops;
create trigger trg_apply_universe_batch
after insert on settings.universe_batch_ops
for each row execute function settings.trg_apply_universe_batch();
drop trigger if exists t_profiles_u on profile;
drop trigger if exists t_profile_u on profile;

-- Ensure every market symbol has a coin_universe entry
create or replace function settings.sync_coin_universe(
  _enable_new boolean default true,
  _only_quote text default 'USDT'
) returns int
language sql as $$
  with src as (
    select ms.symbol
    from market.symbols ms
    where (_only_quote is null or right(ms.symbol, length(_only_quote)) = _only_quote)
  ),
  ins as (
    insert into settings.coin_universe(symbol, enabled)
    select s.symbol, _enable_new
      from src s
 left join settings.coin_universe cu using(symbol)
     where cu.symbol is null
    returning 1
  )
  select count(*)::int from ins;
$$;

-- Referential view the rest of the system reads from
-- Drop only if you truly need to break deps (rare). Prefer CREATE OR REPLACE first.
-- DROP VIEW IF EXISTS settings.v_coin_universe_simple CASCADE;

CREATE OR REPLACE VIEW settings.v_coin_universe_simple AS
SELECT
  cu.symbol,
  cu.base_asset,
  cu.quote_asset,
  cu.enabled
FROM settings.coin_universe cu;

