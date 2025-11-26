-- 33_admin_action_log.sql — admin action logging

BEGIN;

CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.admin_action_log (
  action_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performed_by   uuid,               -- auth.user_account.user_id
  performed_email text,              -- convenience
  target_user_id uuid,               -- optional, for user-related actions
  target_email   text,               -- convenience
  action_type    text NOT NULL,      -- e.g. "user.set_admin", "user.set_status", "invite.approve"
  action_scope   text,               -- e.g. "auth", "invites", "users"
  message        text,               -- human readable summary
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_admin_action_log_created_at
  ON ops.admin_action_log (created_at DESC);

CREATE INDEX IF NOT EXISTS ix_admin_action_log_performed_by
  ON ops.admin_action_log (performed_by);

CREATE INDEX IF NOT EXISTS ix_admin_action_log_target_user_id
  ON ops.admin_action_log (target_user_id);

GRANT USAGE ON SCHEMA ops TO cp_app, cp_writer, cp_reader;
GRANT SELECT ON ops.admin_action_log TO cp_reader;
GRANT SELECT, INSERT ON ops.admin_action_log TO cp_app, cp_writer;

COMMIT;

-- 34_jobs_status.sql — job / ingest runs

BEGIN;

CREATE SCHEMA IF NOT EXISTS ops;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'ops'::regnamespace
      AND typname = 'job_status'
  ) THEN
    CREATE TYPE ops.job_status AS ENUM ('success', 'error', 'running', 'queued', 'skipped');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ops.job_run (
  run_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name      text NOT NULL,      -- e.g. "str-aux/sampler", "matrices/refresh"
  job_type      text,               -- e.g. "ingest", "maintenance", "calc"
  status        ops.job_status NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  duration_ms   integer,            -- convenience

  error_message text,
  error_stack   text,

  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_job_run_job_name_started_at
  ON ops.job_run (job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS ix_job_run_status_started_at
  ON ops.job_run (status, started_at DESC);

GRANT USAGE ON SCHEMA ops TO cp_app, cp_writer, cp_reader;

GRANT SELECT ON ops.job_run TO cp_reader;
GRANT SELECT, INSERT, UPDATE ON ops.job_run TO cp_app, cp_writer;

COMMIT;
