-- 16_ingest.sql — Autonomous ingest + universe wiring (production-ready, idempotent)
-- Assumptions:
--   • settings.coin_universe(symbol, base_asset, quote_asset, enabled) EXISTS
--   • market.symbols(...) EXISTS and (preferably) market.sp_upsert_symbol(...) is available
--   • str_aux.* (08_str-aux.sql) already applied (samples_5s, upsert_sample_5s, roll helpers)
-- Design goals:
--   • No pgvector. No naked top-level SELECT. Everything guarded & idempotent.
--   • "Universe first": settings is source of truth; market mirrors via validated path.
--   • Append-only raw payload capture + normalized writers into str_aux.
--   • LISTEN/NOTIFY so a tiny daemon can auto-resubscribe when the universe changes.

-- ============================================================================
-- A) PRE-CLEAN (drop conflicting prior defs so CREATE OR REPLACE won't hit return-type errors)
-- ============================================================================

-- Drop autonotify triggers first (avoid deps)
do $do$
begin
  begin execute 'drop trigger if exists t_autonotify_coin_universe_ins on settings.coin_universe'; exception when others then null; end;
  begin execute 'drop trigger if exists t_autonotify_coin_universe_upd on settings.coin_universe'; exception when others then null; end;
  begin execute 'drop trigger if exists t_autonotify_coin_universe_del on settings.coin_universe'; exception when others then null; end;
end
$do$;

-- Drop the autonotify function
do $do$
begin
  begin execute 'drop function if exists settings.trg_coin_universe_autonotify()'; exception when undefined_function then null; end;
end
$do$;

-- Drop symbol splitters (return types often differ across versions)
do $do$
begin
  begin execute 'drop function if exists public._split_symbol(text)'; exception when undefined_function then null; end;
  begin execute 'drop function if exists market._split_symbol(text)'; exception when undefined_function then null; end;
end
$do$;

-- Drop ingest functions (any old sigs)
do $do$
begin
  -- targets/stale
  begin execute 'drop function if exists ingest.v_targets_stale(integer)'; exception when undefined_function then null; end;
  -- acceptors
  begin execute 'drop function if exists ingest.sp_accept_symbol(text, text)'; exception when undefined_function then null; end;
  begin execute 'drop function if exists ingest.sp_accept_symbols(text[], text)'; exception when undefined_function then null; end;
  -- book tick (both variants)
  begin execute 'drop function if exists ingest.sp_ingest_book_tick(text, timestamptz, numeric, numeric)'; exception when undefined_function then null; end;
  begin execute 'drop function if exists ingest.sp_ingest_book_tick(text, timestamptz, numeric, numeric, jsonb)'; exception when undefined_function then null; end;
  -- kline row (both variants)
  begin execute 'drop function if exists ingest.sp_ingest_kline_row(text, text, timestamptz, timestamptz, numeric, numeric, numeric, numeric, numeric, int)'; exception when undefined_function then null; end;
  begin execute 'drop function if exists ingest.sp_ingest_kline_row(text, text, timestamptz, timestamptz, numeric, numeric, numeric, numeric, numeric, int, jsonb)'; exception when undefined_function then null; end;
  -- batch rollers
  begin execute 'drop function if exists ingest.tick_all()'; exception when undefined_function then null; end;
  begin execute 'drop function if exists ingest.backfill_all_between(timestamptz, timestamptz)'; exception when undefined_function then null; end;
end
$do$;

-- ============================================================================
-- 0) Schemas & search_path
-- ============================================================================
create schema if not exists ingest;
create schema if not exists ext;
set search_path = ingest, public;

-- ============================================================================
-- 1) Symbol splitters (public; OUT record; safe to re-run)
-- ============================================================================
set search_path = public, pg_catalog;

create or replace function _split_symbol(sym text, OUT base text, OUT quote text)
returns record
stable
language plpgsql
as $$
declare
  s text := upper(coalesce(sym,''));
  qlist text[];
  q text; cut int;
begin
  -- normalize: "binance:btc/usdt" -> "BTCUSDT"
  s := replace(s, '/', '');
  if position(':' in s) > 0 then s := split_part(s, ':', 2); end if;

  -- 1) authoritative from settings
  begin
    select cu.base_asset, cu.quote_asset into base, quote
    from settings.coin_universe cu
    where cu.symbol = s
    limit 1;
  exception when undefined_table then null;
  end;
  if base is not null and quote is not null then return; end if;

  -- 2) try market.symbols
  begin
    select m.base_asset, m.quote_asset into base, quote
    from market.symbols m
    where m.symbol = s
    limit 1;
  exception when undefined_table then null;
  end;
  if base is not null and quote is not null then return; end if;

  -- 3) heuristic by known quotes (prefer longer suffix first)
  begin
    select array_agg(a.asset order by length(a.asset) desc) into qlist
    from market.assets a
    where upper(coalesce(a.kind,'QUOTE')) in ('QUOTE','FIAT','STABLE')
       or a.asset in ('USDT','USDC','FDUSD','BUSD','TUSD','DAI','USD','BRL','BTC','ETH','BNB');
  exception when undefined_table then
    qlist := array['USDT','USDC','FDUSD','BUSD','TUSD','DAI','USD','BRL','BTC','ETH','BNB'];
  end;

  foreach q in array qlist loop
    if right(s, length(q)) = q and length(s) > length(q) then
      cut  := length(s) - length(q);
      base := left(s, cut);
      quote:= q;
      return;
    end if;
  end loop;

  -- 4) last resort: split roughly (prefer 3-char quote)
  if length(s) >= 6 then
    cut  := greatest(3, length(s) - 3);
    base := left(s, cut);
    quote:= right(s, length(s)-cut);
  else
    base := null; quote := null;
  end if;
end
$$;

-- Optional legacy shim
do $do$
begin
  if exists (select 1 from pg_namespace where nspname='market') then
    create or replace function market._split_symbol(sym text, OUT base text, OUT quote text)
    returns record language sql stable
    as $m$ select * from public._split_symbol($1) $m$;
  end if;
end
$do$;

-- Back to ingest search_path
set search_path = ingest, public;

-- ============================================================================
-- 2) Binance PREVIEW staging (CSR/SSR writes here — not to market)
-- ============================================================================
create table if not exists ext.binance_symbols_preview (
  symbol       text primary key,
  base_asset   text not null,
  quote_asset  text not null,
  status       text null,
  is_spot      boolean not null default true,
  raw          jsonb not null default '{}'::jsonb,
  fetched_at   timestamptz not null default now()
);
create index if not exists ix_bsp_fetched_at  on ext.binance_symbols_preview(fetched_at desc);
create index if not exists ix_bsp_quote_asset on ext.binance_symbols_preview(quote_asset);
create index if not exists ix_bsp_status      on ext.binance_symbols_preview(status);

create or replace function ext.stage_binance_symbol(
  p_symbol text, p_base text, p_quote text,
  p_status text default 'TRADING', p_is_spot boolean default true, p_raw jsonb default '{}'::jsonb
) returns void
language sql
as $$
  insert into ext.binance_symbols_preview(symbol, base_asset, quote_asset, status, is_spot, raw, fetched_at)
  values (upper(p_symbol), upper(p_base), upper(p_quote), coalesce(nullif(p_status,''),'TRADING'), coalesce(p_is_spot,true), coalesce(p_raw,'{}'::jsonb), now())
  on conflict (symbol) do update
    set base_asset = excluded.base_asset,
        quote_asset= excluded.quote_asset,
        status     = excluded.status,
        is_spot    = excluded.is_spot,
        raw        = excluded.raw,
        fetched_at = excluded.fetched_at;
$$;

create or replace function ext.stage_binance_symbols_json(p_rows jsonb)
returns int
language plpgsql
as $$
declare r jsonb; n int := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    perform ext.stage_binance_symbol(
      (r->>'symbol'), (r->>'baseAsset'), (r->>'quoteAsset'),
      (r->>'status'), coalesce((r->>'isSpot')::boolean, true), r
    );
    n := n + 1;
  end loop;
  return n;
end
$$;

-- ============================================================================
-- 3) Universe surfaces (targets + stale scan)
-- ============================================================================
create or replace view v_targets as
select cu.symbol, cu.base_asset, cu.quote_asset
from settings.coin_universe cu
where cu.enabled is true
order by cu.symbol;

create or replace function v_targets_stale(_stale_secs int default 20)
returns table(symbol text, last_sample_ts timestamptz)
stable
language sql
as $$
  with t as (select symbol from settings.coin_universe where enabled),
       ls as (select symbol, max(ts) last_ts from str_aux.samples_5s group by 1)
  select t.symbol, ls.last_ts
  from t left join ls using(symbol)
  where coalesce(extract(epoch from (now() - ls.last_ts))::int, 999999) > _stale_secs
  order by t.symbol;
$$;

-- ============================================================================
-- 4) Universe ➜ market sync (delegates to settings.sp_mirror_universe_to_market)
-- ============================================================================
create or replace function sp_sync_universe_to_market()
returns void
language plpgsql
as $$
begin
  begin
    perform settings.sp_mirror_universe_to_market();
  exception when undefined_function then
    -- If not defined yet, we no-op; raw ingest still works and market can be synced later.
    null;
  end;
end
$$;

-- Apply-time one-shot sync (safe no-op)
do $do$
begin
  perform ingest.sp_sync_universe_to_market();
exception when others then null;
end
$do$;

-- ============================================================================
-- 5) Raw append-only inbound tables (audit/backfills)
-- ============================================================================
create table if not exists ticker_raw (
  ts_arrived      timestamptz not null default now(),
  exchange        text        not null default 'binance',
  symbol          text        not null,
  event_time_ms   bigint      not null,
  price           numeric(38,18),
  qty             numeric(38,18),
  is_buyer_maker  boolean,
  payload         jsonb       not null default '{}'::jsonb
);
create index if not exists ix_ticker_raw_arrived on ticker_raw(ts_arrived);
create index if not exists ix_ticker_raw_sym_time on ticker_raw(symbol, event_time_ms);

create table if not exists kline_raw (
  ts_arrived      timestamptz not null default now(),
  exchange        text        not null default 'binance',
  symbol          text        not null,
  interval_label  text        not null,
  open_time_ms    bigint      not null,
  close_time_ms   bigint      not null,
  open_price      numeric(38,18) not null,
  high_price      numeric(38,18) not null,
  low_price       numeric(38,18) not null,
  close_price     numeric(38,18) not null,
  volume          numeric(38,18) not null,
  trades          int          not null,
  payload         jsonb        not null default '{}'::jsonb,
  unique (symbol, interval_label, close_time_ms)
);
create index if not exists ix_kline_raw_arrived on kline_raw(ts_arrived);

create table if not exists orderbook_raw (
  ts_arrived      timestamptz not null default now(),
  exchange        text        not null default 'binance',
  symbol          text        not null,
  snapshot        boolean     not null default false,
  last_update_id  bigint,
  event_time_ms   bigint,
  first_update_id bigint,
  final_update_id bigint,
  bids            jsonb,
  asks            jsonb,
  payload         jsonb not null default '{}'::jsonb
);
create index if not exists ix_ob_raw_arrived on orderbook_raw(ts_arrived);
create index if not exists ix_ob_raw_sym on orderbook_raw(symbol);

create table if not exists account_balance_raw (
  ts_arrived      timestamptz not null default now(),
  exchange        text        not null default 'binance',
  account_scope   text        not null default 'spot',
  payload         jsonb       not null default '{}'::jsonb
);
create index if not exists ix_accbal_arrived on account_balance_raw(ts_arrived);

-- ============================================================================
-- 6) Normalizers / writers (entrypoints your routes/jobs call)
-- ============================================================================
create or replace function sp_accept_symbol(p_symbol text, p_venue text default 'BINANCE')
returns void
language plpgsql
as $$
declare b text; q text; s text := upper(coalesce(p_symbol,''));
begin
  select base, quote into b, q from public._split_symbol(s);
  if b is null or q is null then raise exception 'Cannot split symbol %', s; end if;

  -- Prefer helper; otherwise best-effort inline upsert if the table exists
  begin
    perform market.sp_upsert_symbol(upper(b)||upper(q), upper(b), upper(q), p_venue, 'TRADING', '{}'::jsonb);
  exception when undefined_function then
    begin
      insert into market.symbols(symbol, base_asset, quote_asset, status, source, last_sync, meta)
      values (upper(b)||upper(q), upper(b), upper(q), 'TRADING', lower(p_venue), now(), jsonb_build_object('source', lower(p_venue)))
      on conflict (symbol) do update
        set base_asset = excluded.base_asset,
            quote_asset= excluded.quote_asset,
            status     = excluded.status,
            source     = excluded.source,
            last_sync  = excluded.last_sync,
            meta       = coalesce(market.symbols.meta,'{}'::jsonb) || excluded.meta;
    exception when undefined_table then null;
    end;
  end;
end
$$;

create or replace function sp_accept_symbols(p_symbols text[], p_venue text default 'BINANCE')
returns int
language plpgsql
as $$
declare s text; n int := 0;
begin
  if p_symbols is null then return 0; end if;
  foreach s in array p_symbols loop
    perform ingest.sp_accept_symbol(s, p_venue);
    n := n + 1;
  end loop;
  return n;
end
$$;

create or replace function sp_ingest_book_tick(
  p_symbol text,
  p_event_ts timestamptz,
  p_bid numeric,
  p_ask numeric,
  p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
as $$
declare s text := upper(p_symbol); mid numeric;
begin
  perform ingest.sp_accept_symbol(s);
  mid := case when p_bid is not null and p_ask is not null then (p_bid + p_ask)/2.0 else null end;

  insert into ingest.ticker_raw(symbol, event_time_ms, price, qty, is_buyer_maker, payload)
  values (s, (extract(epoch from p_event_ts)*1000)::bigint, mid, null, null, coalesce(p_payload,'{}'::jsonb));

  if mid is not null then
    perform str_aux.upsert_sample_5s(
      s, p_event_ts,
      mid - 0.5, mid + 0.5, 0, 0,
      0, 0, 0, 0,
      0, 0, '{}'::jsonb
    );
  end if;
end
$$;

create or replace function sp_ingest_ticker_payload(p_payload jsonb)
returns void
language plpgsql
as $$
declare s text; evt bigint; pr numeric; qty numeric; taker bool; ts timestamptz;
begin
  s   := upper(p_payload->>'s');
  evt := coalesce((p_payload->>'E')::bigint, (p_payload->>'T')::bigint);
  pr  := coalesce((p_payload->>'p')::numeric, (p_payload->>'c')::numeric);
  qty := coalesce((p_payload->>'q')::numeric, (p_payload->>'Q')::numeric);
  taker := coalesce((p_payload->>'m')::boolean, null);
  if s is null or evt is null then return; end if;
  ts := to_timestamp(evt/1000.0);

  perform ingest.sp_accept_symbol(s);

  insert into ingest.ticker_raw(symbol, event_time_ms, price, qty, is_buyer_maker, payload)
  values (s, evt, pr, qty, taker, coalesce(p_payload,'{}'::jsonb));

  if pr is not null then
    perform str_aux.upsert_sample_5s(
      s, ts,
      pr - 0.5, pr + 0.5, 0, 0,
      0, 0, 0, 0,
      0, 0, '{}'::jsonb
    );
  end if;
end
$$;

create or replace function sp_ingest_kline_row(
  p_symbol text,
  p_interval text,
  p_open_time timestamptz,
  p_close_time timestamptz,
  p_open numeric,
  p_high numeric,
  p_low  numeric,
  p_close numeric,
  p_volume numeric,
  p_trades int,
  p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
as $$
declare s text := upper(p_symbol);
begin
  perform ingest.sp_accept_symbol(s);

  insert into ingest.kline_raw(symbol, interval_label, open_time_ms, close_time_ms,
                               open_price, high_price, low_price, close_price,
                               volume, trades, payload)
  values (
    s, lower(p_interval),
    (extract(epoch from p_open_time)*1000)::bigint,
    (extract(epoch from p_close_time)*1000)::bigint,
    p_open, p_high, p_low, p_close,
    p_volume, p_trades, coalesce(p_payload,'{}'::jsonb)
  )
  on conflict (symbol, interval_label, close_time_ms) do update
    set open_price  = excluded.open_price,
        high_price  = excluded.high_price,
        low_price   = excluded.low_price,
        close_price = excluded.close_price,
        volume      = excluded.volume,
        trades      = excluded.trades,
        payload     = excluded.payload;

  -- Reflect kline close into str_aux as a deterministic sample
  perform str_aux.upsert_sample_5s(
    s, p_close_time,
    p_close - 0.5, p_close + 0.5, 0, 0,
    0, 0, 0, 0,
    0, 0, jsonb_build_object('interval', lower(p_interval))
  );
end
$$;

-- ============================================================================
-- 7) Autonomy signals (NOTIFY when universe changes; daemon LISTENs)
-- ============================================================================
create or replace function settings.trg_coin_universe_autonotify()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify('settings_universe_changed', coalesce(new.symbol, old.symbol));
  return null;
end
$$;

drop trigger if exists t_autonotify_coin_universe_ins on settings.coin_universe;
create trigger t_autonotify_coin_universe_ins
after insert on settings.coin_universe
for each statement execute function settings.trg_coin_universe_autonotify();

drop trigger if exists t_autonotify_coin_universe_upd on settings.coin_universe;
create trigger t_autonotify_coin_universe_upd
after update on settings.coin_universe
for each statement execute function settings.trg_coin_universe_autonotify();

drop trigger if exists t_autonotify_coin_universe_del on settings.coin_universe;
create trigger t_autonotify_coin_universe_del
after delete on settings.coin_universe
for each statement execute function settings.trg_coin_universe_autonotify();

-- ============================================================================
-- 8) Batch rollers (cron/ops helpers)
-- ============================================================================
create or replace function tick_all()
returns void
language plpgsql
as $$
begin
  perform str_aux.try_roll_all_windows_now_for_all();
end
$$;

create or replace function backfill_all_between(_from timestamptz, _to timestamptz)
returns text
language plpgsql
as $$
declare r record; sum_cycles int := 0; sum_wins int := 0; res text;
begin
  for r in select symbol from settings.coin_universe where enabled loop
    res := str_aux.backfill_symbol_between(r.symbol, _from, _to, 'default');
    begin
      sum_cycles := sum_cycles + (regexp_replace(res, '.*cycles=([0-9]+).*', '\1')::int);
      sum_wins   := sum_wins   + (regexp_replace(res, '.*windows=([0-9]+).*', '\1')::int);
    exception when others then null;
    end;
  end loop;
  return format('cycles=%s windows=%s', sum_cycles, sum_wins);
end
$$;

-- ============================================================================
-- 9) Grants (adjust to your roles)
-- ============================================================================
do $do$
begin
  if exists (select 1 from pg_roles where rolname='cp_reader') then
    grant usage on schema ingest to cp_reader;
    grant select on all tables in schema ingest to cp_reader;
    alter default privileges in schema ingest grant select on tables to cp_reader;
  end if;

  if exists (select 1 from pg_roles where rolname='cp_writer') then
    grant usage on schema ingest to cp_writer;
    grant insert, select, update on all tables in schema ingest to cp_writer;
    grant execute on function
      ingest.v_targets_stale(int),
      ingest.sp_sync_universe_to_market(),
      ingest.sp_accept_symbol(text, text),
      ingest.sp_accept_symbols(text[], text),
      ingest.sp_ingest_book_tick(text, timestamptz, numeric, numeric, jsonb),
      ingest.sp_ingest_ticker_payload(jsonb),
      ingest.sp_ingest_kline_row(text, text, timestamptz, timestamptz, numeric, numeric, numeric, numeric, numeric, int, jsonb),
      ingest.tick_all(),
      ingest.backfill_all_between(timestamptz, timestamptz)
    to cp_writer;
  end if;

  if exists (select 1 from pg_roles where rolname='cryptopill_jobs') then
    grant usage on schema ingest to cryptopill_jobs;
    grant insert, select on all tables in schema ingest to cryptopill_jobs;
    grant execute on function
      ingest.v_targets_stale(int),
      ingest.sp_sync_universe_to_market(),
      ingest.sp_accept_symbol(text, text),
      ingest.sp_accept_symbols(text[], text),
      ingest.sp_ingest_book_tick(text, timestamptz, numeric, numeric, jsonb),
      ingest.sp_ingest_ticker_payload(jsonb),
      ingest.sp_ingest_kline_row(text, text, timestamptz, timestamptz, numeric, numeric, numeric, numeric, numeric, int, jsonb),
      ingest.tick_all(),
      ingest.backfill_all_between(timestamptz, timestamptz)
    to cryptopill_jobs;
  end if;
end
$do$;

-- ============================================================================
-- 10) Sanity guard (notice only)
-- ============================================================================
-- replace your last DO block with this exact version
do $do$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'market'
      and p.proname = 'ensure_symbol'
      and p.oid::regprocedure::text like 'ensure_symbol(text)'
  ) then
    raise notice 'market.ensure_symbol(text) exists; prefer market.sp_upsert_symbol(...) if available.';
  end if;
end
$do$;


-- End of 16_ingest.sql
