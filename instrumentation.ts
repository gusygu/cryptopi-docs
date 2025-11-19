// instrumentation.ts
// Runs once per Node runtime (dev + prod) before any route handlers execute.
// We use it to mark all schema sessions as "open" via ops.open_all_sessions_guarded.

export async function register() {
  // Edge runtimes do not support Node pg connections; skip them.
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
    // Do not crash the boot if the DB is momentarily unavailable.
    console.error("[instrumentation] open_all_sessions_guarded failed:", err);
  } finally {
    await client.end().catch(() => {});
  }
}

