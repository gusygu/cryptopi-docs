// app/api/str-aux/sources/ingest/bins/route.ts
// Removed NextRequest import because 'next/server' types are not available in this environment
import { query } from "@/core/db/pool_server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Bin = [number, number]; // [price, qty]
type Body = {
  symbol: string;
  ts?: number;           // milliseconds since epoch
  bids: Bin[];
  asks: Bin[];
  meta?: Record<string, any>;
};

export async function POST(req: any) {
  const { symbol, ts, bids, asks, meta }: Body = await req.json();

  if (!symbol || !Array.isArray(bids) || !Array.isArray(asks))
    return new Response(JSON.stringify({ ok: false, error: "symbol, bids[], asks[] required" }), { status: 400 });

  const S = symbol.toUpperCase();
  const nowMs = typeof ts === "number" ? ts : Date.now();

  const bestBid = bids.length ? bids.reduce((m, [p]) => Math.max(m, p), 0) : null;
  const bestAsk = asks.length ? asks.reduce((m, [p]) => Math.min(m, p), Number.POSITIVE_INFINITY) : null;

  await query(
    `select ingest.sp_ingest_book_tick($1, to_timestamp($2/1000.0), $3, $4, $5::jsonb)`,
    [S, nowMs, bestBid, bestAsk, JSON.stringify(meta ?? { source: "api:bins" })]
  );

  // optional: roll a cycle “now” when you get a fresh tick
  await query(
    `select str_aux.sp_roll_cycle_40s($1, str_aux._floor_to_seconds(to_timestamp($2/1000.0), 40))`,
    [S, nowMs]
  );
// ensure symbol is enabled incrementally (no auto-disable)
await query(`select settings.sp_upsert_coin_universe(array[$1]::text[])`, [symbol.toUpperCase()]);

  return new Response(JSON.stringify({ ok: true, symbol: S, bestBid, bestAsk }), { status: 200 });
}
