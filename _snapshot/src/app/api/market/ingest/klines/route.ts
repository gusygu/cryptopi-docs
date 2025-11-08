// src/app/api/market/ingest/klines/route.ts
import { NextResponse } from "next/server";
import { db } from "@/core/db/server";

const NO_STORE = { "Cache-Control": "no-store" };

async function fetchKlines(symbol: string, interval: string, limit = 200) {
  const u = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(
    symbol
  )}&interval=${interval}&limit=${limit}`;
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new Error(`klines ${symbol} ${interval}: ${res.status}`);
  return res.json() as Promise<any[]>;
}

export async function POST(req: Request) {
  const { interval = "30m", symbols: bodySyms } = await req.json().catch(() => ({}));
  const symbols: string[] =
    bodySyms ??
    (
      await db.query<{ symbol: string }>(
        `select symbol from settings.coin_universe where enabled = true`
      )
    ).rows.map(r => r.symbol);

  for (const s of symbols) {
    const rows = await fetchKlines(s, interval, 200);
    for (const k of rows) {
      const [ot, o, h, l, c, volBase, ct, quoteVol, trades, tbb, tbq] = k;
      await db.query(
        `select market.sp_ingest_kline_row($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [s, interval, new Date(ot), new Date(ct), o, h, l, c, volBase, quoteVol, trades, tbb, tbq, 'binance_rest']
      );
    }
  }

  const { rows: latest } = await db.query(
    `select symbol, window_label, open_time, close, volume_base
     from market.klines
     where symbol = any($1::text[]) and window_label = $2
     order by open_time desc limit 300`,
    [symbols, interval]
  );

  return NextResponse.json({ ok: true, interval, wrote: symbols.length, sample: latest.slice(0, 8) }, { headers: NO_STORE });
}
