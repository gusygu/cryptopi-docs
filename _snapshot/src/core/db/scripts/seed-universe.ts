/**
 * Dynamically seeds all base tables based on settings_coin_universe.
 * Fills balances, pair_availability, id_pct_pairs with non-zero data.
 */
import { db } from "@/lib/db.server";

type Sym = { symbol: string };

export async function seedUniverse() {
  // 1) ensure universe exists
  let { rows: universe } = await db.query<Sym>("SELECT symbol FROM settings_coin_universe");
  if (!universe.length) {
    console.log("⚠️  settings_coin_universe empty — inserting defaults");
    await db.query(`
      INSERT INTO settings_coin_universe(symbol)
      VALUES ('USDT'),('BTC'),('ETH'),('BNB'),('SOL'),('ADA'),
             ('XRP'),('XPL'),('PEPE'),('DOGE')
      ON CONFLICT DO NOTHING;
    `);
    ({ rows: universe } = await db.query<Sym>("SELECT symbol FROM settings_coin_universe"));
  }

  console.log("🌐 Universe:", universe.map(s => s.symbol).join(", "));

  // 2) balances snapshot (USDT large, others small but >0)
  await Promise.all(
    universe.map(({ symbol }) =>
      db.query(
        `INSERT INTO balances (asset, amount, ts_epoch_ms)
         VALUES ($1, $2, (extract(epoch from now())*1000)::bigint)
         ON CONFLICT DO NOTHING`,
        [symbol, symbol === "USDT" ? 10000 : Math.max(0.001, Math.random() * 10)]
      )
    )
  );

  // 3) availability + id_pct for all ordered pairs
  for (const { symbol: base } of universe) {
    for (const { symbol: quote } of universe) {
      if (base === quote) continue;

      await db.query(
        `INSERT INTO pair_availability (base, quote, tradable, ts_epoch_ms)
         VALUES ($1,$2,true,(extract(epoch from now())*1000)::bigint)
         ON CONFLICT DO NOTHING`,
        [base, quote]
      );

      const idPct = (Math.random() * 3 - 1.5).toFixed(4); // (-1.5%, +1.5%)
      await db.query(
        `INSERT INTO id_pct_pairs (base, quote, id_pct, ts_epoch_ms)
         VALUES ($1,$2,$3::numeric,(extract(epoch from now())*1000)::bigint)
         ON CONFLICT DO NOTHING`,
        [base, quote, idPct]
      );
    }
  }

  console.log("✅ Universe seeded");
}
