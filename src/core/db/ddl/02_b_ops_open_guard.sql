create or replace function ops.open_all_sessions_guarded(
  p_app_name    text,
  p_app_version text,
  p_schemas     text[] default array['settings','market','documents','wallet','matrices','str_aux','cin_aux','mea_aux']::text[]
)
returns int
language plpgsql
as $$
declare
  v_locked boolean;
  v_key    bigint := hashtext('ops.open_all_sessions.guard');
  v_count  int := 0;
begin
  select pg_try_advisory_lock(v_key) into v_locked;
  if not v_locked then
    return 0; -- another process is doing it
  end if;

  begin
    v_count := ops.open_all_sessions(p_app_name, p_app_version, p_schemas);
    perform pg_advisory_unlock(v_key);
    return v_count;
  exception when others then
    perform pg_advisory_unlock(v_key);
    raise;
  end;
end
$$;
