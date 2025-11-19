-- 02a_ops__session_stamp.sql
create schema if not exists ops;

-- one row per app boot
create table if not exists ops.session_log (
  session_id  uuid primary key default gen_random_uuid(),
  app_name    text not null,
  app_version text not null,
  opened_at   timestamptz not null default now(),
  host        text,
  pid         integer,
  note        text
);

-- one row per schema to flag "open"
create table if not exists ops.session_flags (
  schema_name text primary key,
  is_open     boolean not null default false,
  opened_at   timestamptz,
  opened_by   uuid references ops.session_log(session_id) on delete set null,
  updated_at  timestamptz not null default now()
);

create or replace function ops.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_session_flags_touch on ops.session_flags;
create trigger trg_session_flags_touch
before update on ops.session_flags
for each row execute procedure ops.touch_updated_at();

-- open one schema
create or replace function ops.open_schema(p_schema text, p_session uuid)
returns void language plpgsql as $$
begin
  insert into ops.session_flags as f(schema_name, is_open, opened_at, opened_by)
  values (p_schema, true, now(), p_session)
  on conflict (schema_name) do update
    set is_open  = true,
        opened_at = excluded.opened_at,
        opened_by = excluded.opened_by;
end$$;

-- optional close helper
create or replace function ops.close_schema(p_schema text)
returns void language plpgsql as $$
begin
  update ops.session_flags
     set is_open = false
   where schema_name = p_schema;
end$$;

-- one-call opener (defaults to common schemas, adjust as needed)
create or replace function ops.open_all_sessions(
  p_app_name    text,
  p_app_version text,
  p_schemas     text[] default array['settings','market','documents','wallet','matrices','str_aux','cin_aux','mea_aux']::text[]
)
returns int language plpgsql as $$
declare
  v_session uuid;
  v_count   int := 0;
  s text;
begin
  insert into ops.session_log (app_name, app_version, host, pid)
  values (p_app_name, p_app_version, inet_client_addr()::text, pg_backend_pid())
  returning session_id into v_session;

  foreach s in array p_schemas loop
    perform ops.open_schema(s, v_session);
    v_count := v_count + 1;
  end loop;

  return v_count;
end$$;

create or replace view ops.v_session_flags as
select schema_name, is_open, opened_at, opened_by, updated_at
from ops.session_flags
order by schema_name;
