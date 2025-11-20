import { query } from "@/core/db/pool_server";
import type { SamplingPoint } from "./types";

type LoopsState = {
  buckets: Set<string>;
};

declare global {
  // eslint-disable-next-line no-var
  var __STR_AUX_PERSIST_LOOPS__:
    | { loops: LoopsState; started: boolean }
    | undefined;
}

const PERSIST_INTERVAL_MS = Number(process.env.STR_SAMPLER_PERSIST_MS ?? 5_000);
const pendingBuckets = new Map<string, SamplingPoint>();
let dirtySymbols = new Set<string>();
let persistTimer: NodeJS.Timeout | null = null;

export function enqueueBucketPersistence(point: SamplingPoint) {
  pendingBuckets.set(`${point.symbol}:${point.bucketEnd}`, point);
  dirtySymbols.add(point.symbol);
  if (!persistTimer) {
    persistTimer = setTimeout(flushPendingBuckets, PERSIST_INTERVAL_MS);
  }
}

async function flushPendingBuckets() {
  persistTimer = null;
  if (!pendingBuckets.size) {
    dirtySymbols.clear();
    return;
  }

  const toPersist = Array.from(pendingBuckets.values());
  pendingBuckets.clear();
  dirtySymbols = new Set<string>();

  for (const point of toPersist) {
    try {
      await persistBucket(point);
    } catch (err) {
      console.warn("[str-aux sampler] failed to persist bucket", point.symbol, err);
    }
  }
}

async function persistBucket(point: SamplingPoint) {
  const ts = point.bucketEnd;
  const density = {
    mid: point.mid,
    bestBid: point.bestBid,
    bestAsk: point.bestAsk,
    spread: point.spread,
    bidVolume: point.bidVolume,
    askVolume: point.askVolume,
  };

  const meta = point.bucketMeta ?? defaultBucketMeta(point);

  const stats = {
    v_inner: null,
    v_outer: null,
    v_swap: null,
    v_tendency: null,
    disruption: null,
    amp: null,
    volt: null,
    inertia: null,
    mode_general: null,
    mode_b: null,
  };

  await query(`select str_aux.upsert_sample_5s_model($1, to_timestamp($2/1000.0), $3::jsonb)`, [
    point.symbol,
    ts,
    JSON.stringify({
      bucket_start: point.bucketStart,
      bucket_end: point.bucketEnd,
      book: point.book,
      density,
      stats: {
        bucket_count: meta.bucketCount,
        tick_ms_min: meta.tickMsMin,
        tick_ms_max: meta.tickMsMax,
        tick_ms_avg: meta.tickMsAvg,
        spread_min: meta.spreadMin,
        spread_max: meta.spreadMax,
        spread_avg: meta.spreadAvg,
        mid_min: meta.midMin,
        mid_max: meta.midMax,
        top_bid_vol: meta.topBidVol,
        top_ask_vol: meta.topAskVol,
        liquidity_imbalance: meta.liquidityImbalance,
        quality_flags: meta.qualityFlags,
      },
    }),
  ]);

  await query(
    `select str_aux.upsert_sample_5s(
       $1::text, to_timestamp($2/1000.0),
       $3::numeric, $4::numeric, $5::numeric, $6::numeric,
       $7::numeric, $8::numeric, $9::numeric, $10::numeric,
       $11::smallint, $12::smallint, $13::jsonb,
       $14::smallint, $15::int, $16::int, $17::int,
       $18::numeric, $19::numeric, $20::numeric,
       $21::numeric, $22::numeric,
       $23::numeric,
       $24::jsonb
     )`,
    [
      point.symbol,
      ts,
      stats.v_inner,
      stats.v_outer,
      stats.v_swap,
      stats.v_tendency,
      stats.disruption,
      stats.amp,
      stats.volt,
      stats.inertia,
      stats.mode_general,
      stats.mode_b,
      {
        density,
        bucket_start: point.bucketStart,
        bucket_end: point.bucketEnd,
        top_bid_vol: meta.topBidVol,
        top_ask_vol: meta.topAskVol,
      },
      meta.bucketCount || null,
      meta.tickMsMin,
      meta.tickMsMax,
      meta.tickMsAvg,
      meta.spreadMin,
      meta.spreadMax,
      meta.spreadAvg,
      meta.midMin,
      meta.midMax,
      meta.liquidityImbalance,
      JSON.stringify(meta.qualityFlags ?? []),
    ]
  );
}

export function startPersistenceLoop() {
  if (globalThis.__STR_AUX_PERSIST_LOOPS__?.started) return;
  globalThis.__STR_AUX_PERSIST_LOOPS__ = {
    loops: { buckets: new Set<string>() },
    started: true,
  };
  if (!persistTimer) {
    persistTimer = setTimeout(flushPendingBuckets, PERSIST_INTERVAL_MS);
  }
}

function defaultBucketMeta(point: SamplingPoint) {
  const topBidVol = point.book.bids.slice(0, 5).reduce((sum, lvl) => sum + lvl.qty, 0);
  const topAskVol = point.book.asks.slice(0, 5).reduce((sum, lvl) => sum + lvl.qty, 0);
  const topTotal = topBidVol + topAskVol;
  return {
    bucketCount: 1,
    tickMsMin: null,
    tickMsMax: null,
    tickMsAvg: null,
    spreadMin: point.spread,
    spreadMax: point.spread,
    spreadAvg: point.spread,
    midMin: point.mid,
    midMax: point.mid,
    topBidVol,
    topAskVol,
    liquidityImbalance: topTotal > 0 ? (topBidVol - topAskVol) / topTotal : null,
    qualityFlags: [],
  };
}
