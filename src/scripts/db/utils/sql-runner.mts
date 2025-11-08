#!/usr/bin/env tsx
/**
 * Shared helpers for applying SQL files in development/ops scripts.
 */
import { promises as fs } from "fs";
import path from "path";
import { Client } from "pg";

type BuildClientOptions = {
  appName?: string;
};

export function buildClient(opts: BuildClientOptions = {}) {
  const { appName = "cryptopi-sql-runner" } = opts;

  if (process.env.DATABASE_URL) {
    return new Client({
      connectionString: process.env.DATABASE_URL,
      application_name: appName,
    });
  }

  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;

  if (!database || !user) {
    throw new Error(
      "Set DATABASE_URL or (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD) before running SQL scripts.",
    );
  }

  return new Client({
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    database,
    user,
    password: process.env.PGPASSWORD,
    application_name: appName,
  });
}

export async function listSqlFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sql"))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en"));
}

function hasExecutableStatements(sql: string): boolean {
  const lines = sql.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("--")) continue;
    return true;
  }
  return false;
}

function hasTransactionDirective(sql: string): boolean {
  return /\bBEGIN\b/i.test(sql) || /\bCOMMIT\b/i.test(sql);
}

export type ApplyResult = {
  file: string;
  skipped: boolean;
  reason?: string;
  durationMs?: number;
};

export type ApplyOptions = {
  dryRun?: boolean;
};

export async function applySqlFile(
  client: Client,
  file: string,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const sql = await fs.readFile(file, "utf8");
  if (!sql.trim()) {
    return { file, skipped: true, reason: "empty file" };
  }

  if (!hasExecutableStatements(sql)) {
    return { file, skipped: true, reason: "no executable statements" };
  }

  if (options.dryRun) {
    return { file, skipped: true, reason: "dry-run" };
  }

  const handlesTx = hasTransactionDirective(sql);
  const start = Date.now();

  if (handlesTx) {
    await client.query(sql);
  } else {
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  }

  return { file, skipped: false, durationMs: Date.now() - start };
}
