import { Client } from "pg";

const DB = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    };

async function main() {
  const client = new Client(DB as any);
  await client.connect();

  const info = await fetch("https://api.binance.com/api/v3/exchangeInfo").then(r => r.json());
  const usdt = info.symbols
    .filter((s: any) => s.status === "TRADING" && s.quoteAsset === "USDT")
    .map((s: any) => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }));

  await client.query("BEGIN");
  for (const s of usdt) {
    await client.query(
      `INSERT INTO settings.coin_universe(symbol, base_asset, quote_asset, enabled, metadata)
       VALUES ($1,$2,$3,true,'{}'::jsonb)
       ON CONFLICT (symbol) DO UPDATE
       SET base_asset=EXCLUDED.base_asset, quote_asset=EXCLUDED.quote_asset, enabled=true`,
      [s.symbol, s.base, s.quote]
    );
  }
  await client.query(`SELECT market.sync_wallet_assets_from_universe_helper();`);
  await client.query("COMMIT");

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
