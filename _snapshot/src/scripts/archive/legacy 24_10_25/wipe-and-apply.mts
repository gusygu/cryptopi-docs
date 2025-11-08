// src/scripts/db/wipe-and-apply.mts
// Usage examples:
//   node --import tsx --env-file=.env src/scripts/db/wipe-and-apply.mts
//   node --import tsx --env-file=.env src/scripts/db/wipe-and-apply.mts --wipe-only
//   node --import tsx --env-file=.env src/scripts/db/wipe-and-apply.mts --dir sql
//   node --import tsx --env-file=.env src/scripts/db/wipe-and-apply.mts --files sql/00_unified.ddl.sql
//   node --import tsx --env-file=.env src/scripts/db/wipe-and-apply.mts --no-backup

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { basename, join, resolve } from "node:path";

type Opts = {
  dbUrl: string;
  dir: string;
  files: string[] | null;
  wipeFile: string;
  doBackup: boolean;
  backupDir: string;
  wipeOnly: boolean;
  psql: string;
  pgdump: string;
};

function parseArgs(): Opts {
  const args = new Map<string, string | true>();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.includes("=") ? a.split("=", 2) : [a, "true"];
      args.set(k, v === undefined ? "true" : v);
    }
  }

  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl) {
    console.error("❌ DATABASE_URL is not set. Provide via env or .env.");
    process.exit(1);
  }

  const dir = (args.get("--dir") as string) ?? "sql";
  const filesArg = (args.get("--files") as string) ?? "";
  const files = filesArg
    ? filesArg.split(",").map(s => s.trim()).filter(Boolean)
    : null;

  const wipeFile = resolve((args.get("--wipe") as string) ?? join(dir, "zz_wipe_all.sql"));
  const doBackup = !(args.has("--no-backup"));
  const backupDir = (args.get("--backup-dir") as string) ?? "backups";
  const wipeOnly = args.has("--wipe-only");
  const psql = (args.get("--psql") as string) ?? "psql";
  const pgdump = (args.get("--pgdump") as string) ?? "pg_dump";

  return { dbUrl, dir, files, wipeFile, doBackup, backupDir, wipeOnly, psql, pgdump };
}

async function pathExists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

function execBin(bin: string, args: string[], env = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "inherit", env });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited with code ${code}`));
    });
  });
}

async function backupDatabase(pgDump: string, dbUrl: string, dir: string) {
  await fs.mkdir(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d+Z$/, "Z");
  const fname = `dynamics-${ts}.sqlc`;
  const out = resolve(dir, fname);
  console.log(`📦 Backup -> ${out}`);
  await execBin(pgDump, ["--no-owner", "--clean", "--if-exists", "--format=custom", "--file", out, dbUrl]);
}

async function runSqlFile(psql: string, dbUrl: string, file: string) {
  console.log(`➡️  ${basename(file)}`);
  await execBin(psql, [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", resolve(file)]);
}

async function collectDdlFiles(dir: string): Promise<string[]> {
  const all = await fs.readdir(dir);
  // apply anything *.sql except wipe script; lexicographic order
  return all
    .filter(f => f.toLowerCase().endsWith(".sql"))
    .filter(f => !/^zz_wipe_all\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b))
    .map(f => resolve(dir, f));
}

(async () => {
  const opt = parseArgs();

  // presence checks
  if (!(await pathExists(opt.wipeFile))) {
    console.error(`❌ Wipe script not found: ${opt.wipeFile}`);
    process.exit(1);
  }

  // backup
  if (opt.doBackup) {
    try {
      await backupDatabase(opt.pgdump, opt.dbUrl, opt.backupDir);
    } catch (e) {
      console.error("❌ Backup failed:", (e as Error).message);
      process.exit(1);
    }
  }

  // wipe
  console.log("🧹 Wiping objects (views, functions, tables, indexes)...");
  try {
    await runSqlFile(opt.psql, opt.dbUrl, opt.wipeFile);
  } catch (e) {
    console.error("❌ Wipe failed:", (e as Error).message);
    process.exit(1);
  }

  if (opt.wipeOnly) {
    console.log("✅ Wipe-only completed.");
    process.exit(0);
  }

  // pick DDL files
  let ddlFiles: string[] = [];
  if (opt.files && opt.files.length) {
    ddlFiles = opt.files.map(f => resolve(f));
  } else {
    if (!(await pathExists(opt.dir))) {
      console.error(`❌ DDL directory not found: ${opt.dir}`);
      process.exit(1);
    }
    ddlFiles = await collectDdlFiles(opt.dir);
  }

  if (ddlFiles.length === 0) {
    console.error("❌ No DDL files to apply.");
    process.exit(1);
  }

  console.log("🏗️ Applying DDL files (lexicographic order):");
  for (const f of ddlFiles) {
    try {
      await runSqlFile(opt.psql, opt.dbUrl, f);
    } catch (e) {
      console.error(`❌ Failed applying ${f}:`, (e as Error).message);
      process.exit(1);
    }
  }

  console.log("✅ Done. DB structure reset & DDLs applied.");
})().catch((e) => {
  console.error("❌ Unexpected error:", e);
  process.exit(1);
});
