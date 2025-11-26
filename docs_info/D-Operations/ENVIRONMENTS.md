ENVIRONMENTS.md — Dev / Staging / Prod

Audience: devs and operators who need to understand where the app runs and which knobs exist per environment.

Scope: definition of environments, core env vars, .env usage, and how jobs interact with each environment.

1. Environments at a glance

CryptoPill assumes three logical environments:

dev

Local machine.

Fast iteration, frequent resets, experimental DDL.

Secrets live in a local .env file.

staging (optional but highly recommended)

Hosted environment that mirrors prod as closely as possible.

Used for pre-release smokes, performance experiments, and DDL rehearsals.

prod

Real users, real money (eventually).

Strong guardrails: controlled DDL, carefully managed secrets, jobs enabled in a deliberate way.

Each environment is a Postgres database + web app + job layer with its own DATABASE_URL, DDL history, and configuration.

2. Environment wiring & .env loading

All environments rely on environment variables; for local/dev, they’re usually stored in a .env file at the repo root.

2.1. .env loader

The helper scripts/env/load-env.cjs:

Looks for .env in the current working directory.

Parses KEY=VALUE lines, ignoring comments and blank lines.

Exposes values as process.env.KEY only if not already set (shell overrides .env).

Typical usage:

# Use .env for the web app
node scripts/env/load-env.cjs pnpm dev


# Use .env for jobs
node scripts/env/load-env.cjs pnpm tsx scripts/jobs/run-all.ts

You can also rely on import "dotenv/config"; inside scripts (as in scripts/jobs/run-all.ts) when running via tsx. load-env.cjs is mainly useful when you want to wrap arbitrary commands with .env support while still allowing shell overrides.

3. Core environment variables

The most important variables, by category:

3.1. Database & app identity

DATABASE_URL — Postgres connection string.
Example: postgres://user:pass@localhost:5432/cryptopi_dev.

APP_NAME — logical name of the app (default: cryptopi-dynamics).

APP_VERSION — version string reported in ops/session stamps (e.g. 0.1.1-dev).

These are consumed by:

DDL/seed scripts (run-ddls, seeds).

Session stamping helpers (e.g. ops.open_all_sessions(app_name, app_version)).

Jobs that need DB access (scripts/jobs/run-all.ts, scripts/jobs/str-aux-runner.ts, scripts/jobs/cin-import-moves.ts).

3.2. Jobs & runners

RUN_JOBS — gate for scripts/jobs/run-all.ts.

When RUN_JOBS != "1", run-all exits quickly with a log line (jobs: disabled).

When RUN_JOBS = "1", background workers are allowed to start.

STR_AUX_RUNNER_INTERVAL_MS — override poll interval for scripts/jobs/str-aux-runner.ts (defaults to 40_000, with a floor of 5_000).

STR_AUX_RUNNER_SESSION_ID — label used by the str-aux runner for tagging its session in logs/DB (default: "str-aux-runner").

3.3. HTTP & client

ORIGIN — base URL for HTTP smokes and scripts that talk to the app (default http://localhost:3000 in most smokes).

3.4. External providers & secrets

Names can evolve with the codebase, but you’ll generally have:

BINANCE_API_KEY, BINANCE_API_SECRET — credentials for Binance jobs.

Any additional provider keys (future modules) under their own prefixes.

Secrets rules

dev: can live in .env (never committed).

staging/prod: prefer your hosting platform’s secret manager or OS-level env injection; .env should either not exist or be locked down tightly.

4. Example .env layouts
4.1. Dev
# Core
DATABASE_URL=postgres://cp_dev:cp_dev@localhost:5432/cryptopi_dev
APP_NAME=cryptopi-dynamics
APP_VERSION=0.1.1-dev


# Jobs
RUN_JOBS=1
STR_AUX_RUNNER_INTERVAL_MS=40000
STR_AUX_RUNNER_SESSION_ID=str-aux-dev


# HTTP / smokes
ORIGIN=http://localhost:3000


# Providers (dev keys only)
BINANCE_API_KEY=dev-key
BINANCE_API_SECRET=dev-secret
4.2. Staging
DATABASE_URL=postgres://cp_stage:...@staging-host:5432/cryptopi_stage
APP_NAME=cryptopi-dynamics
APP_VERSION=0.1.1-rc1


RUN_JOBS=1
STR_AUX_RUNNER_INTERVAL_MS=20000
STR_AUX_RUNNER_SESSION_ID=str-aux-stage


ORIGIN=https://staging.cryptopill.yourdomain

Staging should mirror prod topology but can use smaller universes (fewer symbols/windows) for cost control.

4.3. Prod

In production, .env may be replaced by your platform’s secret management. Conceptually you still configure:

DATABASE_URL pointing to the managed Postgres instance.

APP_VERSION matching the deployed tag (e.g. 0.2.0).

RUN_JOBS=1 only when you are ready for the job layer to run.

Provider keys pointing to real API credentials.

5. DDL & migrations per environment

dev: you may occasionally drop/recreate the database and apply DDL fresh. It’s acceptable to iterate quickly here.

staging: treat DDL as a rehearsal for prod; apply the same DDL pack and migrations in the same order.

prod: all structural changes must follow MIGRATIONS.md and be rehearsed on staging. Never run experimental DDLs directly.

Recommended flow:

Implement/change DDL files under src/core/db/ddl.

Apply on a local dev DB using run-ddls.

Once stable, apply on staging.

Finally, apply on prod during a maintenance window, watching smokes closely.

6. Environments & jobs interaction

Jobs should run only where appropriate:

dev: often enabled, but with a limited symbol set to avoid hammering providers.

staging: enabled with near-real settings for pre-prod testing.

prod: enabled carefully, with strong monitoring.

RUN_JOBS and module-specific envs (like STR_AUX_RUNNER_INTERVAL_MS) are the main levers per environment.

Smokes (SMOKES.md) should be runnable in all environments; prod smokes must be non-destructive.