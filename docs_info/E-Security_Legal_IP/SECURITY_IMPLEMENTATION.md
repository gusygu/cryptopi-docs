SECURITY_IMPLEMENTATION.md
1. Overview

Concrete details of how CryptoPill enforces security across DDL, RLS, API guards, sessions, secrets, and environment boundaries.

2. Database Roles & Grants (DDL-Level)
2.1 Role Set

cp_admin — Full DDL/DML in dev; migration-only in prod.

cp_writer — Insert/update/delete on business tables.

cp_reader — Read-only access.

cp_jobs — Write access to ingest + derived tables only.

cp_anonymous — Minimal rights; can only access explicitly allowed objects.

cp_auth_user (optional) — Maps application users to DB RLS filters.

2.2 Global DDL Hardening

Revoke public privileges on DB and schemas.

Explicit search_path for all roles.

Role-specific statement_timeout.

2.3 Grants Structure

Tables in settings, market, matrices, str_aux, cin_aux, mea_dynamics, ops are grouped and granted per role.

revoke all on database cryptopi from public;
grant connect on database cryptopi to cp_admin, cp_writer, cp_reader, cp_jobs;

Each schema defines default privileges for future tables.

3. Row-Level Security (RLS)
3.1 User-Bound Tables

If a table contains user-contextual data:

alter table wallet.accounts enable row level security;
create policy wallet_accounts_is_owner
  on wallet.accounts
  using (user_id = current_setting('cp.current_user_id', true)::uuid)
  with check (user_id = current_setting('cp.current_user_id', true)::uuid);
3.2 Application Binding

API-level DB wrappers must set:

select set_config('cp.current_user_id', $1, true);

before running any user-sensitive query.

4. API Guards
4.1 Session Validation

All privileged routes must:

Validate user session.

Reject 401 if unauthenticated.

Run DB queries via wrapper that sets cp.current_user_id.

4.2 Admin Routes

Require elevated role in session.

Optionally restrict by email/domain.

4.3 Input Validation

Every route uses zod schemas.

Reject malformed inputs early.

5. Secrets Management

Never commit secrets.

Use .env only in dev.

In prod: rely on platform’s secret manager.

Rotate keys periodically.

6. Testing & Verification

Unit tests for guards.

Integration tests for RLS.

Smoke tests against protected endpoints.