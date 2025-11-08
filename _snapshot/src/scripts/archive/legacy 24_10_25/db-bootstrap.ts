// core/db/db-bootstrap.ts
import "dotenv/config";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { Pool } from "pg";

const ROOT = join(process.cwd(), "core", "db");
const DDL_DIR  = join(ROOT, "ddl");
const SEED_DIR = join(ROOT, "seed");

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  const pool = new Pool({ connectionString: dbUrl, max: 1 });
  const runSql = async (filePath: string) => {
    const sql = readFileSync(filePath, "utf8");
    console.log("→", filePath.replace(process.cwd() + "/", ""));
    await pool.query(sql);
  };

  // 1) Apply all DDL packs
  if (existsSync(DDL_DIR)) {
    const ddlFiles = readdirSync(DDL_DIR)
      .filter(f => extname(f) === ".sql")
      .sort((a,b) => a.localeCompare(b));
    console.log(`Applying DDL packs (${ddlFiles.length})`);
    for (const f of ddlFiles) await runSql(join(DDL_DIR, f));
  }

  // 2) Apply all seeds
  if (existsSync(SEED_DIR)) {
    const seedFiles = readdirSync(SEED_DIR)
      .filter(f => extname(f) === ".sql")
      .sort((a,b) => a.localeCompare(b));
    console.log(`Seeding data (${seedFiles.length})`);
    for (const f of seedFiles) await runSql(join(SEED_DIR, f));
  }

  await pool.end();
  console.log("✅ Bootstrap completed.");
}

main().catch(err => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
