import "dotenv/config";
import fs from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const {
  DATABASE_URL,
  PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE,
} = process.env;

let client;
if (DATABASE_URL) {
  client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
  });
} else if (PGHOST && PGDATABASE && PGUSER) {
  const ssl = PGSSLMODE && PGSSLMODE.toLowerCase() !== "disable"
    ? { rejectUnauthorized: false } : false;
  client = new pg.Client({
    host: PGHOST,
    port: Number(PGPORT || 5432),
    database: PGDATABASE,
    user: PGUSER,
    password: PGPASSWORD,
    ssl,
  });
} else {
  console.error("No DB coords. Set DATABASE_URL or PGHOST/PGPORT/PGDATABASE/PGUSER[/PGPASSWORD][/PGSSLMODE].");
  process.exit(2);
}

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("Usage: node db-run.mjs <path-to-sql>");
  process.exit(2);
}
const abs = resolve(process.cwd(), sqlPath);
if (!fs.existsSync(abs)) {
  console.error(`SQL file not found: ${abs}`);
  process.exit(2);
}
const sql = fs.readFileSync(abs, "utf8");

await client.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log(`OK: ${sqlPath}`);
  process.exit(0);
} catch (e) {
  try { await client.query("ROLLBACK"); } catch {}
  console.error(`Failed running ${sqlPath}`);
  console.error(e?.message || e);
  process.exit(1);
} finally {
  await client.end();
}
