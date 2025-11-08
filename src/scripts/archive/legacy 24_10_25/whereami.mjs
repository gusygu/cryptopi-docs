import fs from "node:fs";
try {
  const hasLocal = fs.existsSync(".env.local");
  await import("dotenv").then(d => d.config({ path: hasLocal ? ".env.local" : ".env" }));
} catch {}
import pg from "pg";
const { Client } = pg;

const url = process.env.DATABASE_URL;
const target = (process.env.DB_SCHEMA || "public").trim();
if (!url) { console.error("[whereami] Missing DATABASE_URL"); process.exit(2); }

const KEYS = ['settings','app_sessions','coins','pairs','cycles','str_aux_snapshots','mea_aux_snapshots'];
const VIEWS = ['v_str_aux_summary','v_mea_aux_summary'];

(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const sch = await c.query("SELECT schema_name FROM information_schema.schemata ORDER BY 1");
    console.log("[whereami] schemas:", sch.rows.map(r => r.schema_name).join(", "));
    const tbl = await c.query(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_name = ANY($1) ORDER BY 1,2`, [KEYS]
    );
    console.log("[whereami] tables:");
    for (const r of tbl.rows) console.log(`  ${r.table_schema}.${r.table_name}`);
    const vws = await c.query(
      `SELECT table_schema, table_name FROM information_schema.views
       WHERE table_name = ANY($1) ORDER BY 1,2`, [VIEWS]
    );
    console.log("[whereami] views:");
    for (const r of vws.rows) console.log(`  ${r.table_schema}.${r.table_name}`);

    const hit = new Set(tbl.rows.concat(vws.rows).map(r => r.table_schema));
    console.log(`[whereami] DB_SCHEMA in .env = ${target}`);
    console.log(`[whereami] Detected content in: ${[...hit].join(", ") || "<none>"}`);
    if (!hit.has(target)) {
      console.log(`[whereami] NOTE: your .env DB_SCHEMA (${target}) does not contain these objects.`);
    }
  } finally {
    await c.end();
  }
})().catch(e => { console.error("[whereami] failed", e.message || e); process.exit(2); });
