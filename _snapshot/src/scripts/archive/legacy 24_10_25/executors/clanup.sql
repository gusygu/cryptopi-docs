-- core/db/cleanup.sql
do $$
begin
  if to_regclass('public.cin_aux_metrics') is not null then
    execute 'truncate table public.cin_aux_metrics restart identity cascade';
  end if;

  if to_regclass('public.cin_aux_cycle') is not null then
    execute 'truncate table public.cin_aux_cycle restart identity cascade';
  end if;
end
$$;
