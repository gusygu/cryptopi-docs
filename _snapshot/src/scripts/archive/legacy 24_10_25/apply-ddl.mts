// src/scripts/db/apply-ddl.mts
// Cross-platform DDL applier using node-postgres. No psql needed.
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

async function run() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[ddl] DATABASE_URL not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();
  try {
    const files = [
      path.resolve("src/db/ddl.sql"),       // if you have a base ddl
      path.resolve("src/db/ddl-aux.sql"),   // optional
      path.resolve("src/db/ddl-str.sql"),   // our str-aux patch
    ].filter((p) => {
      try { readFileSync(p); return true; } catch { return false; }
    });

    if (!files.length) {
      console.error("[ddl] No DDL files found under src/db");
      process.exit(1);
    }

    await client.query("BEGIN");
    for (const f of files) {
      const sql = readFileSync(f, "utf8");
      if (!sql.trim()) continue;
      console.log(`[ddl] applying ${path.basename(f)} ...`);
      await client.query(sql);
    }
    await client.query("COMMIT");
    console.log("[ddl] done.");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[ddl] failed:", e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
