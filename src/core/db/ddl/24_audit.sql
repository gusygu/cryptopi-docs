BEGIN;

-- Request context helpers
CREATE OR REPLACE FUNCTION auth.set_request_context(
  p_user_id uuid,
  p_is_admin boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('app.current_user_id', COALESCE(p_user_id::text, ''), false);
  PERFORM set_config('app.current_is_admin', CASE WHEN p_is_admin THEN 'true' ELSE 'false' END, false);
END;
$$;

CREATE OR REPLACE FUNCTION auth.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.current_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.current_is_admin', true) = 'true';
$$;

CREATE SCHEMA IF NOT EXISTS audit;

-- Per-user cycle log
CREATE TABLE IF NOT EXISTS audit.user_cycle_log (
  cycle_log_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      uuid NOT NULL REFERENCES auth."user"(user_id) ON DELETE CASCADE,
  cycle_seq          bigint NOT NULL,
  session_id         uuid REFERENCES cin_aux.sessions(session_id) ON DELETE SET NULL,
  status             text NOT NULL,
  summary            text,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_user_cycle_log_owner_cycle
  ON audit.user_cycle_log (owner_user_id, cycle_seq DESC);

-- STR-aux sampling log
CREATE TABLE IF NOT EXISTS audit.str_sampling_log (
  sampling_log_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      uuid NOT NULL REFERENCES auth."user"(user_id) ON DELETE CASCADE,
  cycle_seq          bigint,
  symbol             text NOT NULL,
  window_label       text NOT NULL,
  sample_ts          timestamptz,
  status             text NOT NULL,
  message            text,
  meta               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_str_sampling_owner_time
  ON audit.str_sampling_log (owner_user_id, created_at DESC);

-- User-submitted reports (mini-letters)
CREATE TABLE IF NOT EXISTS audit.user_reports (
  report_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      uuid NOT NULL REFERENCES auth."user"(user_id) ON DELETE CASCADE,
  cycle_seq          bigint,
  category           text NOT NULL,
  severity           text NOT NULL,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  acknowledged_by    uuid REFERENCES auth."user"(user_id),
  acknowledged_at    timestamptz
);
CREATE INDEX IF NOT EXISTS ix_user_reports_owner_time
  ON audit.user_reports (owner_user_id, created_at DESC);

-- Error queue (system + user)
CREATE TABLE IF NOT EXISTS audit.error_queue (
  error_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin             text NOT NULL CHECK (origin IN ('user', 'system')),
  owner_user_id      uuid REFERENCES auth."user"(user_id) ON DELETE SET NULL,
  cycle_seq          bigint,
  summary            text NOT NULL,
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'open',
  created_at         timestamptz NOT NULL DEFAULT now(),
  resolved_by        uuid REFERENCES auth."user"(user_id),
  resolved_at        timestamptz
);
CREATE INDEX IF NOT EXISTS ix_error_queue_status_time
  ON audit.error_queue (status, created_at DESC);

-- System vitals snapshots
CREATE TABLE IF NOT EXISTS audit.vitals_log (
  vitals_id          bigserial PRIMARY KEY,
  snapshot_ts        timestamptz NOT NULL DEFAULT now(),
  payload            jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_vitals_log_ts
  ON audit.vitals_log (snapshot_ts DESC);

COMMIT;
