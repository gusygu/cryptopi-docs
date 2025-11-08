-- Cycle Documents (per-cycle JSON audit for matrices, mea, cin, str)
-- One document per domain + app_session_id + cycle_ts
-- Use BIGINT epoch milliseconds consistently.

create table if not exists public.cycle_documents (
  domain           text        not null
    check (domain in ('matrices','mea','cin','str')),
  app_session_id   text        not null,
  cycle_ts         bigint      not null,         -- epoch ms (cycle boundary)
  payload          jsonb       not null,         -- full cycle “document” for the domain
  created_at       timestamptz not null default now(),
  -- optional: pointer fields for quick peeks (kept nullable to avoid strict coupling)
  pairs_count      int,
  rows_count       int,
  notes            text,
  constraint cycle_documents_pkey
    primary key (domain, app_session_id, cycle_ts)
);

-- Fast lookups for “latest per domain/app_session”
create index if not exists idx_cycle_documents_latest
  on public.cycle_documents (domain, app_session_id, cycle_ts desc);

-- Time & inspection helpers
create index if not exists idx_cycle_documents_created
  on public.cycle_documents (created_at desc);

-- JSONB inspection (filtering by keys occasionally)
create index if not exists idx_cycle_documents_payload_gin
  on public.cycle_documents using gin (payload);

comment on table public.cycle_documents is
  'Per-cycle JSON audit documents for matrices, mea, cin, str (one row per domain/app_session_id/cycle_ts).';

-- Helper: upsert one document (idempotent)
create or replace function public.upsert_cycle_document(
  p_domain         text,
  p_app_session_id text,
  p_cycle_ts       bigint,
  p_payload        jsonb,
  p_pairs_count    int default null,
  p_rows_count     int default null,
  p_notes          text default null
) returns void
language plpgsql
as $$
begin
  insert into public.cycle_documents (domain, app_session_id, cycle_ts, payload, pairs_count, rows_count, notes)
  values (p_domain, p_app_session_id, p_cycle_ts, p_payload, p_pairs_count, p_rows_count, p_notes)
  on conflict (domain, app_session_id, cycle_ts) do update
  set payload      = excluded.payload,
      pairs_count  = excluded.pairs_count,
      rows_count   = excluded.rows_count,
      notes        = excluded.notes,
      created_at   = now();
end;
$$;

-- (Optional) simple “latest doc” view per domain/app_session
create or replace view public.v_cycle_documents_latest as
select distinct on (domain, app_session_id)
       domain, app_session_id, cycle_ts, payload, created_at, pairs_count, rows_count, notes
from public.cycle_documents
order by domain, app_session_id, cycle_ts desc;

-- NOTE: role grants can be added after we finalize roles:
--   grant select on public.cycle_documents, public.v_cycle_documents_latest to cp_app;
--   grant insert, update on public.cycle_documents to cp_writer;
