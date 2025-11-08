// src/scripts/jobs/cin-refresh.mts
import "dotenv/config";
import { Pool } from "pg";
import { getActiveCoins } from "@/core/poller";             // ← NEW
// …keep your existing imports

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

  if (!coins.length) throw new Error("CIN: no coins configured");

  // >>> your existing CIN writer code, just ensure cycle_ts is bigint
  // Example shape (keep your actual logic):
  // const { cycle_ts, rows } = await computeCinSnapshot({ pool, coins, appSessionId: APP_SESSION_ID });
  // await pool.query(
  //   `insert into public.cin_aux_cycle(app_session, symbol, wallet_usdt, price_usdt, luggage_cycle_usdt, cycle_ts)
  //    values ${rows.map((_,i)=>`($1, $${i*5+2}, $${i*5+3}, $${i*5+4}, $${i*5+5}, $${i*5+6})`).join(",")}
  //    on conflict (app_session, symbol, cycle_ts)
  //    do update set wallet_usdt=excluded.wallet_usdt, price_usdt=excluded.price_usdt, luggage_cycle_usdt=excluded.luggage_cycle_usdt`,
  //   [APP_SESSION_ID, /* …flattened values… making sure `cycle_ts` is Number(cycle_ts) */]
  // );

  await pool.end();
}

main().catch((e) => {
  console.error("[cin-refresh] error", e);
  process.exit(1);
});
