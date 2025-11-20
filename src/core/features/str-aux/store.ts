// In-memory per-symbol ring buffer + DB persistence helpers (5s samples).
import { withClient } from "@/core/db/pool_server";

export type Metric = {
  v_inner?: number | null;
  v_outer?: number | null;
  v_swap?: number | null;
  v_tendency?: number | null; // DDL name
  disruption?: number | null;
  amp?: number | null;
  volt?: number | null;
  inertia?: number | null;
  mode_general?: number | null;
  mode_b?: number | null;
  attrs?: Record<string, unknown> | null;
};

export type Sample = {
  symbol: string;
  ts: string;        // ISO string; server casts to timestamptz
  metrics: Metric;
};

class Ring<T> {
  private buf: (T | undefined)[];
  private idx = 0;
  private filled = false;

  constructor(private capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new Error("Ring capacity must be an integer >= 2");
    }
    this.buf = new Array(capacity);
  }

  push(v: T) {
    this.buf[this.idx] = v;
    this.idx = (this.idx + 1) % this.buf.length;
    if (this.idx === 0) this.filled = true;
  }

  newestFirst(limit?: number): T[] {
    const out: T[] = [];
    const n = this.filled ? this.buf.length : this.idx;
    const take = Math.min(limit ?? n, n);
    for (let i = 0; i < take; i++) {
      const j = (this.idx - 1 - i + this.buf.length) % this.buf.length;
      const v = this.buf[j];
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  size(): number {
    return this.filled ? this.buf.length : this.idx;
  }
}

class SamplingStore {
  private rings = new Map<string, Ring<Sample>>();
  constructor(private perSymbolCapacity = 12 * 60) {} // 12*60 * 5s ≈ 1 hour

  private ensure(symbol: string) {
    let r = this.rings.get(symbol);
    if (!r) {
      r = new Ring<Sample>(this.perSymbolCapacity);
      this.rings.set(symbol, r);
    }
    return r;
  }

  push(sample: Sample) {
    this.ensure(sample.symbol).push(sample);
  }

  bulkPush(samples: Sample[]) {
    for (const s of samples) this.push(s);
  }

  window(symbols?: string[], limitPerSymbol?: number): Record<string, Sample[]> {
    const list = symbols && symbols.length ? symbols : Array.from(this.rings.keys());
    const out: Record<string, Sample[]> = {};
    for (const sym of list) {
      const ring = this.rings.get(sym);
      out[sym] = ring ? ring.newestFirst(limitPerSymbol) : [];
    }
    return out;
  }

  symbols(): string[] {
    return Array.from(this.rings.keys());
  }
}

let _store: SamplingStore | null = null;
export function getSamplingStore() {
  if (!_store) _store = new SamplingStore();
  return _store;
}

/* ------------------------ DB persistence (5s) ------------------------ */

export async function upsertSample5s(sample: Sample) {
  const { symbol, ts, metrics } = sample;
  const {
    v_inner = null,
    v_outer = null,
    v_swap = null,
    v_tendency = null,
    disruption = null,
    amp = null,
    volt = null,
    inertia = null,
    mode_general = null,
    mode_b = null,
    attrs = {},
  } = metrics ?? {};

  await withClient(async (c) => {
    await c.query(
      `select str_aux.upsert_sample_5s(
         $1::text, $2::timestamptz,
         $3::numeric, $4::numeric, $5::numeric, $6::numeric,
         $7::numeric, $8::numeric, $9::numeric, $10::numeric,
         $11::int, $12::int, $13::jsonb,
         $14::smallint, $15::int, $16::int, $17::int,
         $18::numeric, $19::numeric, $20::numeric,
         $21::numeric, $22::numeric,
         $23::numeric,
         $24::jsonb
       )`,
      [
        symbol,
        ts,
        v_inner,
        v_outer,
        v_swap,
        v_tendency,
        disruption,
        amp,
        volt,
        inertia,
        mode_general,
        mode_b,
        attrs ?? {},
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        [],
      ]
    );
  });
}

export async function batchUpsert5s(samples: Sample[], chunk = 500) {
  for (let i = 0; i < samples.length; i += chunk) {
    const slab = samples.slice(i, i + chunk);
    for (const s of slab) await upsertSample5s(s);
  }
}

/** Persist everything currently buffered for the provided symbols (or all). */
export async function flushBuffered(symbols?: string[]) {
  const store = getSamplingStore();
  const win = store.window(symbols);
  const all: Sample[] = [];
  for (const k of Object.keys(win)) all.push(...win[k]);
  if (!all.length) return { persisted: 0 };
  await batchUpsert5s(all);
  return { persisted: all.length };
}

// src/core/sampling/store.ts
type OBPoint = { price: number; qty: number };
type Bucket = {
  fromMs: number; toMs: number;
  bids: OBPoint[]; asks: OBPoint[];
};

export class SamplerStore {
  private buckets = new Map<string, Bucket>(); // symbol -> active 5s bucket
  constructor(private readonly stepMs = 5000) {}

  ingest(symbol: string, bids: OBPoint[], asks: OBPoint[], tsMs: number) {
    const fromMs = Math.floor(tsMs / this.stepMs) * this.stepMs;
    const toMs = fromMs + this.stepMs;
    const b = this.buckets.get(symbol) ?? { fromMs, toMs, bids: [], asks: [] };
    if (b.fromMs !== fromMs) {
      // flush old and start new
      this.flush(symbol, b);
      this.buckets.set(symbol, { fromMs, toMs, bids: [], asks: [] });
    }
    const cur = this.buckets.get(symbol)!;
    cur.bids.push(...bids);
    cur.asks.push(...asks);
  }

  private async flush(symbol: string, b: Bucket) {
    if (!b.bids.length && !b.asks.length) return;
    const density = idhrDensity(b.bids, b.asks);   // ← your binning/compression
    const stats = summarizeDensity(density);       // mean/var/spread, etc.

    await fetch("/api/str-aux/sampling", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbol,
        ts: new Date(b.toMs).toISOString(),
        model: { density, stats }
      })
    }).catch(() => {/* best-effort; optionally queue retry */});
  }
}

// stubs — wire to your IDHR implementation
function idhrDensity(bids: OBPoint[], asks: OBPoint[]): number[] { /* ... */ return []; }
function summarizeDensity(d: number[]) { /* ... */ return {  }; }
