#!/usr/bin/env tsx
/**
 * Watches DDL directories and reapplies SQL automatically.
 * Usage:
 *   tsx src/scripts/jobs/auto-ddl-ingest.mts           # watch & re-apply on change
 *   tsx src/scripts/jobs/auto-ddl-ingest.mts --once    # single run, then exit
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { applySqlFile, buildClient, listSqlFiles } from "../../db/utils/sql-runner.mjs";

const ARGS = process.argv.slice(2);
const RUN_ONCE = ARGS.includes("--once");
const DRY_RUN = ARGS.includes("--dry-run") || process.env.DRY_RUN === "1";

const DDL_ROOTS = ["ddl", "grants", "seeds"]
  .map((dir) => path.resolve("src/core/db", dir))
  .filter((dir) => fs.existsSync(dir) && fs.lstatSync(dir).isDirectory());
const DEBOUNCE_MS = Number(process.env.DDL_AUTO_APPLY_DEBOUNCE_MS ?? "750");

let client: ReturnType<typeof buildClient> | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let rerunPending = false;
let isApplying = false;

async function ensureClient() {
  if (!client) {
    client = buildClient({ appName: "cryptopi-ddl-auto" });
    await client.connect();
  }
  return client;
}

async function applyAll(reason: string) {
  if (isApplying) {
    rerunPending = true;
    return;
  }
  isApplying = true;

  try {
    const pg = await ensureClient();
    const files = (
      await Promise.all(
        DDL_ROOTS.map(async (root) => {
          try {
            return await listSqlFiles(root);
          } catch (err) {
            console.warn(`?? Failed to list ${root}:`, err);
            return [];
          }
        }),
      )
    ).flat();

    if (!files.length) {
      console.warn("? No DDL files discovered.");
      return;
    }

    console.log(`?? [auto-ddl] Applying ${files.length} files (${reason})`);
    if (DRY_RUN) console.log("?? [auto-ddl] DRY_RUN=1 - preview mode.");

    for (const file of files) {
      const result = await applySqlFile(pg, file, { dryRun: DRY_RUN });
      const name = path.relative(process.cwd(), file);
      if (result.skipped) {
        console.log(`   ↷ ${name} (${result.reason ?? "skipped"})`);
      } else {
        console.log(`   ✓ ${name} (${result.durationMs ?? 0} ms)`);
      }
    }
  } catch (err) {
    console.error("?? [auto-ddl] Failed to apply DDLs:", err);
  } finally {
    isApplying = false;
    if (rerunPending) {
      rerunPending = false;
      scheduleApply("pending changes");
    }
  }
}

function scheduleApply(reason: string) {
  if (RUN_ONCE) return;
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void applyAll(reason);
  }, DEBOUNCE_MS);
}

function startWatchers() {
  for (const root of DDL_ROOTS) {
    if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) continue;
    fs.watch(root, { persistent: true }, (_event, filename) => {
      if (!filename || !filename.toLowerCase().endsWith(".sql")) return;
      if (filename.startsWith("legacy")) return;
      scheduleApply(`change detected: ${filename}`);
    });
    console.log(`?? [auto-ddl] watching ${root}`);
  }
}

async function shutdown() {
  if (client) {
    await client.end().catch(() => {});
    client = null;
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  console.log("\n? [auto-ddl] Caught SIGINT, shutting down...");
  void shutdown();
});

process.on("SIGTERM", () => {
  console.log("\n? [auto-ddl] Caught SIGTERM, shutting down...");
  void shutdown();
});

(async () => {
  await applyAll("initial run");
  if (RUN_ONCE) {
    await shutdown();
    return;
  }
  startWatchers();
})();
