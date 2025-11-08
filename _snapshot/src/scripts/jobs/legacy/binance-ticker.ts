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

  const { rows: syms } = await client.query(
    `SELECT symbol, base_asset, quote_asset
       FROM settings.coin_universe
      WHERE enabled
   ORDER BY sort_order NULLS LAST, symbol`
  );

  if (!syms.length) {
    console.warn("[binance-ticker] settings.coin_universe is empty; nothing to hydrate.");
    await client.end();
    return;
  }

  const book = await fetch("https://api.binance.com/api/v3/ticker/bookTicker").then((r) =>
    r.json()
  );
  const bySym = new Map(book.map((x: any) => [x.symbol, x]));

  await client.query("BEGIN");
  for (const { symbol, base_asset, quote_asset } of syms) {
    const t = bySym.get(symbol);
    if (!t) continue;
    const ts = new Date();

    const bid = Number(t.bidPrice);
    const ask = Number(t.askPrice);
    const price =
      Number.isFinite(bid) && Number.isFinite(ask)
        ? (bid + ask) / 2
        : Number.isFinite(bid)
        ? bid
        : Number.isFinite(ask)
        ? ask
        : Number(t.price ?? t.lastPrice ?? NaN);

    if (!Number.isFinite(price)) {
      continue;
    }

    const stats = {
      bidPrice: Number.isFinite(bid) ? bid : null,
      bidQty: Number.isFinite(Number(t.bidQty)) ? Number(t.bidQty) : null,
      askPrice: Number.isFinite(ask) ? ask : null,
      askQty: Number.isFinite(Number(t.askQty)) ? Number(t.askQty) : null,
      spread: Number.isFinite(bid) && Number.isFinite(ask) ? ask - bid : null,
    };

    const baseAsset =
      base_asset ??
      (symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol.replace(/USDT$/, "") || null);
    const quoteAsset =
      quote_asset ?? (symbol.endsWith("USDT") ? "USDT" : null);

    if (baseAsset && quoteAsset) {
      await client.query(
        `INSERT INTO market.symbols(symbol, base, quote)
         VALUES ($1,$2,$3)
         ON CONFLICT (symbol) DO NOTHING`,
        [symbol, baseAsset, quoteAsset]
      );
    }

    await client.query(
      `INSERT INTO market.ticker_latest(symbol, ts, price, stats, meta)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
       ON CONFLICT (symbol) DO UPDATE
         SET ts    = EXCLUDED.ts,
             price = EXCLUDED.price,
             stats = EXCLUDED.stats,
             meta  = EXCLUDED.meta`,
      [symbol, ts, price, JSON.stringify(stats), JSON.stringify(t)]
    );

    // history (optional):
    // await client.query(
    //   `INSERT INTO market.ticker_ticks(symbol, ts, bid_price, ask_price)
    //    VALUES ($1,$2,$3,$4)`,
    //   [symbol, ts, Number(t.bidPrice), Number(t.askPrice)]
    // );
  }
  await client.query("COMMIT");
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
