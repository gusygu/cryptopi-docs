// instrumentation.ts
// Runs once per Node runtime (dev + prod) before any route handlers execute.

import { startSamplingUniverseWatcher } from "@/core/features/str-aux/sampling/universeWatcher";
import { startPersistenceLoop } from "@/core/features/str-aux/sampling/persistence";

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { Client } = await import("pg");

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const appName = process.env.APP_NAME ?? "cryptopi-dynamics";
    const appVersion = process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
    await client.query("select ops.open_all_sessions_guarded($1,$2)", [appName, appVersion]);
  } catch (err) {
    console.error("[instrumentation] open_all_sessions_guarded failed:", err);
  } finally {
    await client.end().catch(() => {});
  }

  try {
    startSamplingUniverseWatcher();
  } catch (err) {
    console.error("[instrumentation] failed to start sampler watcher:", err);
  }

  try {
    startPersistenceLoop();
  } catch (err) {
    console.error("[instrumentation] failed to start sampler persistence:", err);
  }
}
