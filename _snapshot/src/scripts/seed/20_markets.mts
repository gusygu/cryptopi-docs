import { getPool } from "../../../legacy/pool";

function splitPair(s: string) {
  // naive splitter for *USDT symbols
  if (s.endsWith("USDT")) return { base: s.slice(0, -4), quote: "USDT" };
  if (s.endsWith("USDC")) return { base: s.slice(0, -4), quote: "USDC" };
  if (s.endsWith("BTC"))  return { base: s.slice(0, -3), quote: "BTC"  };
  // fallback: first 3 letters as base (tweak if you need)
  return { base: s.slice(0, 3), quote: s.slice(3) };
}

export default async function seedMarkets() {
  const pool = getPool();
  const c = await pool.connect();
  const symbols = (process.env.SYMBOLS ?? "BTCUSDT,ETHUSDT").split(",").map(s => s.trim()).filter(Boolean);
  try {
    await c.query("BEGIN");

    // market.symbol (adjust schema/cols to your 03_market.sql)
    for (const s of symbols) {
      const { base, quote } = splitPair(s);
      await c.query(`
        INSERT INTO market.symbol (base, quote, tick_size)
        VALUES ($1,$2,'0.01')
        ON CONFLICT (base, quote) DO NOTHING;
      `, [base, quote]);
    }

    // (optional) market.pair, market.exchange_symbol, etc. if you have them
    // Upsert patterns only — never delete here.

    await c.query("COMMIT");
    console.log("✅ markets seeded");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally { c.release(); }
}
