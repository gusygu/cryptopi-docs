/**
 * setup-cin-ledger.mts — psql-free runner (uses node-postgres, no generators)
 * Run: pnpm tsx src/scripts/setup-cin-ledger.mts
 */

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const ROOT = process.cwd();

// --- DB config (env-first) ---
const DATABASE_URL = process.env.DATABASE_URL || "";
const DB_USER = process.env.DB_USER ?? "postgres";
const DB_PASSWORD = process.env.DB_PASSWORD ?? "gus";
const DB_HOST = process.env.DB_HOST ?? "localhost";
const DB_PORT = Number(process.env.DB_PORT ?? "1026");
const DB_NAME = process.env.DB_NAME ?? "cryptopi_dynamics";

// file overrides (optional)
const OVERRIDE_DDL = process.env.CIN_DDL ? path.resolve(ROOT, process.env.CIN_DDL) : null;
const OVERRIDE_FUNCS = process.env.CIN_FUNCS ? path.resolve(ROOT, process.env.CIN_FUNCS) : null;

// auto-discovery patterns
const DDL_REGEX = /(^|[/\\])(ddl(\.aux)?|.*cin[-_]ledger.*ddl).*\.sql$/i;
const FUNC_REGEX = /(^|[/\\])((functions?|func).*|cin[-_]ledger[-_]?v2).*\.sql$/i;
const PREFERRED_DIRS = ["db", "sql", "database", "migrations", "src/core/db"];

// ---- helpers (no generators) ----
function walkCollect(start: string, maxDepth = 6): string[] {
  const out: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }];

  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    if (depth > maxDepth) continue;
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }

    for (const name of entries) {
      const abs = path.join(dir, name);
      let st: fs.Stats;
      try { st = fs.statSync(abs); } catch { continue; }
      if (st.isDirectory()) stack.push({ dir: abs, depth: depth + 1 });
      else if (st.isFile()) out.push(abs);
    }
  }
  return out;
}

function findSqlFile(regex: RegExp): string | null {
  for (const rel of PREFERRED_DIRS) {
    const dir = path.resolve(ROOT, rel);
    if (!fs.existsSync(dir)) continue;
    for (const file of walkCollect(dir, 4)) {
      if (regex.test(file)) return file;
    }
  }
  // fallback: scan repo root shallowly
  for (const file of walkCollect(ROOT, 3)) {
    if (regex.test(file)) return file;
  }
  return null;
}

function assertFile(fp: string | null, kind: string): string {
  if (!fp) throw new Error(`Could not find a ${kind} SQL file. Set CIN_${kind.toUpperCase()} or place it under /db or /src/core/db`);
  if (!fs.existsSync(fp)) throw new Error(`${kind} file not found at ${fp}`);
  return fp;
}

async function runSqlFile(client: Client, absPath: string) {
  const sql = fs.readFileSync(absPath, "utf8");
  console.log(`⚙️  Applying: ${path.relative(ROOT, absPath)}`);
  await client.query(sql);
  console.log(`✅  Applied: ${path.basename(absPath)}\n`);
}

function makeClient(): Client {
  if (DATABASE_URL) return new Client({ connectionString: DATABASE_URL });
  return new Client({
    user: DB_USER,
    host: DB_HOST,
    database: DB_NAME,
    password: DB_PASSWORD || undefined,
    port: DB_PORT,
  });
}

async function main() {
  console.log("🚀 cin-aux setup (pg client) starting…");

  const ddl   = assertFile(OVERRIDE_DDL   ?? findSqlFile(DDL_REGEX),  "DDL");
  const funcs = assertFile(OVERRIDE_FUNCS ?? findSqlFile(FUNC_REGEX), "FUNCS");

  console.log(`DB: ${DATABASE_URL ? DATABASE_URL : `${DB_NAME} @ ${DB_HOST}:${DB_PORT} as ${DB_USER}`}`);
  console.log(`Found DDL:   ${path.relative(ROOT, ddl)}`);
  console.log(`Found funcs: ${path.relative(ROOT, funcs)}\n`);

  const client = makeClient();
  await client.connect();

  try {
    await runSqlFile(client, ddl);
    await runSqlFile(client, funcs);
    console.log("🎉 cin-aux schema + functions installed successfully (pg client).");
  } catch (e: any) {
    console.error("❌ Setup failed:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
