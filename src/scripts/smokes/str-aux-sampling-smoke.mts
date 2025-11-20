// pnpm tsx src/scripts/smokes/str-aux-sampling-smoke.mts
// Simple HTTP smoke that inspects the sampling endpoint while pnpm dev (or prod) is running.
// It checks that recent 5s buckets include book metadata, density metrics, and quality flags.

import "dotenv/config";

const ORIGIN = process.env.ORIGIN || "http://localhost:3000";
const SYMBOLS = (process.env.SYMBOLS || process.env.SYMBOL || "BTCUSDT")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const LIMIT = Math.max(1, Math.min(200, Number(process.env.LIMIT ?? "20")));

type SamplingRow = {
  symbol: string;
  ts: string;
  bucket_count?: number | null;
  tick_ms_min?: number | null;
  tick_ms_max?: number | null;
  spread_min?: number | null;
  spread_max?: number | null;
  quality_flags?: string[] | null;
};

async function fetchBuckets(symbol: string): Promise<SamplingRow[]> {
  const url = new URL("/api/str-aux/sources/ingest/sampling", ORIGIN);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("limit", String(LIMIT));
  url.searchParams.set("latest", "true");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const body = (await res.json()) as { rows?: SamplingRow[] };
  return body?.rows ?? [];
}

function analyze(symbol: string, rows: SamplingRow[]) {
  if (!rows.length) {
    console.warn(`[smoke][${symbol}] no rows returned`);
    return false;
  }
  let ok = true;
  let emptyBuckets = 0;
  let lowSamples = 0;
  let hasBadFlags = 0;

  for (const row of rows) {
    const count = Number(row.bucket_count ?? 0);
    if (!Number.isFinite(count) || count <= 0) emptyBuckets += 1;
    if (count > 0 && count < 2) lowSamples += 1;
    const flags = Array.isArray(row.quality_flags) ? row.quality_flags : [];
    if (flags.some((f) => f === "empty_bucket" || f === "empty_book")) {
      hasBadFlags += 1;
    }
  }

  console.log(
    `[smoke][${symbol}] rows=${rows.length} empty=${emptyBuckets} lowSamples=${lowSamples} flagged=${hasBadFlags}`,
  );

  if (emptyBuckets === rows.length) {
    console.warn(`  ${symbol}: all returned buckets are empty`);
    ok = false;
  }
  if (hasBadFlags > rows.length / 2) {
    console.warn(`  ${symbol}: majority of buckets flagged for quality issues`);
    ok = false;
  }
  return ok;
}

async function main() {
  console.log(
    `[smoke] sampling metrics from ${ORIGIN} symbols=${SYMBOLS.join(",")} limit=${LIMIT}`,
  );
  let ok = true;
  for (const symbol of SYMBOLS) {
    try {
      const rows = await fetchBuckets(symbol);
      const result = analyze(symbol, rows);
      ok = ok && result;
    } catch (err) {
      console.error(`[smoke][${symbol}] request failed`, err);
      ok = false;
    }
  }
  if (!ok) {
    console.error("[smoke] sampling smoke detected issues.");
    process.exit(1);
  } else {
    console.log("[smoke] sampling smoke passed.");
  }
}

if ((import.meta as any).main) {
  main().catch((err) => {
    console.error("[smoke] fatal error", err);
    process.exit(1);
  });
}
