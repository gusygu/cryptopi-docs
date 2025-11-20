import { DEFAULT_SAMPLER_CONFIG } from "./utils";
import { getSamplingStore } from "./store";
import { enqueueBucketPersistence } from "./persistence";
import type { SamplingPoint, OrderBookLevel } from "./types";

type BucketSnapshot = {
  ts: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  mid: number;
  bestBid: number;
  bestAsk: number;
};

type Bucket = {
  symbol: string;
  start: number;
  end: number;
  snapshots: BucketSnapshot[];
};

const STEP_MS = DEFAULT_SAMPLER_CONFIG.pointIntervalMs;
const POLL_MS = Number(process.env.STR_SAMPLER_POLL_MS ?? 1_000);
const GAP_WARN_MS = Number(process.env.STR_SAMPLER_GAP_WARN_MS ?? POLL_MS * 2);
const MIN_BUCKET_SNAPSHOTS = Number(process.env.STR_SAMPLER_MIN_BUCKET_SAMPLES ?? 2);
const buckets = new Map<string, Bucket>();

export type OrderBookTickPayload = {
  symbol: string;
  ts: number;
  bids: Array<[number | string, number | string]>;
  asks: Array<[number | string, number | string]>;
  mid?: number;
  bestBid?: number;
  bestAsk?: number;
};

export async function ingestOrderBookTick(payload: OrderBookTickPayload) {
  const symbol = String(payload.symbol ?? "").toUpperCase();
  if (!symbol) return;
  const ts = Number.isFinite(payload.ts) ? Number(payload.ts) : Date.now();
  const start = Math.floor(ts / STEP_MS) * STEP_MS;
  const end = start + STEP_MS;

  let bucket = buckets.get(symbol);
  if (!bucket || bucket.end !== end) {
    if (bucket) await flushBucket(bucket);
    bucket = {
      symbol,
      start,
      end,
      snapshots: [],
    };
    buckets.set(symbol, bucket);
  }

  const snapshot: BucketSnapshot = {
    ts,
    bids: toLevels(payload.bids, "bids"),
    asks: toLevels(payload.asks, "asks"),
    mid: Number.isFinite(payload.mid) ? Number(payload.mid) : estimateMid(payload),
    bestBid: Number.isFinite(payload.bestBid) ? Number(payload.bestBid) : maxPrice(payload.bids),
    bestAsk: Number.isFinite(payload.bestAsk) ? Number(payload.bestAsk) : minPrice(payload.asks),
  };
  bucket.snapshots.push(snapshot);
}

async function flushBucket(bucket: Bucket) {
  if (!bucket.snapshots.length) return;
  const point = buildPointFromBucket(bucket);
  const store = getSamplingStore();
  await store.collect(bucket.symbol, { force: true, point });
  enqueueBucketPersistence(point);
}

function buildPointFromBucket(bucket: Bucket): SamplingPoint {
  const last = bucket.snapshots[bucket.snapshots.length - 1]!;
  const avgMid =
    bucket.snapshots.reduce((sum, snap) => sum + snap.mid, 0) /
    Math.max(1, bucket.snapshots.length);
  const bids = aggregateLevels(bucket.snapshots, "bids");
  const asks = aggregateLevels(bucket.snapshots, "asks");
  const bidVol = bids.reduce((sum, lvl) => sum + lvl.qty, 0);
  const askVol = asks.reduce((sum, lvl) => sum + lvl.qty, 0);
  const topVolumes = computeTopVolumes(bids, asks);
  const spreadStats = computeSpreadStats(bucket.snapshots);
  const tickStats = computeTickStats(bucket.snapshots);
  const midStats = computeMidStats(bucket.snapshots);
  const liquidityImbalance =
    topVolumes.total > 0 ? (topVolumes.bid - topVolumes.ask) / topVolumes.total : null;
  const qualityFlags = deriveQualityFlags({
    bucketCount: bucket.snapshots.length,
    hasBook: bids.length > 0 && asks.length > 0,
    tickMsMax: tickStats.max,
  });

  return {
    symbol: bucket.symbol,
    ts: bucket.end,
    mid: avgMid,
    bestBid: last.bestBid,
    bestAsk: last.bestAsk,
    spread: Math.abs(last.bestAsk - last.bestBid),
    bidVolume: bidVol,
    askVolume: askVol,
    bucketStart: bucket.start,
    bucketEnd: bucket.end,
    book: {
      bids,
      asks,
    },
    bucketMeta: {
      bucketCount: bucket.snapshots.length,
      tickMsMin: tickStats.min,
      tickMsMax: tickStats.max,
      tickMsAvg: tickStats.avg,
      spreadMin: spreadStats.min,
      spreadMax: spreadStats.max,
      spreadAvg: spreadStats.avg,
      midMin: midStats.min,
      midMax: midStats.max,
      topBidVol: topVolumes.bid,
      topAskVol: topVolumes.ask,
      liquidityImbalance,
      qualityFlags,
    },
  };
}

function toLevels(
  rows: Array<[number | string, number | string]> | undefined,
  side: "bids" | "asks"
): OrderBookLevel[] {
  if (!Array.isArray(rows)) return [];
  const levels: OrderBookLevel[] = [];
  for (const row of rows) {
    const price = Number(row?.[0]);
    const qty = Number(row?.[1]);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) continue;
    levels.push({ price, qty });
  }
  return side === "bids"
    ? levels.sort((a, b) => b.price - a.price)
    : levels.sort((a, b) => a.price - b.price);
}

function aggregateLevels(
  snapshots: BucketSnapshot[],
  side: "bids" | "asks"
): OrderBookLevel[] {
  const map = new Map<number, number>();
  for (const snap of snapshots) {
    const levels = side === "bids" ? snap.bids : snap.asks;
    for (const lvl of levels) {
      const key = lvl.price;
      map.set(key, (map.get(key) ?? 0) + lvl.qty);
    }
  }
  const aggregated = Array.from(map.entries()).map(([price, qty]) => ({
    price,
    qty,
  }));
  if (side === "bids") {
    aggregated.sort((a, b) => b.price - a.price);
  } else {
    aggregated.sort((a, b) => a.price - b.price);
  }
  return aggregated;
}

function computeSpreadStats(snapshots: BucketSnapshot[]) {
  if (!snapshots.length) return { min: null, max: null, avg: null };
  const spreads = snapshots.map((snap) => Math.max(0, snap.bestAsk - snap.bestBid));
  if (!spreads.length) return { min: null, max: null, avg: null };
  return {
    min: Math.min(...spreads),
    max: Math.max(...spreads),
    avg: spreads.reduce((sum, val) => sum + val, 0) / spreads.length,
  };
}

function computeMidStats(snapshots: BucketSnapshot[]) {
  if (!snapshots.length) return { min: null, max: null };
  const mids = snapshots.map((snap) => snap.mid).filter((val) => Number.isFinite(val));
  if (!mids.length) return { min: null, max: null };
  return { min: Math.min(...mids), max: Math.max(...mids) };
}

function computeTickStats(snapshots: BucketSnapshot[]) {
  if (snapshots.length <= 1) return { min: null, max: null, avg: null };
  const sorted = snapshots.map((snap) => snap.ts).sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i] - sorted[i - 1];
    if (diff >= 0) diffs.push(diff);
  }
  if (!diffs.length) return { min: null, max: null, avg: null };
  const min = Math.min(...diffs);
  const max = Math.max(...diffs);
  const avg = Math.round(diffs.reduce((sum, val) => sum + val, 0) / diffs.length);
  return { min, max, avg };
}

function computeTopVolumes(bids: OrderBookLevel[], asks: OrderBookLevel[]) {
  const topBid = bids.slice(0, 5).reduce((sum, lvl) => sum + lvl.qty, 0);
  const topAsk = asks.slice(0, 5).reduce((sum, lvl) => sum + lvl.qty, 0);
  return { bid: topBid, ask: topAsk, total: topBid + topAsk };
}

function deriveQualityFlags(input: { bucketCount: number; hasBook: boolean; tickMsMax: number | null }) {
  const flags: string[] = [];
  if (!input.bucketCount) flags.push("empty_bucket");
  else if (input.bucketCount < MIN_BUCKET_SNAPSHOTS) flags.push("low_samples");
  if (!input.hasBook) flags.push("empty_book");
  if (input.tickMsMax != null && input.tickMsMax > GAP_WARN_MS) flags.push("irregular_spacing");
  return flags;
}

function estimateMid(payload: OrderBookTickPayload): number {
  const bid = maxPrice(payload.bids);
  const ask = minPrice(payload.asks);
  if (Number.isFinite(bid) && Number.isFinite(ask)) {
    return (bid + ask) / 2;
  }
  return Number.isFinite(bid) ? (bid as number) : Number.isFinite(ask) ? (ask as number) : 0;
}

function maxPrice(rows?: Array<[number | string, number | string]>): number {
  if (!Array.isArray(rows) || !rows.length) return NaN;
  return rows.reduce((max, row) => {
    const price = Number(row?.[0]);
    return Number.isFinite(price) ? Math.max(max, price) : max;
  }, -Infinity);
}

function minPrice(rows?: Array<[number | string, number | string]>): number {
  if (!Array.isArray(rows) || !rows.length) return NaN;
  return rows.reduce((min, row) => {
    const price = Number(row?.[0]);
    return Number.isFinite(price) ? Math.min(min, price) : min;
  }, Infinity);
}
