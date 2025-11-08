#!/usr/bin/env tsx
/**
 * Drops application schemas to leave the database clean.
 * Requires --force to avoid accidental execution.
 *
 * Usage:
 *   tsx src/scripts/db/clean-db.mts --force
 *   tsx src/scripts/db/clean-db.mts --force --schemas=settings,market
 */
import "dotenv/config";

import { buildClient } from "./utils/sql-runner.mts";

const ARGS = process.argv.slice(2);

function hasFlag(flag: string) {
  return ARGS.includes(flag);
}

function getFlagValue(name: string): string | undefined {
  const prefix = `${name}=`;
  for (const arg of ARGS) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

if (!hasFlag("--force")) {
  console.error(
    "? Refusing to clean database: pass --force if you're sure. Example: tsx src/scripts/db/clean-db.mts --force",
  );
  process.exit(1);
}

const schemasArg = getFlagValue("--schemas");
const defaultSchemas = [
  "strategy_aux",
  "ext",
  "ingest",
  "market",
  "settings",
  "docs",
  "matrices",
  "str_aux",
  "cin_aux",
  "mea_dynamics",
  "ops",
  "vitals",
];
const schemas = schemasArg
  ? schemasArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : defaultSchemas;

if (!schemas.length) {
  console.error("? No schemas specified to drop.");
  process.exit(1);
}

function quoteIdent(id: string) {
  return `"${id.replace(/"/g, '""')}"`;
}

async function dropSchemas() {
  const client = buildClient({ appName: "cryptopi-db-cleaner" });
  await client.connect();

  console.log("? Cleaning schemas:", schemas.join(", "));

  const statements = schemas.map((schema) => `DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE;`);
  // Also purge objects left in public schema to avoid stragglers.
  const cleanupPublic = `
    DO $$
    DECLARE
      rec record;
    BEGIN
      FOR rec IN
        SELECT format('DROP TABLE IF EXISTS public.%I CASCADE', tablename) AS sql
          FROM pg_tables
         WHERE schemaname = 'public'
           AND tablename NOT LIKE 'pg_%'
      LOOP
        EXECUTE rec.sql;
      END LOOP;

      FOR rec IN
        SELECT format('DROP VIEW IF EXISTS public.%I CASCADE', viewname) AS sql
          FROM pg_views
         WHERE schemaname = 'public'
           AND viewname NOT LIKE 'pg_%'
      LOOP
        EXECUTE rec.sql;
      END LOOP;
    END $$;
  `;

  await client.query("BEGIN");
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
    await client.query(cleanupPublic);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }

  console.log("? Database cleaned.");
}

dropSchemas().catch((err) => {
  console.error("?? Failed to clean database:", err);
  process.exit(1);
});
