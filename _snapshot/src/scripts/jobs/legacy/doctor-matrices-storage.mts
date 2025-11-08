// src/scripts/smokes/doctor-matrices-storage.mts
import "tsx/register";
import { getPool } from "legacy/pool";
import { getAll as getAppSettings } from "@/lib/settings/server";

const splitCoins = (v: string | null) => !v ? [] : v.split(/[,\s]+|,+/).map(s => s.trim().toUpperCase()).filter(Boolean);
const arg = (k: string) => {
  const i = process.argv.findIndex(s => s === `--${k}` || s.startsWith(`--${k}=`));
  if (i === -1) return null;
  const s = process.argv[i];
  const eq = s.indexOf("=");
  return eq === -1 ? "" : s.slice(eq + 1);
};

async function latestTs(matrixType: string): Promise<number | null> {
  const c = await getPool().connect();
  try {
    const { rows } = await c.query<{ ts_ms: string }>(
      `SELECT MAX(ts_ms) AS ts_ms
         FROM public.dyn_matrix_values
        WHERE matrix_type=$1`, [matrixType]);
    return rows?.[0]?.ts_ms ? Number(rows[0].ts_ms) : null;
  } finally { c.release(); }
}

async function countCells(matrixType: string, ts: number): Promise<number> {
  const c = await getPool().connect();
  try {
    const { rows } = await c.query<{ n: string }>(
      `SELECT COUNT(*) AS n
         FROM public.dyn_matrix_values
        WHERE matrix_type=$1 AND ts_ms=$2`, [matrixType, ts]);
    return Number(rows[0].n);
  } finally { c.release(); }
}

async function main() {
  const settings = await getAppSettings();
  const cliCoins = splitCoins(arg("coins"));
  const coins = (cliCoins.length ? cliCoins : (settings.coinUniverse ?? []).map((s:any)=>String(s).toUpperCase()));
  const N = coins.length;
  const expected = N * Math.max(N - 1, 0);

  console.log(`[doctor] coins=${coins.join(",")} expected_off_diag=${expected}`);

  for (const type of ["benchmark","pct24h","id_pct"]) {
    const ts = await latestTs(type);
    if (ts == null) { console.log(`[doctor] ${type}: no rows`); continue; }
    const n = await countCells(type, ts);
    const ok = n === expected;
    console.log(`[doctor] ${type} ts=${ts} cells=${n}/${expected} ${ok ? "OK" : "MISSING"}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
