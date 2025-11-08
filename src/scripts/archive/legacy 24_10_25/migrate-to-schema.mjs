// src/scripts/db/migrate-to-schema.mjs
import fs from "node:fs";
try {
  const hasLocal = fs.existsSync(".env.local");
  await import("dotenv").then(d => d.config({ path: hasLocal ? ".env.local" : ".env" }));
} catch {}

import pg from "pg";
const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const TARGET = (process.env.DB_SCHEMA || "public").trim();
if (!DATABASE_URL) {
  console.error("[migrate] Missing DATABASE_URL");
  process.exit(2);
}
console.log(`[migrate] target schema = ${TARGET}`);

const CANDIDATES = [
  "settings",
  "app_sessions",
  "coins",
  "pairs",
  "cycles",
  "str_aux_snapshots",
  "mea_aux_snapshots",
  "v_str_aux_summary",
  "v_mea_aux_summary",
];

async function exists(c, schema, name) {
  const r = await c.query(
    `SELECT c.relkind
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2`,
    [schema, name]
  );
  return r.rows[0]?.relkind || null; // 'r'=table, 'v'=view, 'm'=matview
}

async function run() {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(`CREATE SCHEMA IF NOT EXISTS "${TARGET}";`);

    for (const name of CANDIDATES) {
      const inPublic = await exists(c, "public", name);
      const inTarget = await exists(c, TARGET, name);

      if (inPublic && !inTarget) {
        const kind = inPublic;
        const ddl =
          kind === "v"
            ? `ALTER VIEW "public"."${name}" SET SCHEMA "${TARGET}";`
            : `ALTER TABLE "public"."${name}" SET SCHEMA "${TARGET}";`;
        console.log(`[migrate] moving ${name} (${kind}) → ${TARGET}`);
        await c.query(ddl);
      }
    }

    // make sure search_path defaults to target for this DB user (optional)
    const { user } = c;
    if (user) {
      console.log(`[migrate] setting search_path for user ${user}`);
      await c.query(`ALTER ROLE "${user}" IN DATABASE current_database() SET search_path TO "${TARGET}", public;`).catch(() => {});
    }

    await c.query("COMMIT");
    console.log("[migrate] done ✅");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("[migrate] failed ❌", e.message || e);
    process.exit(2);
  } finally {
    await c.end();
  }
}
run().catch(e => { console.error("[migrate] fatal ❌", e.message || e); process.exit(2); });
