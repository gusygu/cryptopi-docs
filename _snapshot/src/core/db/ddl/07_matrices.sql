-- 07_matrices.sql
set search_path = matrices, public;

-- A) SERIES
create table if not exists series (
  id         uuid primary key default gen_random_uuid(),
  key        text unique,
  name       text,
  scope      text,
  unit       text,
  target     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- B) POINTS
create table if not exists points (
  series_id  uuid not null references matrices.series(id) on delete cascade,
  ts         timestamptz not null,
  value      numeric not null,
  attrs      jsonb not null default '{}'::jsonb,
  primary key (series_id, ts)
);
create index if not exists ix_points_series_ts on points(series_id, ts desc);

-- C) VIEW: series + symbol (soft link via target->>'symbol')
create or replace view v_series_symbol as
select s.id, s.key, s.name, s.scope, s.unit,
       (s.target->>'symbol')::text as symbol,
       s.target
from matrices.series s;

-- D) VIEW: latest point per series
create or replace view v_latest_points as
select p.series_id, (select key from matrices.series s where s.id = p.series_id) as series_key,
       p.ts, p.value, p.attrs
from (
  select distinct on (series_id) series_id, ts, value, attrs
  from matrices.points
  order by series_id, ts desc
) p;

-- E) HELPERS
create or replace function sp_ensure_series(
  _key text,
  _name text default null,
  _scope text default null,
  _unit text default null,
  _target jsonb default '{}'::jsonb
) returns uuid language plpgsql as $$
declare sid uuid;
begin
  insert into matrices.series(key, name, scope, unit, target)
  values (_key, _name, _scope, _unit, coalesce(_target,'{}'::jsonb))
  on conflict (key) do update
    set name   = coalesce(excluded.name,   matrices.series.name),
        scope  = coalesce(excluded.scope,  matrices.series.scope),
        unit   = coalesce(excluded.unit,   matrices.series.unit),
        target = case
                   when excluded.target is null or excluded.target = '{}'::jsonb
                   then matrices.series.target
                   else excluded.target
                 end
  returning id into sid;
  return sid;
end$$;

create or replace function sp_put_point(
  _series_key text,
  _ts timestamptz,
  _value numeric,
  _attrs jsonb default '{}'::jsonb
) returns void language plpgsql as $$
declare sid uuid;
begin
  sid := sp_ensure_series(_series_key, null, null, null, '{}'::jsonb);
  insert into matrices.points(series_id, ts, value, attrs)
  values (sid, _ts, _value, coalesce(_attrs,'{}'::jsonb))
  on conflict (series_id, ts) do update
    set value = excluded.value,
        attrs = excluded.attrs;
end$$;

create or replace function sp_put_points_bulk(
  _series_key text,
  _rows jsonb
) returns int language plpgsql as $$
declare sid uuid; r jsonb; n int := 0;
begin
  sid := sp_ensure_series(_series_key, null, null, null, '{}'::jsonb);
  for r in select * from jsonb_array_elements(coalesce(_rows,'[]'::jsonb)) loop
    insert into matrices.points(series_id, ts, value, attrs)
    values (sid, (r->>'ts')::timestamptz, (r->>'value')::numeric, coalesce(r->'attrs','{}'::jsonb))
    on conflict (series_id, ts) do update
      set value = excluded.value,
          attrs = excluded.attrs;
    n := n + 1;
  end loop;
  return n;
end$$;
