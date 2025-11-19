import { query } from "@/core/db/pool_server";

class SamplerStore {
  private buckets = new Map<string, any>();
  private stepMs = 5000;
  private runtime = { cycleSeconds: 40 };

  applyRuntimeSettings(s?: any) {
    if (s?.cycleSeconds) this.runtime.cycleSeconds = s.cycleSeconds;
  }

  ingest(symbol: string, bids: any[], asks: any[], tsMs: number) {
    const start = Math.floor(tsMs / this.stepMs) * this.stepMs;
    const end = start + this.stepMs;
    let bucket = this.buckets.get(symbol);
    if (!bucket || bucket.end !== end) {
      if (bucket) this.flush(symbol, bucket);
      bucket = { start, end, bids: [], asks: [] };
      this.buckets.set(symbol, bucket);
    }
    bucket.bids.push(...bids);
    bucket.asks.push(...asks);
  }

  private async flush(symbol: string, b: any) {
    if (!b.bids.length && !b.asks.length) return;
    const { density, stats } = computeIDHR(b.bids, b.asks);

    // persist 5 s model
    await query(`select str_aux.upsert_sample_5s_model($1,$2,$3,$4)`,
                [symbol, new Date(b.end).toISOString(), density, stats]);

    // also persist scalar metrics
    await query(`select str_aux.upsert_sample_5s($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
      symbol, new Date(b.end).toISOString(),
      stats.v_inner, stats.v_outer, stats.v_swap, stats.v_tendency,
      stats.disruption, stats.amp, stats.volt, stats.inertia,
      stats.mode_general, stats.mode_b, stats
    ]);

    // roll cycle automatically every 40 s
    await query(`select str_aux.sp_roll_cycle_40s($1, str_aux._floor_to_seconds($2, 40))`,
                [symbol, new Date(b.end).toISOString()]);
  }
}

export const ingestStore = new SamplerStore();

function computeIDHR(bids: any[], asks: any[]) {
  // ⚗️ placeholder for your actual distribution / binning logic
  const density = { bids: bids.length, asks: asks.length };
  const stats = {
    v_inner: 100, v_outer: 101,
    v_swap: 0, v_tendency: 0,
    disruption: 0, amp: 0, volt: 0, inertia: 0,
    mode_general: 0, mode_b: 0
  };
  return { density, stats };
}

export async function POST(req: Request) {
  const { symbol, bids, asks, ts } = await req.json();
  ingestStore.ingest(symbol, bids, asks, Date.parse(ts ?? new Date().toISOString()));
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
