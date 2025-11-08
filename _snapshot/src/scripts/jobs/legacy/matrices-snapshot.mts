// src/scripts/jobs/matrices-snapshot.mts
// pnpm run job:mat:snapshot -- --coins=BTC,ETH,SOL,USDT
import "tsx/register";
import { liveFromSources } from "@/core/features/matrices/liveFromSources";
import { getAll as getAppSettings } from "@/lib/settings/server";
import { getPool } from "legacy/pool";
import { stageMatrixGrid, commitMatrixGrid } from "@/core/features/matrices/writer";

const arg = (k: string) => {
  const i = process.argv.findIndex(s => s === `--${k}` || s.startsWith(`--${k}=`));
  if (i === -1) return null;
  const s = process.argv[i];
  const eq = s.indexOf("=");
  return eq === -1 ? "" : s.slice(eq + 1);
};
const splitCoins = (v: string | null) => !v ? [] : v.split(/[,\s]+|,+/).map(s => s.trim().toUpperCase()).filter(Boolean);
const uniq = (a: string[]) => Array.from(new Set(a));

async function getPrevBenchmark(base: string, quote: string, beforeTs: number): Promise<number | null> {
  const c = await getPool().connect();
  try {
    const { rows } = await c.query<{ value: number }>(
      `SELECT value
         FROM public.dyn_matrix_values
        WHERE matrix_type='benchmark' AND base=$1 AND quote=$2 AND ts_ms < $3
     ORDER BY ts_ms DESC LIMIT 1`,
      [base, quote, beforeTs]
    );
    return rows.length ? Number(rows[0].value) : null;
  } finally { c.release(); }
}

function gridToObj(coins: string[], grid: (number|null)[][]) {
  const out: any = {};
  const n = coins.length;
  for (let i=0;i<n;i++){
    const bi = coins[i]; out[bi] = {};
    for (let j=0;j<n;j++){
      if (i===j) continue;
      const qj = coins[j];
      const v = grid[i][j];
      if (v != null && Number.isFinite(v)) out[bi][qj] = Number(v);
      else out[bi][qj] = null;
    }
  }
  return out;
}

async function main() {
  const settings = await getAppSettings();
  const cliCoins = splitCoins(arg("coins"));
  const coins = uniq(cliCoins.length ? cliCoins : (settings.coinUniverse ?? []).map((s: any) => String(s).toUpperCase()));
  if (coins.length < 2) throw new Error("coin universe too small");

  const sessionId =
    (settings as any)?.appSessionId ??
    (settings as any)?.app_session_id ??
    (settings as any)?.params?.values?.appSessionId ??
    null;

  const live = await liveFromSources(coins);
  const nowTs = live.matrices.benchmark.ts;
  const bmObj = live.matrices.benchmark.values;
  const p24Obj = live.matrices.pct24h.values;

  // 1) Stash benchmark
  console.log("[mat-snapshot] staging benchmark slice ts=", nowTs, "cells=", coins.length*(coins.length-1));
  await stageMatrixGrid({
    appSessionId: sessionId ?? "dev-01",
    matrixType: "benchmark",
    tsMs: nowTs,
    coins,
    values: bmObj,
    meta: { source: "liveFromSources" },
  });
  const commit1 = await commitMatrixGrid({
    appSessionId: sessionId ?? "dev-01",
    matrixType: "benchmark",
    tsMs: nowTs,
    coins,
    idem: `benchmark:${nowTs}`,
  });
  console.log("[mat-snapshot] commit benchmark:", commit1);

  // 2) Stash pct24h (optional but useful for UI parity)
  console.log("[mat-snapshot] staging pct24h slice ts=", nowTs);
  await stageMatrixGrid({
    appSessionId: sessionId ?? "dev-01",
    matrixType: "pct24h",
    tsMs: nowTs,
    coins,
    values: p24Obj,
    meta: { source: "liveFromSources" },
  });
  const commit2 = await commitMatrixGrid({
    appSessionId: sessionId ?? "dev-01",
    matrixType: "pct24h",
    tsMs: nowTs,
    coins,
    idem: `pct24h:${nowTs}`,
  });
  console.log("[mat-snapshot] commit pct24h:", commit2);

  // 3) Compute id_pct on the fly vs prev(benchmark) and stash it
  console.log("[mat-snapshot] computing id_pct vs prev(benchmark)");
  const idObj: any = {};
  for (const b of coins) { idObj[b] = {}; for (const q of coins) if (b!==q) idObj[b][q] = null; }
  for (const b of coins) {
    for (const q of coins) {
      if (b === q) continue;
      const bmNow = bmObj?.[b]?.[q];
      if (bmNow == null) { idObj[b][q] = null; continue; }
      const bmPrev = await getPrevBenchmark(b, q, nowTs);
      if (bmPrev == null || Math.abs(bmPrev) < 1e-300) { idObj[b][q] = null; continue; }
      idObj[b][q] = (Number(bmNow) - bmPrev) / bmPrev;
    }
  }
  await stageMatrixGrid({
    appSessionId: sessionId ?? "dev-01",
    matrixType: "id_pct",
    tsMs: nowTs,
    coins,
    values: idObj,
    meta: { source: "derived@writer", base: "prev(benchmark)" },
  });
  const commit3 = await commitMatrixGrid({
    appSessionId: sessionId ?? "dev-01",
    matrixType: "id_pct",
    tsMs: nowTs,
    coins,
    idem: `id_pct:${nowTs}`,
  });
  console.log("[mat-snapshot] commit id_pct:", commit3);

  console.log("[mat-snapshot] done.");
}

main().catch(e => { console.error(e); process.exit(1); });
