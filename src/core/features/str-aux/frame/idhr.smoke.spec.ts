import "dotenv/config";
import { describe, it, expect } from "vitest";
import { query } from "@/core/db/pool_server";
import { computeIdhrBins } from "./idhr";

const hasDb = Boolean(process.env.DATABASE_URL);
const SYMBOL = (process.env.TEST_IDHR_SYMBOL || process.env.SYMBOL || "BTCUSDT")
  .toUpperCase()
  .trim();
const SAMPLE_LIMIT = Math.max(64, Math.min(2048, Number(process.env.TEST_IDHR_LIMIT ?? 512)));

type Row = { ts: string; mid: number | null };

async function loadSamples(): Promise<Row[]> {
  const { rows } = await query<Row>(
    `select ts, (density->>'mid')::numeric as mid
       from str_aux.samples_5s_model
      where symbol = $1
      order by ts desc
      limit $2`,
    [SYMBOL, SAMPLE_LIMIT],
  );
  return rows;
}

describe.skipIf(!hasDb)("str-aux IDHR smoke", () => {
  it("computes 16x16 IDHR bins from recent mids", async () => {
    const rows = await loadSamples();
    if (rows.length <= 32) {
      console.warn(`[idhr smoke] not enough rows for ${SYMBOL}, skipping check.`);
      return;
    }

    const points = rows
      .map((row) => {
        const price = Number(row.mid);
        if (!Number.isFinite(price) || price <= 0) return null;
        return { ts: new Date(row.ts).getTime(), price };
      })
      .filter((p): p is { ts: number; price: number } => Boolean(p))
      .reverse();
    if (points.length <= 32) {
      console.warn(`[idhr smoke] not enough usable mids for ${SYMBOL}, skipping check.`);
      return;
    }

    const opening = { benchmark: points[0]?.price ?? 1 };
    const bins = computeIdhrBins(points as any, opening as any, {
      primaryBins: 16,
      secondaryBins: 16,
      selectedBins: 16,
    });

    expect(bins.primaryBins).toBeGreaterThan(0);
    expect(bins.secondaryBins).toBeGreaterThan(0);
    expect(bins.selectedBins.length).toBeLessThanOrEqual(16);
    expect(bins.selectedPrimaries.length).toBeLessThanOrEqual(16);
    expect(bins.selectedPrimaries.length).toBeGreaterThan(0);
    expect(bins.binWidth).toBeGreaterThan(0);
    expect(bins.range.max).toBeGreaterThanOrEqual(bins.range.min);
  });
});
