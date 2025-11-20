import { query } from "@/core/db/pool_server";
import { fetchOrderBook } from "@/core/sources/binance";
import { ingestOrderBookTick } from "./buckets";

const DEFAULT_REFRESH_MS = Number(process.env.STR_SAMPLER_REFRESH_MS ?? 60_000);
const DEFAULT_POLL_MS = Number(process.env.STR_SAMPLER_POLL_MS ?? 1_000);
const DEPTH_OPTIONS = [5, 10, 20, 50, 100, 500, 1000] as const;

function resolveDepth(value: number | undefined): (typeof DEPTH_OPTIONS)[number] {
  let depth = Number(value ?? 50);
  if (!Number.isFinite(depth)) depth = 50;
  let closest = DEPTH_OPTIONS[0];
  let minDelta = Math.abs(depth - closest);
  for (const option of DEPTH_OPTIONS) {
    const delta = Math.abs(depth - option);
    if (delta < minDelta) {
      minDelta = delta;
      closest = option;
    }
  }
  return closest;
}

const DEPTH_LIMIT = resolveDepth(Number(process.env.STR_SAMPLER_DEPTH));

class SymbolSampler {
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly symbol: string, private readonly pollMs: number) {}

  start() {
    if (this.stopped) return;
    if (!this.timer) {
      void this.poll();
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async poll() {
    if (this.stopped) return;
    try {
      const snapshot = await fetchOrderBook(this.symbol, DEPTH_LIMIT);
      if (snapshot?.depth) {
        await ingestOrderBookTick({
          symbol: this.symbol,
          bids: snapshot.depth.bids ?? [],
          asks: snapshot.depth.asks ?? [],
          ts: snapshot.ts ?? Date.now(),
          mid: snapshot.mid,
          bestBid: snapshot.bestBid,
          bestAsk: snapshot.bestAsk,
        });
      }
    } catch (err) {
      console.warn("[str-aux sampler] orderbook poll failed", this.symbol, err);
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.poll(), this.pollMs);
      }
    }
  }
}

class UniverseSampler {
  private feeds = new Map<string, SymbolSampler>();
  private refreshTimer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly refreshMs = DEFAULT_REFRESH_MS,
    private readonly pollMs = DEFAULT_POLL_MS
  ) {}

  async start() {
    if (this.running) return;
    this.running = true;
    await this.sync();
    this.refreshTimer = setInterval(() => {
      void this.sync();
    }, this.refreshMs);
  }

  stop() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    for (const feed of this.feeds.values()) {
      feed.stop();
    }
    this.feeds.clear();
    this.running = false;
  }

  private async sync() {
    try {
      const symbols = await this.fetchSymbols();
      const desired = new Set(symbols);

      for (const symbol of symbols) {
        if (this.feeds.has(symbol)) continue;
        const sampler = new SymbolSampler(symbol, this.pollMs);
        this.feeds.set(symbol, sampler);
        sampler.start();
      }

      for (const [symbol, sampler] of this.feeds.entries()) {
        if (!desired.has(symbol)) {
          sampler.stop();
          this.feeds.delete(symbol);
        }
      }
    } catch (err) {
      console.warn("[str-aux sampler] sync failed", err);
    }
  }

  private async fetchSymbols(): Promise<string[]> {
    const { rows } = await query<{ symbol: string }>(
      `SELECT symbol::text AS symbol
         FROM settings.coin_universe
        WHERE COALESCE(enabled,true) = true
     ORDER BY sort_order NULLS LAST, symbol`
    );
    return rows.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __STR_AUX_SAMPLER_WATCHER__:
    | { watcher: UniverseSampler; started: boolean }
    | undefined;
}

export function startSamplingUniverseWatcher() {
  if (process.env.STR_SAMPLER_AUTOSTART === "false") return;
  if (globalThis.__STR_AUX_SAMPLER_WATCHER__?.started) return;
  const watcher = new UniverseSampler();
  globalThis.__STR_AUX_SAMPLER_WATCHER__ = { watcher, started: true };
  watcher.start().catch((err) => {
    console.error("[str-aux sampler] failed to start", err);
  });
}
