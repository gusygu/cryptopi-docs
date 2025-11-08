import { runUnifiedDDL } from "@/core/db/migrate";
import { resolve } from "node:path";

function parseArgs() {
  const onlyIndex = process.argv.indexOf("--only");
  if (onlyIndex >= 0 && process.argv[onlyIndex + 1]) {
    return process.argv[onlyIndex + 1]
      .split(",")
      .map((p) => resolve(process.cwd(), p.trim()))
      .filter(Boolean);
  }
  return undefined;
}

export async function runMigrations() {
  const paths = parseArgs();
  await runUnifiedDDL(paths);
}

if (process.argv[1]?.endsWith("run-migrations.mjs")) {
  runMigrations()
    .then(() => {
      console.log("[run-migrations] completed");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[run-migrations] failed", err);
      process.exit(1);
    });
}
