import "dotenv/config";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const runner = resolve(process.cwd(), "src/scripts/executors/db-run.mjs");
const cleanupSql = resolve(process.cwd(), "core/db/cleanup.sql");

const p = spawn(process.execPath, [runner, cleanupSql], {
  stdio: "inherit",
  env: process.env,
});
p.on("exit", (code) => process.exit(code ?? 1));
