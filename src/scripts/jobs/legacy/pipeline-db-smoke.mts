
import { fetchLiveSnapshotBasic } from "../../../core/pipelines/pipeline.api";
import { upsertMatrixGrid } from "../../../core/pipelines/pipeline.db";
import type { PipelineSettings } from "../../../core/pipelines/types";
import { appendAppLedger } from "../../../core/db/pool_server";

(async () => {
  console.log("=== Pipeline -> DB Smoke (API → DB) ===");

  const settings: PipelineSettings = {
    matrices: {
      source: "binance",
      quote: "USDT",
      bases: ["BTC","ETH","ADA","SOL","XRP","DOT","LINK","MATIC"],
      period: "1m",
      persist: true,
    },
    scales: {
      cycle: { period: "1m" },
    },
  };

  const tick = { cycleTs: Date.now(), periodMs: 60_000 } as const;
  const snapshot = await fetchLiveSnapshotBasic(
    settings.matrices.bases,
    settings.matrices.quote,
    { tick, settings, logger: console }
  );

  // Build a simple benchmark grid from direct prices only (no maths module)
  const B = settings.matrices.bases.map(s => s.toUpperCase());
  const Q = settings.matrices.quote.toUpperCase();
  const direct = snapshot.priceBook.direct as Record<string, number>;
  const grid: (number|null)[][] = Array.from({ length: B.length }, () => Array(B.length).fill(null));
  for (let i = 0; i < B.length; i++) {
    for (let j = 0; j < B.length; j++) {
      if (i === j) continue;
      const pi = direct[`${B[i]}/${Q}`];
      const pj = direct[`${B[j]}/${Q}`];
      grid[i][j] = (Number.isFinite(pi) && Number.isFinite(pj)) ? (pi / pj) : null;
    }
  }

  const wrote = await upsertMatrixGrid("benchmark", B, Q, grid, tick.cycleTs);
  console.log(`PASS: wrote benchmark rows = ${wrote}`);
  if (wrote <= 0) throw new Error("No rows written (check DB constraints or symbol coverage).");

  await appendAppLedger({
    topic: "smoke",
    event: "pipeline_db",
    payload: { matrix_type: "benchmark", bases: B, quote: Q, rows: wrote },
    ts_epoch_ms: Date.now(),
  }).catch((err) => {
    console.warn("ledger append skipped:", (err as any)?.message ?? err);
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
