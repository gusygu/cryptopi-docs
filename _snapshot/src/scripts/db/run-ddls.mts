#!/usr/bin/env tsx
/**
 * Self-contained DDL runner
 * --------------------------------------------
 * Usage:
 *   pnpm tsx src/scripts/db/run-ddls.mts
 *   pnpm tsx src/scripts/db/run-ddls.mts --from 06_
 *   pnpm tsx src/scripts/db/run-ddls.mts --only 08_str-aux
 *   pnpm tsx src/scripts/db/run-ddls.mts --dry-run
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client } from "pg";

/* ───────────────────────────── helpers ───────────────────────────── */

function getFlag(name: string): string | undefined {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  const direct = args.indexOf(`--${name}`);
  if (direct >= 0 && args[direct + 1]) return args[direct + 1];
  const prefixed = args.find((a) => a.startsWith(prefix));
  return prefixed ? prefixed.slice(prefix.length) : undefined;
}

/** Build pg client from .env or defaults */
function buildClient() {
  const cfg = {
    host: process.env.PGHOST || "localhost",
    port: +(process.env.PGPORT || 1026),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "gus",
    database: process.env.PGDATABASE || "cryptopie",
    application_name: "cryptopi-ddl-runner",
  };
  return new Client(cfg);
}

/** Recursively list .sql files, sorted alphabetically */
function listSqlFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files = files.concat(listSqlFiles(full));
    else if (e.isFile() && e.name.endsWith(".sql")) files.push(full);
  }
  return files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

/* ───────────────────────────── main ───────────────────────────── */

const FROM = getFlag("from");
const ONLY = getFlag("only");
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";

async function run() {
  const ddlDir = path.resolve("src/core/db/ddl");
  const allFiles = listSqlFiles(ddlDir);
  if (!allFiles.length) {
    console.error("⚠ No SQL files found in", ddlDir);
    process.exit(1);
  }

  let files = allFiles;
  if (FROM) files = files.filter((f) => path.basename(f) >= FROM);
  if (ONLY) files = files.filter((f) => path.basename(f).includes(ONLY));

  console.log(`🟢 Applying ${files.length} DDL files from ${ddlDir}`);
  if (DRY_RUN) {
    files.forEach((f) => console.log("   ↳", path.basename(f)));
    console.log("💡 DRY RUN: no SQL executed.");
    return;
  }

  const client = buildClient();
  await client.connect();

  let success = 0;
  try {
    for (const file of files) {
      const name = path.basename(file);
      const sql = fs.readFileSync(file, "utf8");
      console.log(`   • Executing ${name}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
        console.log(`     ✓ ${name}`);
        success++;
      } catch (err: any) {
        await client.query("ROLLBACK");
        console.error(`     ✗ ${name} failed: ${err.message}`);
        throw new Error(`DDL failed in ${name}: ${err.message}`);
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  console.log(`✅ DDL run complete. ${success}/${files.length} applied successfully.`);
}

run().catch((err) => {
  console.error("❌ Failed to run DDLs:", err);
  process.exit(1);
});
