SMOKES.md — Health checks & diagnostics

Goal: a repeatable set of checks that tell you if the system is healthy enough to trust, at a given moment.

Smokes should be fast, non-destructive, and easy to run.

0. Categories of smokes

Smokes are grouped by the layer they exercise:

Schema/DDL diagnostics
Verify that key tables/views exist and are internally consistent.

Str-Aux DB-level diagnostics
Analyze sampling, windows and vectors in the DB.

HTTP sampling smokes
Hit /api/str-aux/... endpoints to ensure the API surface behaves.

IDHR / vector integrity smokes
Check that frame binning and serialized vectors make sense.

End-to-end refresh smokes (future)
Drive a mini cycle of ingest → sampling → matrices → UI.

This document only references the main, current scripts under scripts/smokes/. Legacy / archived smokes live under scripts/jobs/legacy/ and should be consulted only for archaeology.

1. Schema/DDL diagnostics
1.1. Schema-agnostic diagnostics package

Script: scripts/smokes/schema-agnostic-diagnose-package.sql

Run with:

psql "$DATABASE_URL" -f scripts/smokes/schema-agnostic-diagnose-package.sql

What it does (conceptually):

Ensures a debug schema exists.

Creates/updates views like:

debug._symbols — unified view of market symbols.

debug._klines_win — normalized klines/windows per symbol.

debug._vectors_win — normalized vectors per symbol and window.

debug.source_coverage — coverage/gaps per symbol & window.

Uses inline DO blocks to adapt to slightly different upstream schemas (presence/absence of certain columns).

Pass criteria:

Script finishes without error.

select * from debug.source_coverage limit 10; returns rows for core symbols.

Coverage metrics make intuitive sense (no obviously impossible gaps).

2. Str-Aux DB diagnostics
2.1. Str-Aux diagnostics package

Script: scripts/smokes/diagnostics-str-aux-package.sql

Run with:

psql "$DATABASE_URL" -f scripts/smokes/diagnostics-str-aux-package.sql

What it does (high level):

Builds on top of the schema-agnostic package.

Adds str-aux-specific debug views for:

Sampling recency and density.

Window coverage and gaps per symbol.

Derived vector/IDHR stats.

Helps answer: "Are we actually sampling and deriving what we think we are?"

Pass criteria:

Views are created successfully.

Sampling and vector counts per symbol/window are within expected ranges.

No unexpected NULL storms or obviously broken joins.

3. HTTP sampling smoke
3.1. Str-Aux sampling smoke (HTTP)

Script: scripts/smokes/str-aux-sampling-smoke.mts

Run with:

# Minimal
ORIGIN="http://localhost:3000" \
SYMBOLS="BTCUSDT,ETHUSDT" \
LIMIT=20 \
pnpm tsx src/scripts/smokes/str-aux-sampling-smoke.mts

Environment variables:

ORIGIN — base URL for the app (default http://localhost:3000).

SYMBOLS / SYMBOL — comma-separated list of symbols (default BTCUSDT).

LIMIT — maximum buckets to fetch per symbol (default 20, capped between 1 and 200).

What it does:

Calls the sampling endpoint for each symbol.

Parses results into SamplingRow structures.

Checks that each row has:

Basic book metadata.

Density metrics.

Quality flags.

Counts how many buckets are flagged with quality issues.

Pass criteria:

Script exits with code 0.

For each symbol, you see a short report with no major quality failures.

The majority of buckets per symbol are not flagged as bad.

If a symbol fails:

Check jobs ingesting that symbol.

Inspect raw sampling data for anomalies.

4. IDHR / vector integrity smokes
4.1. IDHR bins smoke (DB + computation)

Script: scripts/smokes/str-aux-idhr-smoke.mts

Run with:

SYMBOL="BTCUSDT" \
LIMIT=512 \
DATABASE_URL="postgres://..." \
pnpm tsx src/scripts/smokes/str-aux-idhr-smoke.mts

Environment variables:

SYMBOL — single symbol to test (default BTCUSDT).

LIMIT — number of mids to fetch (min 64, max 1024; default 512).

DATABASE_URL / POSTGRES_URL / POSTGRES_CONNECTION_STRING — connection string.

What it does:

Reads the latest sampling mids for the given symbol from the DB.

Feeds them into computeIdhrBins and serializeIdhr from the str-aux core.

Verifies that binning behaves correctly for a 16x16 grid.

Pass criteria:

Script completes without throwing.

Derived IDHR representation matches expectations (no obviously empty or overfull bins given the input slice).

If it fails, investigate:

Whether sampling is providing enough rows.

Whether recent code changes broke the IDHR maths.

5. Persistence & auto-flow smokes
5.1. Str-Aux persistence auto smoke

Script: scripts/smokes/str-aux-persist-auto-smoke.mts

Run with:

DATABASE_URL="postgres://..." \
SYMBOLS="BTCUSDT,ETHUSDT" \
LIMIT=512 \
pnpm tsx src/scripts/smokes/str-aux-persist-auto-smoke.mts

Environment variables (typical):

DATABASE_URL / variants — Postgres connection.

SYMBOLS — list of symbols to sample.

LIMIT — how many rows to inspect.

What it does (conceptually):

Reads from the sampling layer.

Verifies that automatic persistence into str-aux tables is working.

Runs aggregate checks (e.g. per-symbol/window counts) to detect gaps.

Pass criteria:

Script finishes with success exit code.

For each symbol/window, you see expected counts and no "gap" warnings.

6. Minimal smoke suite (after boot / deploy)

After a new deploy (or restarting a dev environment), a minimal but meaningful smoke pass could be:

DDL & debug views

psql "$DATABASE_URL" -f scripts/smokes/schema-agnostic-diagnose-package.sql
psql "$DATABASE_URL" -f scripts/smokes/diagnostics-str-aux-package.sql

HTTP sampling

ORIGIN="http://localhost:3000" \
SYMBOLS="BTCUSDT,ETHUSDT" \
LIMIT=20 \
pnpm tsx src/scripts/smokes/str-aux-sampling-smoke.mts

IDHR sanity

SYMBOL="BTCUSDT" \
LIMIT=512 \
pnpm tsx src/scripts/smokes/str-aux-idhr-smoke.mts

Persistence check

pnpm tsx src/scripts/smokes/str-aux-persist-auto-smoke.mts

If all four steps pass and the client UI looks sane, the system can be considered operationally healthy for that build.

For deeper, module-specific smokes (wallet, matrices, cin-aux, mea-mood), extend this document as those smokes are formalized.