// scripts/seed-db.ts
import pg from "pg";

const coins = ["USDT","BTC","ETH","SOL"];

async function run() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const now = Date.now();
  try {
    await client.query("BEGIN");

    // re-seed balances (idempotent-ish)
    const balances: Record<string, number> = { USDT: 12000, BTC: 1.35, ETH: 14.2, SOL: 420 };
    for (const [asset, amount] of Object.entries(balances)) {
      await client.query(
        `INSERT INTO balances (asset, amount, ts_epoch_ms)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [asset, amount, now]
      );
    }

    // write a fresh id_pct snapshot; tweak numbers as you like
    const pairs: Array<[string,string,number]> = [
      ["BTC","USDT", 0.95], ["ETH","USDT", 0.55], ["SOL","USDT", 1.15],
      ["BTC","ETH",  0.25], ["ETH","BTC", -0.35], ["SOL","BTC",  1.05],
      ["BTC","SOL",  0.70], ["ETH","SOL",  0.30], ["SOL","ETH", -0.15],
    ];
    for (const [b,q,idp] of pairs) {
      await client.query(
        `INSERT INTO id_pct_pairs (base, quote, id_pct, ts_epoch_ms)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [b, q, idp, now]
      );
    }

    await client.query("COMMIT");
    console.log("Seed complete @", new Date(now).toISOString());
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("seed error:", e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
