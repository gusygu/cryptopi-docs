export class SamplerStore {
  constructor(private cfg: { stepMs: number; endpoint: string }) {}
  private buckets = new Map<string, any>();

  ingest(symbol: string, bids: any[], asks: any[], tsMs: number) {
    const step = this.cfg.stepMs;
    const start = Math.floor(tsMs / step) * step;
    const end = start + step;
    let bucket = this.buckets.get(symbol);
    if (!bucket || bucket.end !== end) {
      if (bucket) this.flush(symbol, bucket);
      bucket = { start, end, bids: [], asks: [] };
      this.buckets.set(symbol, bucket);
    }
    bucket.bids.push(...bids);
    bucket.asks.push(...asks);
  }

  private async flush(symbol: string, bucket: any) {
    if (!bucket.bids.length && !bucket.asks.length) return;
    const metrics = computeMetrics(bucket.bids, bucket.asks); // your IDHR distribution
    await fetch(this.cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, ts: new Date(bucket.end).toISOString(), metrics }),
    }).catch(() => {});
  }
}
