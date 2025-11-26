JOBS_OPERATIONS.md — Jobs, Daemons & Scheduling

Audience: operators and devs responsible for background processing.

Scope: how jobs are organized, how to start/stop them, how to monitor them, and how they behave per environment.

1. Job taxonomy

CryptoPill currently uses three broad kinds of jobs:

Orchestrator job

File: scripts/jobs/run-all.ts (and a minimal wrapper run-all.mts).

Purpose: central gate / launcher for background workers.

Behavior: checks RUN_JOBS; if not "1", exits quickly.

Long-running module runners

Example: scripts/jobs/str-aux-runner.ts.

Purpose: run a continuous loop that advances one module (sampling + vectors) on an interval.

Behavior: infinite loop with configurable interval and robust error logging.

One-shot / batch jobs

Example: scripts/jobs/cin-import-moves.ts.

Purpose: do a finite piece of work (e.g. import account trades into cin_aux), then exit.

Typically wired to cron or manual execution.

There is also a historical/legacy set under scripts/jobs/legacy/ with older pipelines (binance-klines, compute_vectors, doctor-matrices-storage, etc.). These are useful for reference or archaeology but should not be part of the main prod run unless explicitly revived.

2. Orchestrator: run-all
2.1. Behavior

scripts/jobs/run-all.ts:

Imports dotenv/config so that .env is loaded automatically in dev.

Logs a banner: jobs: starting (set RUN_JOBS=1 to enable background workers).

Checks process.env.RUN_JOBS and exits early if not equal to "1".

Connects to Postgres using pg.Pool with DATABASE_URL.

Reads enabled symbols from settings.coin_universe (using COALESCE(enabled, true)).

Currently contains a placeholder loop that keeps the process alive; real workers (streams, pollers, vector engines) are wired in this file.

2.2. How to run

In dev:

# With .env preloaded
node scripts/env/load-env.cjs pnpm tsx scripts/jobs/run-all.ts


# Or if your shell already exports env vars
RUN_JOBS=1 DATABASE_URL=postgres://... pnpm tsx scripts/jobs/run-all.ts

In prod, you’d typically wrap this with a process manager:

systemd service, PM2 process, or your platform’s equivalent.

Ensure RUN_JOBS=1 is part of the unit/environment.

2.3. Operator rules

Never run run-all in an environment where you don’t want background traffic (e.g. migrations-only maintenance DB).

If you need to temporarily freeze background work, set RUN_JOBS=0 (or unset it) and restart the process; it will exit cleanly.

3. Str-Aux runner
3.1. Behavior

scripts/jobs/str-aux-runner.ts:

Imports runStrAuxTick from @/core/features/str-aux/runner.

Loads dynamic settings via loadSettings() from @/core/settings.

Computes a poll interval INTERVAL_MS as:

const INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.STR_AUX_RUNNER_INTERVAL_MS ?? 40_000),
);

Builds a PollTick with ts and a sessionId (from STR_AUX_RUNNER_SESSION_ID or default "str-aux-runner").

In an infinite while (true) loop:

Loads settings.

Calls runStrAuxTick(settings) inside a try/catch.

Logs errors but does not crash on single failures.

Sleeps for INTERVAL_MS - elapsed, with a minimum of 1 second.

3.2. How to run

Dev example:

DATABASE_URL=postgres://... \
STR_AUX_RUNNER_INTERVAL_MS=30000 \
STR_AUX_RUNNER_SESSION_ID=str-aux-dev \
pnpm tsx scripts/jobs/str-aux-runner.ts

Production-like:

Wrap in a process manager.

Use a slightly larger interval (e.g. 30–60 seconds) depending on API limits and cost.

3.3. When to run

dev: when you want real-time-ish sampling and vector updates for a subset of symbols.

staging: always, using the staging DB and a relevant universe.

prod: always, but with careful monitoring of external API usage.

4. CIN-AUX import job
4.1. Behavior

scripts/jobs/cin-import-moves.ts:

Uses the shared DB wrapper @/core/db/db.

Selects all OPEN sessions from cin_aux.rt_session.

For each session, calls the database function cin_aux.import_moves_from_account_trades(session_id).

Logs how many moves were imported per session.

Exits with code 0 on success or code 1 on error.

This job delegates most of the actual business logic to the DB (cin_aux schema), keeping the TS layer thin.

4.2. How to run

Manual run in dev or staging:

DATABASE_URL=postgres://... \
pnpm tsx scripts/jobs/cin-import-moves.ts

In prod, wire it to a scheduler (cron, platform scheduler) with a sensible cadence, e.g. every 5–15 minutes, depending on trading volume and performance.

5. Job seeding & ingest jobs table

The SQL seed scripts/seed/0004_seeds_jobs.sql pre-populates ingest.jobs with initial tasks:

For each enabled symbol (settings.coin_universe) and window (settings.windows), creates a fetch_klines job.

Schedules a first pass of higher-level jobs: fetch_ticker, fetch_orderbook, compute_str_vectors, compute_matrices, compute_mea.

Operators can:

Re-run this seed when expanding the universe (with care to avoid duplicates; the script uses ON CONFLICT DO NOTHING).

Inspect ingest.jobs to debug stuck or failing tasks.

6. Monitoring jobs

Key monitoring strategies:

Logs

Ensure run-all, str-aux-runner, and any other long-running jobs log to a central place or at least to rotated files.

Watch for recurring DB errors, provider rate-limit errors, or unexpected exceptions.

DB-level freshness checks

Sampling recency: select symbol, max(ts) from str_aux.sampling group by symbol;.

Vector recency: similar queries on vector tables.

Job queues: select kind, count(*) from ingest.jobs group by kind; to look for backlog.

Smokes

Run targeted smokes from SMOKES.md (HTTP sampling, IDHR, persistence) to verify that jobs are producing healthy data.

Session stamps

Use ops.session_log and ops.session_flags to correlate job behavior with app versions and session openings.

7. Failure handling & restart strategy

When jobs misbehave:

Identify scope

Is it only str-aux? only cin-aux? everything?

Use DB queries and smokes to localize the issue.

Check environment

Is DATABASE_URL correct for this environment?

Are provider keys valid / unexpired?

Did someone change RUN_JOBS or intervals?

Controlled restarts

For long-running jobs, restart the process via your process manager.

For one-shot jobs, re-run with the same parameters once the root cause is fixed.

Assess data impact

If jobs failed mid-run, check for partial writes or broken windows.

Use diagnostic SQL and smokes to verify consistency.

Document fixes

Add notes to DEBUGGING_PLAYBOOK.md and/or release notes when a failure mode is understood.

8. Jobs per environment

A simple recommended mapping:

dev

run-all: optional (can be disabled when working only on UI).

str-aux-runner: enabled when you want live-ish data.

cin-import-moves: run manually on demand.

staging

run-all: enabled (RUN_JOBS=1), with a controlled symbol universe.

str-aux-runner: always on.

cin-import-moves: scheduled, but at a lower frequency.

prod

run-all: always on, with careful monitoring.

str-aux-runner: always on, tuned intervals based on cost/perf.

cin-import-moves: scheduled according to business needs.

As new module-specific runners appear (matrices-refresh, mea-refresh, etc.), extend this document with their behaviors and environment mappings.