import { Client } from "pg";

const DB = process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
};

// map settings.windows.label → Binance interval (adjust if needed)
const mapInterval = (label: string) => label; // e.g., '1m','5m','1h'

async function main() {
  const client = new Client(DB as any);
  await client.connect();

  const { rows: syms } = await client.query(
    `SELECT symbol FROM settings.coin_universe WHERE enabled ORDER BY symbol`
  );
  const { rows: wins } = await client.query(`SELECT label FROM settings.windows ORDER BY ordinal_position`);

  for (const { symbol } of syms) {
    for (const { label } of wins) {
      const url = new URL("https://api.binance.com/api/v3/klines");
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("interval", mapInterval(label));
      url.searchParams.set("limit", "500");

      const kl = await fetch(url.toString()).then(r => r.json());
      await client.query("BEGIN");
      for (const k of kl) {
        const [openTime, open, high, low, close, volume, closeTime] = k;
        await client.query(
          `INSERT INTO market.klines(symbol, window_label, open_time, close_time, open, high, low, close, volume)
           VALUES ($1,$2,to_timestamp($3/1000.0),to_timestamp($4/1000.0),$5,$6,$7,$8,$9)
           ON CONFLICT (symbol, window_label, open_time) DO NOTHING`,
          [symbol, label, openTime, closeTime, open, high, low, close, volume]
        );
      }
      await client.query("COMMIT");
    }
  }

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
