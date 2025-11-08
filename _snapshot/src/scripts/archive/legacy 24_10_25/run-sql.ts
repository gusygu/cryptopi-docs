// SQL runner (pure Node ESM) — executes a .sql file against DATABASE_URL
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: node src/scripts/run-sql.mjs <path-to-sql-file>");
    process.exit(1);
  }

  // Resolve relative to project root (one level up from /src/scripts)
  const projectRoot = path.resolve(__dirname, "..");
  const sqlPath = path.isAbsolute(arg) ? arg : path.resolve(projectRoot, arg);

  // Debug (helpful if paths ever get weird)
  console.log("[run-sql] cwd       =", process.cwd());
  console.log("[run-sql] __dirname =", __dirname);
  console.log("[run-sql] sqlPath   =", sqlPath);

  if (!fs.existsSync(sqlPath)) {
    console.error("❌ SQL file not found:", sqlPath);
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL is not set");
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, "utf8");
  const pool = new pg.Pool({ connectionString: url });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);        // supports multiple statements
    await client.query("COMMIT");
    console.log("✅ Executed:", path.relative(projectRoot, sqlPath));
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ SQL execution failed:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error("Runner error:", e);
  process.exit(1);
});
