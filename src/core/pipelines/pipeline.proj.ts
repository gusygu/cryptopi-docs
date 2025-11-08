// src/core/pipelines/proj_pipeline.ts
// Projection pipeline: single-cycle plumbing (API -> DB)

import type { PipelineContext } from "./types.ts";
import { fetchLiveSnapshotBasic } from "./pipeline.api";
import { upsertMatrixGrid } from "./pipeline.db";

export async function runProjPipeline(ctx: PipelineContext) {
  const { settings, tick, logger } = ctx;
  logger?.info("> proj-pipeline start");

  const snapshot = await fetchLiveSnapshotBasic(
    settings.matrices.bases,
    settings.matrices.quote,
    { tick, settings, logger }
  );

  const bases = settings.matrices.bases.map((b) => b.toUpperCase());
  const quote = settings.matrices.quote.toUpperCase();
  const direct = snapshot.priceBook.direct as Record<string, number>;
  const grid: (number | null)[][] = Array.from(
    { length: bases.length },
    () => Array(bases.length).fill(null)
  );

  for (let i = 0; i < bases.length; i++) {
    for (let j = 0; j < bases.length; j++) {
      if (i === j) continue;
      const pi = direct[`${bases[i]}/${quote}`];
      const pj = direct[`${bases[j]}/${quote}`];
      grid[i][j] =
        Number.isFinite(pi) && Number.isFinite(pj) ? pi / pj : null;
    }
  }

  const rows = await upsertMatrixGrid("benchmark", bases, quote, grid, tick.cycleTs);
  logger?.info(`* proj-pipeline wrote ${rows} rows`);
  logger?.info("[stop] proj-pipeline end");
}


