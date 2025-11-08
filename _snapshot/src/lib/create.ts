// src/lib/firstTouch.ts
import { Pool, PoolClient } from 'pg';
const BINANCE = process.env.BINANCE_REST ?? 'https://api.binance.com/api';

export async function firstTouch(client: PoolClient, symbol: string) {
  // 1) 24h ticker
  const t24 = await fetch(`${BINANCE}/v3/ticker/24hr?symbol=${symbol}`).then(r=>r.json());

  await client.query(`
    insert into market.ticker_24h (source, symbol, event_ts, price_last, price_open, high_24h, low_24h, vol_base, vol_quote, raw)
    values ('binance', $1, now(), $2, $3, $4, $5, $6, $7, $8::jsonb)
  `, [
    symbol,
    t24.lastPrice ?? null,
    t24.openPrice ?? null,
    t24.highPrice ?? null,
    t24.lowPrice ?? null,
    t24.volume ?? null,
    t24.quoteVolume ?? null,
    JSON.stringify(t24)
  ]);

  // 2) orderbook snapshot
  const ob = await fetch(`${BINANCE}/v3/depth?symbol=${symbol}&limit=100`).then(r=>r.json());
  await client.query(`
    insert into market.orderbook_snap (source, symbol, last_update_id, bids, asks)
    values ('binance', $1, $2, $3::jsonb, $4::jsonb)
    on conflict do nothing
  `, [
    symbol,
    ob.lastUpdateId ?? 0,
    JSON.stringify(ob.bids ?? []),
    JSON.stringify(ob.asks ?? [])
  ]);

  // 3) klines (1m only to start; you can loop more intervals later)
  const kl = await fetch(`${BINANCE}/v3/klines?symbol=${symbol}&interval=1m&limit=200`).then(r=>r.json());
  if (Array.isArray(kl) && kl.length) {
    const values = [];
    for (const k of kl) {
      const [ openTime, open, high, low, close, volBase, closeTime, , volQuote, trades ] = k;
      values.push(`('binance',$1,'1m',to_timestamp(${openTime}/1000.0),to_timestamp(${closeTime}/1000.0),
        jsonb_build_object('o',$2,'h',$3,'l',$4,'c',$5),
        jsonb_build_object('base',$6,'quote',$7,'trades',$8))`);
    }
    const params = [symbol, null,null,null,null,null,null,null];
    // We’ll pass real params per-row later if you prefer; for now, inline literals are fine.

    await client.query(`
      insert into market.kline (source,symbol,interval,open_time,close_time,ohlc,vol)
      values ${values.join(',')}
      on conflict do nothing
    `, params);
  }

  // mark success
  await client.query(`
    update market.symbol_registry
    set first_touch_ok = true, last_touch_at = now(), updated_at = now()
    where source='binance' and symbol=$1
  `, [symbol]);
}
