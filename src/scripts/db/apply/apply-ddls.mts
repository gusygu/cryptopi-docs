#!/usr/bin/env tsx
/**
 * Cryptopi DB DDL Applier
 * Applies all SQL files from core/db/{ddl,grants,seeds} in order.
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { applySqlFile, buildClient, listSqlFiles } from "../utils/sql-runner.mts";

const DEBUG = process.env.APPLY_DDL_DEBUG === "1";
const ROOT = path.resolve("src/core/db");
const DDL_DIRS = ["ddl", "grants", "seeds"]
  .map((d) => path.join(ROOT, d))
  .filter((dir) => fs.existsSync(dir) && fs.lstatSync(dir).isDirectory());
const DRY_RUN = process.env.DRY_RUN === "1";
const FROM = process.env.FROM;
const ONLY = process.env.ONLY;

async function run() {
  const client = buildClient({ appName: "cryptopi-ddl-apply" });
  await client.connect();

  try {
    const currentDb = await client.query("SELECT current_database()");
    console.log(
      "?? apply-ddls.mts connected to",
      currentDb.rows[0]?.current_database ?? "<unknown>",
    );
  } catch (err) {
    console.warn("?? Unable to determine current database:", err);
  }

  const directories: { dir: string; files: string[] }[] = [];
  for (const dir of DDL_DIRS) {
    const files = await listSqlFiles(dir);
    if (files.length > 0) directories.push({ dir, files });
  }

  if (!directories.length) {
    console.warn("? No SQL directories found – nothing to apply.");
    await client.end();
    return;
  }

  console.log("?? Applying SQL from:");
  for (const entry of directories) {
    console.log(`   • ${entry.dir} (${entry.files.length})`);
  }

  if (DRY_RUN) {
    console.log("?? DRY_RUN=1 - preview only, no execution.");
  }

  for (const { dir, files } of directories) {
    for (const abs of files) {
      const name = path.basename(abs);
      if (FROM && name < FROM) continue;
      if (ONLY && name !== ONLY) continue;

      const label = path.relative(ROOT, abs);
      const result = await applySqlFile(client, abs, { dryRun: DRY_RUN });

      if (result.skipped) {
        if (DEBUG) {
          console.log(`   ↷ Skipped ${label} (${result.reason ?? "no-op"})`);
        }
      } else {
        console.log(`   ✓ ${label} (${result.durationMs ?? 0} ms)`);
      }
    }
  }

  await client.end();
  console.log("? All SQL files processed.");
}

run().catch((err) => {
  console.error("?? Fatal error in apply-ddls:", err);
  process.exit(1);
});
