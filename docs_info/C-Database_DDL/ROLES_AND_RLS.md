ROLES_AND_RLS.md
Purpose

This document defines the role model, privilege layers, and row‑level security (RLS) concepts used across CryptoPi. The system follows a clean separation of concerns: each role has a narrow scope, every schema has explicit grants, and RLS is applied only where necessary and always in a predictable pattern.

CryptoPi assumes that the database itself is a security boundary, not only the API. This requires a disciplined and transparent permission model.

1. Role Model Overview

Roles are divided into three layers:

A) System / Application Roles

These are used by the running application or its daemons.

cryptopill_api — the main API surface (Next.js routes).

cryptopill_jobs — background jobs, daemons, samplers.

cryptopill_read — read‑only access for public or semi‑public UI features.

These roles are not meant for humans.

B) Human Roles (Admin / Dev)

cp_admin — superuser of the application domain.

Full access to all schemas except dangerous superuser privileges.

Can run migrations, update settings, inspect flows.

cp_writer — developer/operator with write access to core schemas.

Can modify settings, market, matrices, etc.

Cannot modify lower‑level system structures.

cp_reader — read‑only access to public and diagnostic views.

Safe to grant to analysts or observers.

These roles are granted to humans for maintenance and introspection.

C) Schema‑Specific Internal Roles

Some schemas may define internal helper roles (rare):

Example: a role used for RLS bypass in staging.

Example: a role for ingest tests.

These are kept minimal and always documented within their schema pack.

2. Grants & Permissions Strategy

Nearly all permissions are granted schema‑by‑schema, never globally.

A) Schema Usage Grants

Every schema begins with:

GRANT USAGE ON SCHEMA <schema> TO <role>;

This allows discovery of objects inside the schema.

B) Object‑Level Grants

Tables and views explicitly grant:

SELECT access to cp_reader / cryptopill_read

SELECT, INSERT, UPDATE to cp_writer / cryptopill_jobs

ALL PRIVILEGES to cp_admin

No wildcard grants are used. Each table lists its grants individually.

3. Row‑Level Security (RLS)

RLS is used sparingly and only where semantically meaningful.

General rules:

RLS is off by default for all tables unless explicitly required.

When RLS is on, each table has:

a base policy for readers (read only)

a writer policy for structured writes

an admin bypass allowing cp_admin full access

RLS policies always follow the structure:

CREATE POLICY <name> ON <table>
  FOR <action>
  TO <role>
  USING (<boolean expression>)
  WITH CHECK (<boolean expression>);
4. Where RLS Is Used
A) wallet.moves

RLS ensures users only see their own moves.

Policies:

cp_reader / cryptopill_read → see only moves where account_id belongs to the user.

cp_writer / cryptopill_jobs → create/update moves for valid accounts.

cp_admin → bypass.

B) account‑level tables

RLS applies similar constraints based on account ownership.

C) docs schema (optional)

If documentation packs include sensitive information, RLS may restrict who can see which pack hashes.

D) ingest (rare)

RLS is almost never enabled here, but may be applied if ingest data becomes user‑scoped.

5. Policy Naming Conventions

Policies follow a strict naming pattern:

{table}_select

{table}_write

{table}_admin

This keeps migrations readable and diffable.

6. Best Practices

Never rely on API‑side filtering alone.

Apply RLS only where multi‑tenant or user‑specific boundaries exist.

Keep RLS expressions simple and based on stable keys.

Always test RLS by trying selects/inserts under each role.

7. Example RLS Pattern
ALTER TABLE wallet.moves ENABLE ROW LEVEL SECURITY;


CREATE POLICY wallet_moves_reader
  ON wallet.moves
  FOR SELECT
  TO cp_reader
  USING (true);


CREATE POLICY wallet_moves_writer
  ON wallet.moves
  FOR INSERT, UPDATE
  TO cp_writer
  WITH CHECK (true);


CREATE POLICY wallet_moves_admin
  ON wallet.moves
  FOR ALL
  TO cp_admin
  USING (true)
  WITH CHECK (true);

This pattern repeats across all RLS‑enabled tables.