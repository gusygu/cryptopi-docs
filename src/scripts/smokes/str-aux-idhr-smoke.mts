// pnpm tsx src/scripts/smokes/str-aux-idhr-smoke.mts
// Reads the latest sampling mids from DB and runs computeIdhrBins to verify 16x16 binning.

import "dotenv/config";
import { Pool } from "pg";
import { computeIdhrBins, serializeIdhr } from "@/core/features/str-aux/frame/idhr";

const SYMBOL = (process.env.SYMBOL || "BTCUSDT").toUpperCase();
const LIMIT = Math.max(64, Math.min(1024, Number(process.env.LIMIT ?? "512")));
const CONN =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_CONNECTION_STRING;

if (!CONN) {
  console.error("Set DATABASE_URL (or POSTGRES_URL / POSTGRES_CONNECTION_STRING) to run this smoke.");
  process.exit(1);
}

const pool = new Pool({ connectionString: CONN });

type SampleRow = { ts: string; mid: number | null };

async function fetchMids(symbol: string): Promise<SampleRow[]> {
  const { rows } = await pool.query<SampleRow>(
    `
    select ts, mid
      from str_aux.samples_5s
     where symbol = $1
     order by ts desc
     limit $2
  `,
    [symbol, LIMIT],
  );
  return rows;
}

function buildPoints(rows: SampleRow[]) {
  return rows
    .map((row) => {
      const price = Number(row.mid);
      if (!Number.isFinite(price) || price <= 0) return null;
      return { ts: new Date(row.ts).getTime(), price };
    })
    .filter((p): p is { ts: number; price: number } => Boolean(p))
    .reverse(); // earliest first
}

async function main() {
  console.log(`[smoke:idhr] symbol=${SYMBOL} limit=${LIMIT}`);
  const rows = await fetchMids(SYMBOL);
  if (!rows.length) {
    console.error(`[smoke:idhr] no samples in str_aux.samples_5s for ${SYMBOL}`);
    process.exit(1);
  }
  const points = buildPoints(rows);
  if (points.length < 32) {
    console.error(`[smoke:idhr] not enough usable mids (${points.length}) for ${SYMBOL}`);
    process.exit(1);
  }

  const opening = { benchmark: points[0]?.price ?? 1 };
  const bins = computeIdhrBins(points as any, opening as any, {
    primaryBins: 16,
    secondaryBins: 16,
    selectedBins: 16,
  });
  const serialized = serializeIdhr(bins);

  console.log(
    `[smoke:idhr] selectedPrimaries=${serialized.selectedPrimaries?.length ?? 0} selectedBins=${serialized.selectedBins?.length ?? 0}`,
  );
  if (!serialized.selectedPrimaries?.length) {
    console.error("[smoke:idhr] no primaries selected.");
    process.exit(1);
  }
  if (serialized.selectedPrimaries.length > 16) {
    console.error("[smoke:idhr] selected more than 16 primaries.");
    process.exit(1);
  }
  if ((serialized.selectedBins?.length ?? 0) > 16) {
    console.error("[smoke:idhr] selected more than 16 fine bins (expected densest set).");
    process.exit(1);
  }

  console.log(
    `[smoke:idhr] binWidth=${serialized.binWidth?.toExponential?.(6) ?? serialized.binWidth} range=[${serialized.range?.min}, ${serialized.range?.max}]`,
  );
  console.log("[smoke:idhr] smoke passed.");
  await pool.end();
}

if ((import.meta as any).main) {
  main().catch(async (err) => {
    console.error("[smoke:idhr] fatal error", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
}
