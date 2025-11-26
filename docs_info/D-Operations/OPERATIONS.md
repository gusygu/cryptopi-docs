OPERATIONS.md — CryptoPill Core

Audience: operators, SRE-ish devs, and anyone who has to keep the app alive.

Scope: how to bring the system up, keep it running day to day, and perform basic triage when something looks off.

1. Mental model of "operations" in CryptoPill

The system is split into a few big moving parts:

PostgreSQL

Holds everything: settings, market universe, sampling windows, matrices, ledgers, ops logs.

Schema-first, DDL-driven. All structure changes flow through the DDL pack.

Web app (Next.js + API routes)

Runs the client UI and API endpoints for sampling, matrices, wallet, etc.

In dev: pnpm dev.

In prod: a Node process (e.g. pnpm start) behind a reverse proxy.

Jobs / daemons

TypeScript/TSX scripts that:

Talk to Binance.

Ingest and normalize market data.

Derive windows, vectors and matrices.

Refresh internal state in bursts or via small loops.

Orchestrated via scripts/jobs/run-all.ts and specialized helpers.

Ops / session stamping

ops.session_log and ops.session_flags record when each schema is considered "open" for a given app build.

scripts/ops-open-all-session.mts calls ops.open_all_sessions(app_name, app_version) and flips the boolean "session open" stamp for all participating schemas.

Smokes & diagnostics

A small library of SQL and TSX smokes under scripts/smokes/.

Used after boot/deploy to validate that both DB and HTTP surfaces behave as expected.

Operationally, a healthy system is:

DB reachable, DDLs applied, migrations in sync.

At least one web app instance responding with correct data.

At least one job runner keeping windows and matrices fresh.

Session stamps updated for the current build.

Smokes passing for a representative symbol set.

2. Environment expectations

Before running anything, make sure these are configured:

DATABASE_URL (or equivalent Postgres connection string)

APP_NAME (optional, defaults to cryptopi-dynamics)

APP_VERSION (optional, defaults to dev)

ORIGIN (for HTTP smokes, default http://localhost:3000)

SYMBOLS / SYMBOL (optional, defaults differ per script)

You can centralize environment loading via scripts/env/load-env.cjs and a .env file at the repo root. A common pattern in dev is:

node scripts/env/load-env.cjs pnpm dev

or directly via dotenv in TSX scripts (most of them already do import "dotenv/config";).

3. Booting a fresh environment (dev)

This is the high-level sequence for a fresh dev environment:

3.1. Start Postgres

Either a local Postgres install or a container.

Ensure DATABASE_URL points to the right database.

3.2. Apply DDL pack

All schema structure is managed by the DDL pack under src/core/db/ddl and applied via scripts/db/run-ddls.mts / scripts/db/apply/apply-ddls.mts.

Typical dev usage:

# Apply the full pack in order
pnpm tsx src/scripts/db/run-ddls.mts


# Dry-run to see which files would be applied
pnpm tsx src/scripts/db/run-ddls.mts --dry-run


# Restart from a specific prefix (e.g. re-run from str-aux)
pnpm tsx src/scripts/db/run-ddls.mts --from 06_


# Apply only a specific file (e.g. 08_str-aux)
pnpm tsx src/scripts/db/run-ddls.mts --only 08_str-aux

Behind the scenes this will:

Ensure schemas exist (settings, market, matrices, str_aux, cin_aux, mea_dynamics, ops, etc.).

Install extensions.

Create tables, views, functions, roles, grants and RLS policies.

Operator rule: never hand-apply DDL in prod; always go through the DDL pack + MIGRATIONS.md process.

3.3. Seed baseline universe (if applicable)

Depending on the project phase, there may be seed scripts to:

Populate settings (coin universe CSR/SSR, default windows, etc.).

Load a demo session for matrices and mood.

Seed minimal wallets or reference data.

These may live under src/core/db/seeds or in dedicated TS/TSX scripts. Refer to DATABASE.md/MIGRATIONS.md for the detailed, environment-specific seed process.

3.4. Stamp sessions

Once the DB is structurally correct, stamp all relevant schemas as "open" for this app build:

APP_NAME="cryptopi-dynamics" \
APP_VERSION="0.1.1-dev" \
DATABASE_URL="postgres://..." \
node scripts/ops-open-all-session.mts

This calls ops.open_all_sessions(app_name, app_version) and records in ops.session_flags that:

Each participating schema is open.

With a specific app_name and app_version.

At a precise opened_at timestamp.

Views like matrices.v_session_open and str_aux.v_session_open can then expose that boolean stamp in a schema-local way.

3.5. Start the web app (dev)

In dev mode, the usual flow is:

pnpm dev

This should:

Start the Next.js dev server on http://localhost:3000 (configurable).

Expose API routes under /api/... for sampling, matrices, wallet, etc.

After the server boots:

Open the client UI and verify it renders core screens without throwing (see CLIENT_GUIDE.md).

3.6. Start jobs/daemons

Jobs are scripts under scripts/jobs/ that:

Talk to Binance and other providers.

Ingest OHLCV and book-level data.

Derive windows, vectors, matrices and mood tiers.

The canonical entry point is scripts/jobs/run-all.ts.

Typical usage:

# Run the job orchestrator directly
pnpm tsx src/scripts/jobs/run-all.ts


# Or via a package.json script (recommended)
pnpm jobs:run

At a high level, run-all will:

Spin up the ingest/sampling loop.

Ensure window computations are running.

Attach any necessary telemetry/logging.

Operator rule: for prod, use a process manager (systemd, PM2, etc.) to keep run-all (or equivalent) alive. Treat it like an app service, not a one-shot command.

4. Day-to-day operations
4.1. Daily checklist (dev/staging)

DB up?

psql "$DATABASE_URL" -c 'select now()' should succeed.

DDL in sync?

Check the latest DDL pack applied; if new DDLs exist, apply via run-ddls.mts following MIGRATIONS.md.

Session open?

select * from ops.session_flags order by updated_at desc limit 10;

Should show is_open = true for key schemas.

App responding?

curl -I http://localhost:3000 -> 200 or 302.

UI renders main dashboards.

Jobs running?

Check logs for run-all.

Verify new windows/vectors are being created (e.g. select max(ts) from str_aux.sampling;).

Smokes green?

Run a small subset of smokes (see SMOKES.md).

4.2. Simple triage playbook

When something looks wrong in the UI:

Confirm the symptom

Is it missing data? stale data? HTTP 500s? visual glitches?

Check the API endpoint behind the UI

Use curl or Insomnia/Postman.

If API returns good JSON, suspect UI; otherwise, suspect jobs or DB.

Check jobs

Is run-all running?

Are there errors in logs about Binance, rate limits, or DB issues?

Run targeted smokes

For sampling issues, run str-aux-sampling-smoke.mts.

For IDHR/vector weirdness, run str-aux-idhr-smoke.mts and diagnostics-str-aux-package.sql.

Look at ops/session logs

select * from ops.session_log order by created_at desc limit 50;

Spot recent failures or abnormal restarts.

If the problem is not obvious after these steps, capture:

Exact error messages.

The output of relevant smokes.

The most recent lines of job logs.

…and escalate to more detailed debugging (see DEBUGGING_PLAYBOOK.md).

5. Basic production posture

This section is a starting point and should be revisited once the deployment story is fully stabilized.

5.1. Processes

Run at least three logical processes (can be on the same or different machines):

Web app (Next.js in prod mode):

Behind a reverse proxy (nginx/Caddy/etc.).

With environment locked via .env or secret manager.

Job orchestrator (run-all or equivalent):

Kept alive via systemd/PM2.

Logs shipped to a central place or at least rotated locally.

Database (managed Postgres or self-hosted):

Backed up regularly (see BACKUP_AND_RECOVERY.md).

5.2. Health checks

HTTP:

/api/health (if implemented) or a lightweight endpoint that hits the DB.

Integration with your hosting platform's health check.

DB:

Basic select 1 liveness probe.

Optionally track replication lag or bloat metrics.

Jobs:

Simple watchdog that checks the maximum ts in sampling/matrices tables.

5.3. Configuration drift

All production changes to DDL go through versioned files + MIGRATIONS.md.

All env changes are tracked (at least in a private, operator-only log).

6. Hand-off checklists

When handing the system to another operator, provide at minimum:

Current APP_VERSION and associated tag.

Latest DDL pack applied.

Current DB size and backup retention policy.

Locations of:

Web app logs.

Job logs.

Any external monitoring dashboards.

A copy/link to this OPERATIONS.md and SMOKES.md.