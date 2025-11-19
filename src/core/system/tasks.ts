// src/core/system/tasks.ts
import { db } from "@/core/db/server";

const BINANCE_API = "https://api.binance.com";

export async function fetchTickerPrice(symbol: string): Promise<{ symbol: string; price: string }> {
  const res = await fetch(`${BINANCE_API}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ticker ${symbol}: ${res.status}`);
  return res.json();
}

export async function ingestTickerSymbols(symbols: string[]): Promise<number> {
  if (!symbols.length) return 0;
  let count = 0;
  for (const symbol of symbols) {
    const payload = await fetchTickerPrice(symbol);
    await db.query(`select market.apply_ticker_from_payload($1,$2::jsonb)`, [
      symbol,
      JSON.stringify(payload),
    ]);
    count++;
  }
  return count;
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit = 200
): Promise<any[]> {
  const url = `${BINANCE_API}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`klines ${symbol} ${interval}: ${res.status}`);
  return res.json();
}

export async function ingestKlinesSymbols(
  symbols: string[],
  interval: string,
  limit = 200
): Promise<number> {
  if (!symbols.length) return 0;
  let rows = 0;
  for (const symbol of symbols) {
    const klines = await fetchKlines(symbol, interval, limit);
    for (const k of klines) {
      const [ot, o, h, l, c, volBase, ct, quoteVol, trades, tbb, tbq] = k;
      await db.query(
        `select market.sp_ingest_kline_row($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          symbol,
          interval,
          new Date(ot),
          new Date(ct),
          o,
          h,
          l,
          c,
          volBase,
          quoteVol,
          trades,
          tbb,
          tbq,
          "binance_rest",
        ]
      );
      rows++;
    }
  }
  return rows;
}
