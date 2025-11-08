import "dotenv/config";
import { NextResponse } from "next/server";
import { Pool } from "pg";
// in any route that needs klines
import { fetchKlines as fetchBinanceKlines } from "@/core/sources/binance";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wins = (url.searchParams.get("wins") ?? "1m,3m,5m,15m,1h").split(",");
  const limit = Number(url.searchParams.get("limit") ?? "120");

  const db = await pool.connect();
  try {
    // 1) symbols from settings (reactive)
    const { rows } = await db.query(`
      SELECT symbol::text AS symbol
      FROM settings.coin_universe
      WHERE COALESCE(enabled,true)=true
      ORDER BY symbol
    `);
    const symbols = rows.map(r => r.symbol);

    // 2) for each symbol×window, pull & upsert via your stored proc
    let inserted = 0;
    for (const s of symbols) {
      for (const w of wins) {
        const kl = await fetchBinanceKlines(s, w, { limit }); // returns OHLCV array
        for (const k of kl) {
          await db.query(`
            SELECT market.sp_ingest_kline_row(
              $1::text, $2::text,
              to_timestamp($3/1000.0)::timestamptz, to_timestamp($4/1000.0)::timestamptz,
              $5,$6,$7,$8,$9,$10,$11,$12,$13,$14::text
            )
          `, [
            s, w,
            k[0], k[6],  // openTime, closeTime (ms)
            k[1], k[2], k[3], k[4], k[5],     // open, high, low, close, volume
            k[7], k[8], k[9], k[10], "binance"// quoteVolume, trades, takerBuyBase, takerBuyQuote, source
          ]);
          inserted++;
        }
      }
    }
    return NextResponse.json({ ok: true, symbols, wins, inserted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  } finally {
    db.release();
  }
}
