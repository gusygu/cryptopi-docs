// src/scripts/jobs/mea-refresh.mts
import "dotenv/config";
import { Pool } from "pg";
import { getActiveCoins } from "@/core/poller";             // ← NEW
// …keep your existing imports (builders, sql, etc.)

const APP_SESSION_ID =
  process.env.APP_SESSION_ID ?? process.env.APP_SESSION ?? null;

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  // ⬇️ REACTIVE coins (from Settings/DB). Env only as ultimate fallback.
  const coins =
    (await getActiveCoins().catch(() => null)) ??
    (process.env.COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,DOGE,USDT")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  if (!coins.length) throw new Error("MEA: no coins configured");

  // >>> your existing MEA computation/upsert code stays as-is, just pass `coins`
  // e.g.:
  // const out = await buildMeaAux({ pool, coins, appSessionId: APP_SESSION_ID });
  // await upsertMea(pool, out);

  await pool.end();
}

main().catch((e) => {
  console.error("[mea-refresh] error", e);
  process.exit(1);
});
