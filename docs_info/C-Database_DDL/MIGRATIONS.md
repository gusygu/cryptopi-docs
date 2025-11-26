MIGRATIONS.md
Purpose

This document explains how CryptoPi evolves its database safely over time. While the DDL packs define the baseline, migrations handle changes: new tables, structural refactors, RLS adjustments, reindexing, and data transformations.

CryptoPi follows the principle:

DDL files define structure. Migrations define evolution.

1. When to Write a Migration

A migration is required when:

A table structure changes (add/remove columns).

A constraint or index must be added or removed.

A view becomes incompatible with current schema state.

RLS policies change.

A table must be backfilled with derived values.

A DDL pack cannot be safely re‑run due to incompatible changes.

If the change is idempotent and produces the same result every time, it can be pushed into the DDL pack. Otherwise, it belongs in a migration.

2. Migration File Naming

Migrations live under:

src/core/db/migrations/

Naming convention:

YYYYMMDD_HHMM_description.sql

Example:

20250214_0930_add_mood_indexes.sql

This guarantees chronological ordering and human traceability.

3. Migration Execution

Migrations are run by:

pnpm db:migrate

or the internal script:

tsx src/scripts/db/run-migrations.mts

The system maintains a tracking table:

ops.migrations (id, filename, applied_at)

This prevents double application and ensures reproducibility.

4. Migration Types
A) Structural Migrations

Adding/dropping columns.

Creating new tables.

Adding enums or altering types.

Rebuilding indexes.

B) Data Migrations

Backfilling derived values.

Copying or transforming records.

Normalizing historical data.

C) RLS Migrations

Adjusting policies to match new security requirements.

Adding new policies as tables evolve.

D) Cleanup Migrations

Dropping deprecated tables or views no longer used.

All migrations must be reversible or at least well‑documented when irreversible.

5. Migration Safety Rules

Never perform destructive actions without explicit safeguards.

Always wrap multi‑step changes in a transaction.

Avoid long‑running operations in production (break into batches).

Use IF EXISTS and IF NOT EXISTS when possible.

Test migrations against realistic DB snapshots.

6. The DDL vs Migration Boundary
DDL Packs

Define stable schema structure.

Can be rerun safely (idempotent).

Should not mutate historical data.

Migrations

Define changes over time.

Only run once.

May manipulate data.

This boundary keeps the DDL tree clean and the system fully bootstrappable.

7. Multi‑Environment Flow

Develop migration locally.

Apply in staging.

Run smokes + vitals.

Deploy to production with safety flags.

Tag release (SOURCE_TAG, VERSION).

Publish doc pack with hashes.

8. Example Migration
BEGIN;


ALTER TABLE matrices.dyn_values
  ADD COLUMN confidence numeric;


UPDATE matrices.dyn_values
  SET confidence = 1.0
  WHERE confidence IS NULL;


CREATE INDEX dyn_values_confidence_idx
  ON matrices.dyn_values (confidence);


INSERT INTO ops.migrations(filename) VALUES ('20250301_add_confidence_column.sql');


COMMIT;
9. Conclusion

Migrations are the story of how the database grows. They preserve history, maintain consistency, and ensure that every evolution is intentional and safe. They complement the DDL packs and maintain the integrity of CryptoPi across releases.