// src/core/converters/Converter.server.ts
// Server-side wiring + domain builders used by the Dynamics workspace.

import { buildMeaAux } from "@/core/features/moo-aux/grid";
import type {
  ConverterSources,
  DomainArbRow,
  DomainEdgeMetrics,
  DomainVM,
  DynamicsSnapshot,
  HistogramSnapshot,
  MatrixSnapshot,
  SwapDirection,
  SwapTag,
  TimedPoint,
} from "@/core/converters/provider.types";

let sourcesRef: ConverterSources | null = null;

export function wireConverterSources(sources: ConverterSources) {
  sourcesRef = sources;
}

function getSources(): ConverterSources {
  if (!sourcesRef) {
    throw new Error("Converter sources not wired - call wireConverterSources() on the server.");
  }
  return sourcesRef;
}

const ensureUpper = (s: string | undefined): string => String(s ?? "").trim().toUpperCase();
const numberOr = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

async function tryCall<T>(fn: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

async function tryCallOr<T>(fn: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    const v = await Promise.resolve(fn());
    return (v as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeGrid(coins: string[], grid?: number[][] | null): number[][] | undefined {
  if (!grid) return undefined;
  const n = coins.length;
  const out: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = grid?.[i]?.[j];
      out[i][j] = numberOr(v);
    }
  }
  return out;
}

function gridToRecord(coins: string[], grid?: number[][] | null): Record<string, Record<string, number | null>> {
  const out: Record<string, Record<string, number | null>> = {};
  for (let i = 0; i < coins.length; i++) {
    const base = coins[i]!;
    const row: Record<string, number | null> = {};
    for (let j = 0; j < coins.length; j++) {
      const quote = coins[j]!;
      if (i === j) {
        row[quote] = null;
        continue;
      }
      const v = grid?.[i]?.[j];
      row[quote] = Number.isFinite(Number(v)) ? Number(v) : null;
    }
    out[base] = row;
  }
  return out;
}

function recordToGrid(coins: string[], rec: Record<string, Record<string, number | null>>): number[][] {
  const n = coins.length;
  const out: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i++) {
    const base = coins[i]!;
    const row = rec[base] ?? {};
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const quote = coins[j]!;
      const v = row[quote];
      out[i][j] = Number.isFinite(Number(v)) ? Number(v) : 0;
    }
  }
  return out;
}

function swapTagFromDerivatives(series: number[] | undefined): SwapTag {
  if (!series || series.length === 0) return { count: 0, direction: "frozen" };
  let prev = 0;
  let flips = 0;
  for (const value of series) {
    const sign = Math.sign(value);
    if (sign !== 0 && prev !== 0 && sign !== prev) flips++;
    if (sign !== 0) prev = sign;
  }
  const last = series.at(-1) ?? 0;
  const direction: SwapDirection = last > 0 ? "up" : last < 0 ? "down" : "frozen";
  const frozen = series.slice(-5).every((v) => Math.sign(v) === 0);
  return { count: frozen ? 0 : flips, direction: frozen ? "frozen" : direction };
}

async function resolveMatrices(
  sources: ConverterSources,
  coins: string[]
): Promise<{
  coins: string[];
  benchmark?: number[][];
  id_pct?: number[][];
  pct_drv?: number[][];
  ref?: number[][];
  snapshot?: MatrixSnapshot;
}> {
  const snapshot = await tryCall(() =>
    sources.matrices.getSnapshot?.({ coins, keys: ["benchmark", "id_pct", "pct_drv", "ref"] })
  );
  let orderedCoins = snapshot?.coins?.map(ensureUpper) ?? coins.slice();
  if (!orderedCoins.length) orderedCoins = coins.slice();

  let benchmark = normalizeGrid(orderedCoins, snapshot?.grids?.benchmark);
  if (!benchmark) {
    const fallback = await tryCall(() => sources.matrices.getBenchmarkGrid(orderedCoins));
    benchmark = normalizeGrid(orderedCoins, fallback);
  }

  let idPct = normalizeGrid(orderedCoins, snapshot?.grids?.id_pct);
  if (!idPct) {
    const fallback = await tryCall(() => sources.matrices.getIdPctGrid(orderedCoins));
    idPct = normalizeGrid(orderedCoins, fallback);
  }

  let pctDrv = normalizeGrid(orderedCoins, snapshot?.grids?.pct_drv);
  if (!pctDrv && typeof sources.matrices.getPctDrvGrid === "function") {
    const fallback = await tryCall(() => sources.matrices.getPctDrvGrid?.(orderedCoins));
    pctDrv = normalizeGrid(orderedCoins, fallback);
  }

  const ref = normalizeGrid(orderedCoins, snapshot?.grids?.ref);

  return {
    coins: orderedCoins,
    benchmark,
    id_pct: idPct,
    pct_drv: pctDrv,
    ref,
    snapshot: snapshot ?? undefined,
  };
}

function buildHistogram(series: number[], bins: number): HistogramSnapshot | undefined {
  const values = series.filter((v) => Number.isFinite(v));
  if (!values.length) return undefined;

  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (min === max) {
    return { buckets: [min], counts: [values.length], min, max };
  }

  const safeBins = Math.max(4, Math.min(512, Math.floor(bins)));
  const step = (max - min) / safeBins || 1;
  const buckets = Array.from({ length: safeBins }, (_, i) => min + step * i);
  const counts = Array.from({ length: safeBins }, () => 0);

  for (const v of values) {
    const idx = Math.min(safeBins - 1, Math.floor((v - min) / step));
    counts[idx] += 1;
  }

  return { buckets, counts, min, max };
}

export type BuildVMOpts = {
  Ca?: string;
  Cb?: string;
  base?: string;
  quote?: string;
  candidates: string[];
  coinsUniverse: string[];
  histLen?: number;
  k?: number;
};

export type BuildDynamicsSnapshotOpts = BuildVMOpts & {
  histogramBins?: number;
};

export async function buildDomainVM(rawOpts: BuildVMOpts): Promise<DomainVM> {
  const sources = getSources();

  const Ca = ensureUpper(rawOpts.Ca ?? rawOpts.base);
  const Cb = ensureUpper(rawOpts.Cb ?? rawOpts.quote);
  if (!Ca || !Cb) {
    throw new Error("buildDomainVM requires both Ca/base and Cb/quote symbols.");
  }

  const histLen = Math.max(16, Number(rawOpts.histLen ?? 64));

  const baseCoins = Array.isArray(rawOpts.coinsUniverse) ? rawOpts.coinsUniverse.map(ensureUpper) : [];
  const coinsSet = new Set<string>();
  for (const c of baseCoins) coinsSet.add(c);
  coinsSet.add(Ca);
  coinsSet.add(Cb);
  for (const cand of rawOpts.candidates ?? []) coinsSet.add(ensureUpper(cand));
  const coinsUniverse = Array.from(coinsSet);

  const matrices = await resolveMatrices(sources, coinsUniverse);
  const coins = matrices.coins;
  if (!coins.includes(Ca)) coins.push(Ca);
  if (!coins.includes(Cb)) coins.push(Cb);

  const benchmark = matrices.benchmark ?? normalizeGrid(coins, undefined);
  const idPct = matrices.id_pct ?? normalizeGrid(coins, undefined);
  const pctDrvMatrix = matrices.pct_drv;
  const refMatrix = matrices.ref;

  const balancesAll: Record<string, number> = {};
  for (const sym of coins) {
    const cinWallet = await tryCall(() => sources.cin.getWallet(sym));
    const httpWallet = cinWallet ?? (await tryCall(() => sources.wallet?.getWallet(sym)));
    balancesAll[sym] = numberOr(httpWallet);
  }

  const cinStats =
    (await tryCall(() => sources.cin.getCinForCoins(coins))) ??
    ({} as DomainVM["metricsPanel"]["cin"]);

  const meaPair = await tryCallOr(
    () => sources.mea.getMea({ base: Ca, quote: Cb }),
    { value: 0, tier: "?-tier" }
  );

  const pairStats =
    (await tryCall(() => sources.str.getStats?.({ base: Ca, quote: Cb }))) ?? undefined;
  const gfm = numberOr(pairStats?.gfm, await tryCallOr(() => sources.str.getGfm(), 0));
  const shift = numberOr(pairStats?.shift, await tryCallOr(() => sources.str.getShift(), 0));
  const vTendencyPair = numberOr(
    pairStats?.vOuter,
    await tryCallOr(() => sources.str.getVTendency({ base: Ca, quote: Cb }), 0)
  );

  const idHistPair =
    (await tryCall(() => sources.str.getIdPctHistory?.(Ca, Cb, histLen))) ?? [];
  const pctDrvPair =
    (await tryCall(() => sources.str.getPctDrvHistory?.(Ca, Cb, histLen))) ??
    idHistPair.map((v, idx) => (idx === 0 ? 0 : numberOr(v) - numberOr(idHistPair[idx - 1])));

  const idHistPairTs =
    (await tryCall(() => sources.str.getIdPctHistoryTs?.(Ca, Cb, histLen))) ?? undefined;
  const pctDrvPairTs =
    (await tryCall(() => sources.str.getPctDrvHistoryTs?.(Ca, Cb, histLen))) ?? undefined;

  const cell = (grid: number[][] | undefined, from: string, to: string) => {
    if (!grid) return undefined;
    const i = coins.indexOf(from);
    const j = coins.indexOf(to);
    if (i < 0 || j < 0) return undefined;
    return grid[i]?.[j];
  };

  async function edgeMetrics(from: string, to: string): Promise<DomainEdgeMetrics> {
    const bm = cell(benchmark, from, to);
    const idp = cell(idPct, from, to);
    const vt = await tryCallOr(() => sources.str.getVTendency({ base: from, quote: to }), 0);

    const drvTs =
      (await tryCall(() => sources.str.getPctDrvHistoryTs?.(from, to, 16))) ??
      (await tryCall(() => sources.str.getIdPctHistoryTs?.(from, to, 17)))?.map((pt, idx, arr) => {
        if (idx === 0) return { ts_ms: pt.ts_ms, value: 0 };
        const prev = arr[idx - 1]!;
        return {
          ts_ms: pt.ts_ms,
          value: Number(pt.value ?? 0) - Number(prev.value ?? 0),
        };
      });

    const derivs = Array.isArray(drvTs) ? drvTs.map((pt) => numberOr(pt.value)) : [];
    const swapTag = swapTagFromDerivatives(derivs);

    return {
      benchmark: numberOr(bm),
      id_pct: numberOr(idp),
      vTendency: vt,
      swapTag,
    };
  }

  const candidates = Array.from(
    new Set(
      (rawOpts.candidates ?? [])
        .map(ensureUpper)
        .filter((c) => c && c !== Ca && c !== Cb && coins.includes(c))
    )
  );

  const rows: DomainArbRow[] = [];
  for (const Ci of candidates) {
    const [cb_ci, ci_ca, ca_ci] = await Promise.all([
      edgeMetrics(Cb, Ci),
      edgeMetrics(Ci, Ca),
      edgeMetrics(Ca, Ci),
    ]);
    rows.push({ ci: Ci, cols: { cb_ci, ci_ca, ca_ci } });
  }

  const subsetWallets: Record<string, number> = {};
  for (const sym of new Set([Ca, Cb, ...candidates])) {
    subsetWallets[sym] = balancesAll[sym] ?? 0;
  }

  let meaMatrix: number[][] | undefined;
  if (typeof sources.mea.getMeaGrid === "function" && idPct) {
    const grid = await tryCall(() =>
      sources.mea.getMeaGrid?.({ coins, idPct, balances: balancesAll, k: rawOpts.k })
    );
    meaMatrix = grid ? normalizeGrid(coins, grid) : undefined;
  }
  if (!meaMatrix && idPct) {
    try {
      const rec = buildMeaAux({
        coins,
        idPct: gridToRecord(coins, idPct),
        balances: balancesAll,
        k: rawOpts.k,
      });
      meaMatrix = recordToGrid(coins, rec);
    } catch {
      meaMatrix = undefined;
    }
  }

  const vm: DomainVM = {
    coins,
    matrix: {
      benchmark: benchmark,
      id_pct: idPct,
      pct_drv: pctDrvMatrix,
      mea: meaMatrix,
      ref: refMatrix,
    },
    arb: {
      rows,
      wallets: subsetWallets,
    },
    metricsPanel: {
      mea: meaPair,
      str: { gfm, shift, vTendency: vTendencyPair },
      cin: cinStats,
    },
    series: {
      id_pct: idHistPair.map(numberOr),
      pct_drv: pctDrvPair.map(numberOr),
      id_pct_ts: idHistPairTs?.map((pt) => ({ ts_ms: Number(pt.ts_ms), value: numberOr(pt.value) })),
      pct_drv_ts: pctDrvPairTs?.map((pt) => ({ ts_ms: Number(pt.ts_ms), value: numberOr(pt.value) })),
    },
    context: {
      base: Ca,
      quote: Cb,
      candidates,
      balances: balancesAll,
      histLen,
    },
  };

  return vm;
}

export async function buildDynamicsSnapshot(opts: BuildDynamicsSnapshotOpts): Promise<DynamicsSnapshot> {
  const vm = await buildDomainVM(opts);
  const { context, matrix, arb, metricsPanel, series } = vm;
  const bins = opts.histogramBins ?? context.histLen;
  const histogram = buildHistogram(series.pct_drv, bins);

  const focusWallets: Record<string, number> = {};
  const focusSet = new Set<string>([
    context.base,
    context.quote,
    "USDT",
    ...context.candidates,
  ]);
  for (const sym of focusSet) focusWallets[sym] = context.balances[sym] ?? 0;

  return {
    builtAt: Date.now(),
    coins: vm.coins,
    base: context.base,
    quote: context.quote,
    candidates: context.candidates,
    matrix,
    arb,
    metrics: metricsPanel,
    series,
    histogram,
    wallets: focusWallets,
    walletsAll: context.balances,
    cin: metricsPanel.cin,
  };
}
