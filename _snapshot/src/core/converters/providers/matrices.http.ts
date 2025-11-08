/* ----------------------------------------------------------------------------------
 * File: src/core/converters/providers/matrices.http.ts
 * Purpose: Fetch matrices from /api/matrices/latest keyed by coins (no-store).
 * ---------------------------------------------------------------------------------- */

import type { MatricesProvider, MatrixKey, MatrixSnapshot } from "@/core/converters/provider.types";

type MatValues = Record<string, Record<string, number | null>>;

type MatricesLatestSuccess = {
  ok: true;
  coins: string[];
  quote: string;
  ts: number;
  matrices: {
    benchmark: { values: MatValues };
    pct24h?: { values: MatValues };
    id_pct: { values: MatValues };
    pct_drv: { values: MatValues };
    pct_ref?: { values: MatValues };
    ref?: { values: MatValues };
    delta?: { values: MatValues };
  };
  meta?: { universe?: string[] };
};

type MatricesLatestPayload = MatricesLatestSuccess | { ok: false; error: string };

const ensureUpper = (s: string | undefined) => String(s ?? "").trim().toUpperCase();

function valuesToGrid(coins: string[], values?: MatValues): number[][] | undefined {
  if (!values) return undefined;
  const n = coins.length;
  const out: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i++) {
    const base = coins[i]!;
    const row = values[base] ?? {};
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const quote = coins[j]!;
      const v = row[quote];
      const num = Number(v);
      out[i][j] = Number.isFinite(num) ? num : 0;
    }
  }
  return out;
}

export function makeMatricesHttpProvider(base = ""): MatricesProvider {
  const origin = base.replace(/\/$/, "");

  async function fetchLatest(coins: string[] | undefined): Promise<MatricesLatestSuccess> {
    const qs = new URLSearchParams({ t: String(Date.now()) });
    if (coins && coins.length) qs.set("coins", coins.join(","));

    const res = await fetch(`${origin}/api/matrices/latest?${qs}`, {
      cache: "no-store",
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      throw new Error(`matrices http ${res.status}`);
    }

    const data = (await res.json()) as MatricesLatestPayload;
    if (!data.ok) {
      throw new Error(data.error || "matrices latest error");
    }
    return data;
  }

  async function getSnapshotInternal(coins: string[], keys?: MatrixKey[]): Promise<MatrixSnapshot> {
    const payload = await fetchLatest(coins);
    const universeSrc = payload.meta?.universe ?? payload.coins ?? coins;
    const universe = universeSrc.map(ensureUpper);

    const selected = keys ? new Set(keys) : null;
    const add = (key: MatrixKey, values?: MatValues) => {
      if (!values) return undefined;
      if (selected && !selected.has(key)) return undefined;
      return valuesToGrid(universe, values);
    };

    const grids: Partial<Record<MatrixKey, number[][]>> = {};
    const maybeBenchmark = add("benchmark", payload.matrices.benchmark.values);
    if (maybeBenchmark) grids.benchmark = maybeBenchmark;

    const maybeIdPct = add("id_pct", payload.matrices.id_pct.values);
    if (maybeIdPct) grids.id_pct = maybeIdPct;

    const maybePctDrv = add("pct_drv", payload.matrices.pct_drv.values);
    if (maybePctDrv) grids.pct_drv = maybePctDrv;

    const maybePct24h = add("pct24h", payload.matrices.pct24h?.values);
    if (maybePct24h) grids.pct24h = maybePct24h;

    const maybePctRef = add("pct_ref", payload.matrices.pct_ref?.values);
    if (maybePctRef) grids.pct_ref = maybePctRef;

    const maybeRef = add("ref", payload.matrices.ref?.values);
    if (maybeRef) grids.ref = maybeRef;

    const maybeDelta = add("delta", payload.matrices.delta?.values);
    if (maybeDelta) grids.delta = maybeDelta;

    return {
      coins: universe,
      quote: payload.quote,
      ts: payload.ts,
      grids,
    };
  }

  return {
    async getSnapshot({ coins, keys }: { coins: string[]; keys?: MatrixKey[] }) {
      return getSnapshotInternal(coins, keys);
    },
    async getBenchmarkGrid(coins) {
      const snap = await getSnapshotInternal(coins, ["benchmark"]);
      return snap.grids.benchmark;
    },
    async getIdPctGrid(coins) {
      const snap = await getSnapshotInternal(coins, ["id_pct"]);
      return snap.grids.id_pct;
    },
    async getPctDrvGrid(coins) {
      const snap = await getSnapshotInternal(coins, ["pct_drv"]);
      return snap.grids.pct_drv;
    },
  };
}
