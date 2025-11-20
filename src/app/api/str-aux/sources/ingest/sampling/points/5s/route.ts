import { ingestOrderBookTick } from "@/core/features/str-aux/sampling";

type Payload = {
  symbol: string;
  bids: Array<[number | string, number | string]>;
  asks: Array<[number | string, number | string]>;
  ts?: number;
  mid?: number;
  bestBid?: number;
  bestAsk?: number;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<Payload>;
  if (!body?.symbol || !Array.isArray(body.bids) || !Array.isArray(body.asks)) {
    return new Response(JSON.stringify({ ok: false, error: "symbol, bids[], asks[] required" }), {
      status: 400,
    });
  }

  await ingestOrderBookTick({
    symbol: body.symbol,
    bids: body.bids,
    asks: body.asks,
    ts: typeof body.ts === "number" ? body.ts : Date.now(),
    mid: typeof body.mid === "number" ? body.mid : undefined,
    bestBid: typeof body.bestBid === "number" ? body.bestBid : undefined,
    bestAsk: typeof body.bestAsk === "number" ? body.bestAsk : undefined,
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
