-- 32_auth_invites.sql — auth + invites + basic user accounts

BEGIN;

-- =========================================================
-- Schema
-- =========================================================
CREATE SCHEMA IF NOT EXISTS auth;

-- =========================================================
-- Enums
-- =========================================================

DO $$
BEGIN
  CREATE TYPE auth.invite_request_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END$$;

DO $$
BEGIN
  CREATE TYPE auth.invite_status AS ENUM ('issued', 'used', 'revoked', 'expired');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END$$;

DO $$
BEGIN
  CREATE TYPE auth.user_status AS ENUM ('active', 'suspended', 'invited');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END$$;

-- =========================================================
-- Tables
-- =========================================================

-- 1) Pedido de convite (pre-registro)
CREATE TABLE IF NOT EXISTS auth.invite_request (
  request_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                text NOT NULL,
  nickname             text,
  note                 text,

  status               auth.invite_request_status NOT NULL DEFAULT 'pending',

  -- metadata opcional (útil p/ auditoria / anti-abuso depois)
  requested_from_ip    inet,
  requested_user_agent text,

  approved_by_user_id  uuid,
  rejected_by_user_id  uuid,
  approved_at          timestamptz,
  rejected_at          timestamptz,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_invite_request_email
  ON auth.invite_request (lower(email));

CREATE INDEX IF NOT EXISTS ix_invite_request_status
  ON auth.invite_request (status);


-- 2) Token de convite emitido por admin
CREATE TABLE IF NOT EXISTS auth.invite_token (
  invite_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid REFERENCES auth.invite_request(request_id) ON DELETE SET NULL,

  email            text NOT NULL,
  token            text NOT NULL UNIQUE,

  status           auth.invite_status NOT NULL DEFAULT 'issued',

  expires_at       timestamptz,
  used_at          timestamptz,

  created_by_user_id uuid,
  used_by_user_id    uuid,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_invite_token_email
  ON auth.invite_token (lower(email));

CREATE INDEX IF NOT EXISTS ix_invite_token_status
  ON auth.invite_token (status);

CREATE INDEX IF NOT EXISTS ix_invite_token_expires_at
  ON auth.invite_token (expires_at);


-- 3) Conta de usuário (registro final)
CREATE TABLE IF NOT EXISTS auth.user_account (
  user_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  email          text NOT NULL UNIQUE,
  nickname       text,
  is_admin       boolean NOT NULL DEFAULT false,

  -- opcional: se quiser senha depois; pode ficar NULL p/ magic-link etc.
  password_hash  text,

  invite_id      uuid REFERENCES auth.invite_token(invite_id) ON DELETE SET NULL,

  status         auth.user_status NOT NULL DEFAULT 'active',

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz,

  meta           jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_user_account_status
  ON auth.user_account (status);


-- =========================================================
-- Grants básicos
-- =========================================================

GRANT USAGE ON SCHEMA auth
  TO cp_app, cp_writer, cp_reader;

GRANT SELECT ON ALL TABLES IN SCHEMA auth
  TO cp_reader;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth
  TO cp_app, cp_writer;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT SELECT ON TABLES TO cp_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cp_app, cp_writer;

COMMIT;
