"use client";

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import AssetIdentity from "@/components/features/dynamics/v2/AssetIdentity";
import ArbTable, { type ArbTableRow } from "@/components/features/dynamics/v2/ArbTable";
import AuxiliaryCard from "@/components/features/dynamics/v2/AuxiliaryCard";
import DynamicsMatrix from "@/components/features/dynamics/v2/DynamicsMatrix";
import { formatNumber } from "@/components/features/dynamics/utils";
import { loadPreviewSymbolSet } from "@/app/matrices/colouring";
import { useCoinsUniverse } from "@/lib/dynamicsClient";
import { fromDynamicsSnapshot, useDynamicsSnapshot } from "@/core/converters/Converter.client";
import type { DynamicsSnapshot } from "@/core/converters/provider.types";
import type { MatricesLatestPayload } from "@/app/api/matrices/latest/route";

// 👇 copia daqui pra baixo praticamente igual ao teu page.tsx,
// só mudando o nome do componente pra DynamicsClient.

const STORAGE_KEY = "dynamics:selectedPair";

// ... (todas as helpers: Pair, Grid, readMatrixValue, deriveDefaultPair, etc.)

// no final, em vez de `export default function DynamicsPage() { ... }`
export default function DynamicsClient() {



type Pair = { base: string; quote: string };
type Grid = Array<Array<number | null>>;
const ARB_EDGE_KEYS = ["cb_ci", "ci_ca", "ca_ci"] as const;
const ARB_EDGE_ALIASES: Record<(typeof ARB_EDGE_KEYS)[number], string[]> = {
  cb_ci: ["cbCi", "CB_CI", "cb-ci"],
  ci_ca: ["ciCa", "CI_CA", "ci-ca"],
  ca_ci: ["caCi", "CA_CI", "ca-ci"],
};

function readMatrixValue(grid: Grid | undefined, coins: string[], from: string, to: string): number | null {
  if (!grid?.length || !coins.length) return null;
  const baseIdx = coins.indexOf(ensureUpper(from));
  const quoteIdx = coins.indexOf(ensureUpper(to));
  if (baseIdx < 0 || quoteIdx < 0) return null;
  const value = grid?.[baseIdx]?.[quoteIdx];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deriveDefaultPair(coins: string[]): Pair {
  if (!coins.length) return { base: "BTC", quote: "USDT" };
  const upper = coins.map((coin) => String(coin ?? "").toUpperCase()).filter(Boolean);
  const base = upper[0] ?? "BTC";
  const quote = upper.find((coin) => coin !== base) ?? (base === "USDT" ? "BTC" : "USDT");
  return { base, quote };
}

function ensureUpper(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function dedupeUpper(tokens: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const upper = ensureUpper(token);
    if (!upper || seen.has(upper)) continue;
    seen.add(upper);
    out.push(upper);
  }
  return out;
}

function valuesToGrid(
  coins: string[],
  values: Record<string, Record<string, number | string | null | undefined>> | undefined
): Grid | undefined {
  if (!values || !coins.length) return undefined;
  const grid: Grid = coins.map(() => coins.map(() => null));
  for (let i = 0; i < coins.length; i++) {
    const base = coins[i]!;
    const row = values[base] ?? {};
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      const quote = coins[j]!;
      const raw = row[quote];
      if (raw == null) {
        grid[i][j] = null;
        continue;
      }
      const num = typeof raw === "number" ? raw : Number(raw);
      grid[i][j] = Number.isFinite(num) ? num : null;
    }
  }
  return grid;
}

function projectMatrixGrid(
  targetCoins: string[],
  sourceCoins: string[] | undefined,
  grid: Array<Array<number | null>> | number[][] | undefined
): Grid | undefined {
  if (!targetCoins.length || !sourceCoins?.length || !grid?.length) return undefined;
  const index = new Map<string, number>();
  sourceCoins.forEach((coin, idx) => {
    const upper = ensureUpper(coin);
    if (upper && !index.has(upper)) index.set(upper, idx);
  });
  const out: Grid = targetCoins.map(() => targetCoins.map(() => null));
  for (let i = 0; i < targetCoins.length; i++) {
    const baseIdx = index.get(ensureUpper(targetCoins[i]));
    if (baseIdx == null) continue;
    for (let j = 0; j < targetCoins.length; j++) {
      if (i === j) continue;
      const quoteIdx = index.get(ensureUpper(targetCoins[j]));
      if (quoteIdx == null) continue;
      const raw = grid?.[baseIdx]?.[quoteIdx];
      const num = typeof raw === "number" ? raw : Number(raw);
      out[i][j] = Number.isFinite(num) ? num : null;
    }
  }
  return out;
}

function mergeGrids(coins: string[], primary?: Grid, fallback?: Grid): Grid | undefined {
  const hasPrimary = Boolean(primary && primary.length === coins.length);
  const hasFallback = Boolean(fallback && fallback.length === coins.length);
  if (!hasPrimary && !hasFallback) return undefined;
  const out: Grid = coins.map(() => coins.map(() => null));
  for (let i = 0; i < coins.length; i++) {
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      const primaryVal = hasPrimary ? primary![i]?.[j] : null;
      if (primaryVal != null) {
        out[i][j] = primaryVal;
        continue;
      }
      const fallbackVal = hasFallback ? fallback![i]?.[j] : null;
      out[i][j] = fallbackVal ?? null;
    }
  }
  return out;
}

function normalizePair(target: Partial<Pair>, coins: string[], fallback: Pair): Pair {
  if (!coins.length) return fallback;
  const universe = coins.map((coin) => String(coin ?? "").toUpperCase()).filter(Boolean);
  const safeFallback = {
    base: String(fallback.base ?? "").toUpperCase() || "BTC",
    quote: String(fallback.quote ?? "").toUpperCase() || "USDT",
  };

  let base = String(target.base ?? safeFallback.base).toUpperCase();
  if (!universe.includes(base)) {
    base = safeFallback.base;
  }

  let quote = String(target.quote ?? safeFallback.quote).toUpperCase();
  if (!universe.includes(quote) || quote === base) {
    const alternative = universe.find((coin) => coin !== base);
    quote = alternative ?? safeFallback.quote;
  }

  if (quote === base) {
    const alternative = universe.find((coin) => coin !== base);
    if (alternative) {
      quote = alternative;
    } else if (base !== safeFallback.quote) {
      quote = safeFallback.quote;
    }
  }

  return { base, quote };
}

function pickArbEdge(row: any, key: (typeof ARB_EDGE_KEYS)[number]) {
  const cols = (row?.cols ?? {}) as Record<string, any>;
  if (cols[key]) return cols[key];
  for (const alias of ARB_EDGE_ALIASES[key]) {
    if (cols[alias]) return cols[alias];
  }
  return undefined;
}

function mapArbRows(snapshot: DynamicsSnapshot | null, allowedCoins?: Set<string>): ArbTableRow[] {
  if (!snapshot) return [];
  const walletMap = snapshot.arb?.wallets ?? snapshot.wallets ?? {};
  const rows = snapshot.arb?.rows ?? [];
  const matrixCoins = (snapshot.coins ?? []).map(ensureUpper);
  const benchmarkGrid = snapshot.matrix?.benchmark;
  const idPctGrid = snapshot.matrix?.id_pct;
  const mooGrid = snapshot.matrix?.mea as Grid | undefined;
  const refGrid = snapshot.matrix?.ref as Grid | undefined;
  const baseSymbol = ensureUpper(snapshot.base);
  const quoteSymbol = ensureUpper(snapshot.quote);

  return rows
    .map<ArbTableRow | null>((row) => {
      const candidate = ensureUpper((row as any)?.ci ?? (row as any)?.symbol ?? "");
      if (!candidate) return null;
      if (allowedCoins?.size && !allowedCoins.has(candidate)) return null;
      const fallbackByKey: Record<
        (typeof ARB_EDGE_KEYS)[number],
        { benchmark: number | null; idPct: number | null; moo: number | null; ref: number | null }
      > = {
        cb_ci: {
          benchmark: readMatrixValue(benchmarkGrid as Grid | undefined, matrixCoins, quoteSymbol, candidate),
          idPct: readMatrixValue(idPctGrid as Grid | undefined, matrixCoins, quoteSymbol, candidate),
          moo: readMatrixValue(mooGrid, matrixCoins, quoteSymbol, candidate),
          ref: readMatrixValue(refGrid, matrixCoins, quoteSymbol, candidate),
        },
        ci_ca: {
          benchmark: readMatrixValue(benchmarkGrid as Grid | undefined, matrixCoins, candidate, baseSymbol),
          idPct: readMatrixValue(idPctGrid as Grid | undefined, matrixCoins, candidate, baseSymbol),
          moo: readMatrixValue(mooGrid, matrixCoins, candidate, baseSymbol),
          ref: readMatrixValue(refGrid, matrixCoins, candidate, baseSymbol),
        },
        ca_ci: {
          benchmark: readMatrixValue(benchmarkGrid as Grid | undefined, matrixCoins, baseSymbol, candidate),
          idPct: readMatrixValue(idPctGrid as Grid | undefined, matrixCoins, baseSymbol, candidate),
          moo: readMatrixValue(mooGrid, matrixCoins, baseSymbol, candidate),
          ref: readMatrixValue(refGrid, matrixCoins, baseSymbol, candidate),
        },
      };
      const edges = ARB_EDGE_KEYS.reduce((acc, key) => {
        const metrics = pickArbEdge(row, key) as any;
        acc[key] = {
          idPct: metrics?.id_pct ?? fallbackByKey[key].idPct ?? null,
          benchmark: metrics?.benchmark ?? fallbackByKey[key].benchmark ?? null,
          vTendency: metrics?.vTendency ?? null,
          moo: metrics?.moo ?? fallbackByKey[key].moo ?? null,
          ref: metrics?.ref ?? fallbackByKey[key].ref ?? null,
          swapTag: metrics?.swapTag,
        };
        return acc;
      }, {} as ArbTableRow["edges"]);
      const cbEdge = edges.cb_ci;
      const primaryTag = cbEdge?.swapTag ?? edges.ci_ca?.swapTag ?? edges.ca_ci?.swapTag;
      const inertia = (row as any)?.metrics?.inertia as
        | "low"
        | "neutral"
        | "high"
        | "frozen"
        | undefined;

      return {
        symbol: candidate,
        spread: cbEdge?.idPct ?? fallbackByKey.cb_ci.idPct ?? null,
        benchmark: cbEdge?.benchmark ?? fallbackByKey.cb_ci.benchmark ?? null,
        velocity: cbEdge?.vTendency ?? null,
        direction: primaryTag?.direction,
        inertia,
        wallet: walletMap?.[candidate] ?? walletMap?.[(row as any)?.ci],
        updatedAt: primaryTag?.changedAtIso,
        edges,
        vSwap: (() => {
          const raw = (row as any)?.metrics?.vSwap;
          const num = typeof raw === "number" ? raw : Number(raw);
          return Number.isFinite(num) ? num : null;
        })(),
      };
    })
    .filter((row): row is ArbTableRow => Boolean(row));
}

  const universe = useCoinsUniverse();

  const fallbackCoins = useMemo(
    () => universe.map((coin: string) => ensureUpper(coin)).filter(Boolean),
    [universe.join("|")]
  );

  const fallbackCoinsKey = useMemo(() => fallbackCoins.join("|"), [fallbackCoins]);

  const [availability, setAvailability] = useState<{
    coins: string[];
    symbols: string[];
    pairs: Array<{ symbol: string; base: string; quote: string }>;
    loading: boolean;
    error: string | null;
  }>(() => ({
    coins: fallbackCoins.length ? fallbackCoins : ["BTC", "USDT"],
    symbols: [],
    pairs: [],
    loading: true,
    error: null,
  }));

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    setAvailability((prev) => ({
      ...prev,
      coins: fallbackCoins.length ? fallbackCoins : prev.coins,
      loading: true,
      error: null,
    }));

    (async () => {
      try {
        const res = await fetch(`/api/preview/universe/symbols?t=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`/api/preview/universe/symbols ${res.status}`);
        const payload = await res.json();

        const coinsRaw = Array.isArray(payload?.coins) ? payload.coins : [];
        const symbolsRaw = Array.isArray(payload?.symbols) ? payload.symbols : [];
        const quote = ensureUpper(payload?.quote ?? "USDT");

        const normalizedSymbols = dedupeUpper(symbolsRaw);

        const normalizedPairs = normalizedSymbols
          .map((symbol) => {
            const sym = ensureUpper(symbol);
            if (!sym) return null;
            if (quote && sym.endsWith(quote) && sym.length > quote.length) {
              const base = sym.slice(0, sym.length - quote.length);
              if (!base || base === quote) return null;
              return { symbol: sym, base, quote };
            }
            const match = sym.match(/^(?<base>[A-Z0-9]{2,10})(?<quote>USDT|FDUSD|USDC|TUSD|BUSD|BTC|ETH|BNB)$/);
            const base = match?.groups?.base ? ensureUpper(match.groups.base) : null;
            const q = match?.groups?.quote ? ensureUpper(match.groups.quote) : quote;
            if (!base || !q || base === q) return null;
            return { symbol: sym, base, quote: q };
          })
          .filter((entry): entry is { symbol: string; base: string; quote: string } => Boolean(entry));

        const coinSeeds = coinsRaw.length ? coinsRaw : fallbackCoins;
        const normalizedCoins = dedupeUpper([
          ...coinSeeds,
          quote,
          ...normalizedPairs.flatMap((entry) => [entry.base, entry.quote]),
        ]);

        if (!alive) return;
        setAvailability({
          coins: normalizedCoins.length ? normalizedCoins : (fallbackCoins.length ? fallbackCoins : ["BTC", "USDT"]),
          symbols: normalizedSymbols,
          pairs: normalizedPairs,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        if (!alive) return;
        setAvailability({
          coins: fallbackCoins.length ? fallbackCoins : ["BTC", "USDT"],
          symbols: [],
          pairs: [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [fallbackCoinsKey]);

  const coins = availability.coins.length ? availability.coins : ["BTC", "USDT"];

  const fallbackPair = useMemo(() => deriveDefaultPair(coins), [coins]);

  const allowedSymbolSet = useMemo(() => {
    const src =
      availability.symbols.length > 0
        ? availability.symbols
        : availability.pairs.map((entry) => entry.symbol);
    const set = new Set<string>();
    for (const sym of src) {
      const upper = ensureUpper(sym);
      if (upper) set.add(upper);
    }
    return set;
  }, [availability.symbols, availability.pairs]);

  const allowedCoinSet = useMemo(() => {
    const set = new Set<string>();
    for (const coin of coins) {
      const upper = ensureUpper(coin);
      if (upper) set.add(upper);
    }
    return set;
  }, [coins]);
  const [previewSymbolSet, setPreviewSymbolSet] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Pair>(() => fallbackPair);

  useEffect(() => {
    setSelected((prev) => normalizePair(prev, coins, fallbackPair));
  }, [coins.join("|"), fallbackPair.base, fallbackPair.quote]);

  useEffect(() => {
    let active = true;
    if (!coins.length) {
      setPreviewSymbolSet(new Set());
      return () => {
        active = false;
      };
    }
    (async () => {
      try {
        const { set } = await loadPreviewSymbolSet(coins);
        if (!active) return;
        setPreviewSymbolSet(new Set(set));
      } catch {
        if (!active) return;
        setPreviewSymbolSet(new Set());
      }
    })();
    return () => {
      active = false;
    };
  }, [coins.join("|")]);

  useEffect(() => {
    if (typeof window === "undefined" || !coins.length) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Pair>;
      const normalized = normalizePair(parsed, coins, fallbackPair);
      setSelected(normalized);
    } catch {
      // ignore corrupted storage
    }
  }, [coins.join("|"), fallbackPair.base, fallbackPair.quote]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    } catch {
      // storage disabled
    }
  }, [selected]);

  const { snapshot, loading, error, refresh } = useDynamicsSnapshot({
    base: selected.base,
    quote: selected.quote,
    coins,
    candidates: coins.filter((coin) => coin !== selected.base && coin !== selected.quote),
  });

  const candidateCoins = useMemo(() => {
    const source = snapshot?.candidates?.length ? snapshot.candidates : coins;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of source ?? []) {
      const upper = ensureUpper(token);
      if (!upper || !allowedCoinSet.has(upper) || seen.has(upper)) continue;
      seen.add(upper);
      out.push(upper);
    }
    return out;
  }, [snapshot?.candidates, coins, allowedCoinSet]);

  const vm = useMemo(() => (snapshot ? fromDynamicsSnapshot(snapshot) : null), [snapshot]);

  const arbRows = useMemo<ArbTableRow[]>(() => mapArbRows(snapshot ?? null, allowedCoinSet), [snapshot, allowedCoinSet]);

  const requestCoins = useMemo(
    () => dedupeUpper([...coins, selected.base, selected.quote]),
    [coins, selected.base, selected.quote]
  );

  type MatrixValues = Record<string, Record<string, number | string | null | undefined>>;

  const [marketMatrix, setMarketMatrix] = useState<{
    loading: boolean;
    error: string | null;
    coins: string[];
    benchmark?: Grid;
    pct24h?: Grid;
    mea?: Grid;
    ref?: Grid;
    idPct?: Grid;
    frozen?: boolean[][];
    timestamp?: number | null;
    symbols: string[];
  }>({
    loading: false,
    error: null,
    coins: [],
    symbols: [],
  });

  const marketCoinsKey = useMemo(() => requestCoins.join("|"), [requestCoins]);
  const coinsKey = useMemo(() => coins.join("|"), [coins]);
  const marketQuoteKey = useMemo(() => selected.quote, [selected.quote]);
  const marketTimestampKey = useMemo(() => snapshot?.builtAt ?? 0, [snapshot?.builtAt]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!requestCoins.length) return;

    const controller = new AbortController();
    setMarketMatrix((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const params = requestCoins.join(",");
        const matrixUrl = new URL("/api/matrices/latest", window.location.origin);
        matrixUrl.searchParams.set("quote", selected.quote);
        if (params) matrixUrl.searchParams.set("coins", params);

        const mooUrl = new URL("/api/moo-aux", window.location.origin);
        if (params) mooUrl.searchParams.set("coins", params);

        const [matricesRes, mooRes] = await Promise.all([
          fetch(matrixUrl.toString(), { cache: "no-store", signal: controller.signal }),
          fetch(mooUrl.toString(), { cache: "no-store", signal: controller.signal }),
        ]);

        if (!matricesRes.ok) throw new Error(`/api/matrices/latest ${matricesRes.status}`);
        if (!mooRes.ok) throw new Error(`/api/moo-aux ${mooRes.status}`);

        const matricesJson = (await matricesRes.json()) as MatricesLatestPayload;
        if (!matricesJson.ok) throw new Error(matricesJson.error ?? "matrices latest error");

        const mooJson = (await mooRes.json()) as {
          ok: boolean;
          grid?: MatrixValues;
          error?: string;
        };
        if (!mooJson.ok) throw new Error(mooJson.error ?? "moo-aux error");

        const universeRaw = Array.isArray(matricesJson.meta?.universe)
          ? (matricesJson.meta!.universe as string[])
          : [];
        const universeCoins = universeRaw.length
          ? universeRaw.map((coin) => ensureUpper(coin)).filter(Boolean)
          : requestCoins;
        const matrixCoins = dedupeUpper([
          ...coins,
          ...universeCoins,
          ...requestCoins,
        ]);

        const benchmarkGrid = valuesToGrid(matrixCoins, matricesJson.matrices?.benchmark?.values);
        const pct24Grid = valuesToGrid(matrixCoins, matricesJson.matrices?.pct24h?.values);
        const refGrid = valuesToGrid(matrixCoins, matricesJson.matrices?.ref?.values);
        const idPctGrid = valuesToGrid(matrixCoins, matricesJson.matrices?.id_pct?.values);
        const meaGrid = valuesToGrid(matrixCoins, mooJson.grid ?? {});
        const frozenGrid = (matricesJson.matrices?.benchmark?.flags as any)?.frozen as boolean[][] | undefined;
        const payloadSymbols = Array.isArray(matricesJson.symbols)
          ? matricesJson.symbols.map((sym) => ensureUpper(sym)).filter(Boolean)
          : [];

        if (controller.signal.aborted) return;
        setMarketMatrix({
          loading: false,
          error: null,
          coins: matrixCoins,
          benchmark: benchmarkGrid,
          pct24h: pct24Grid,
          mea: meaGrid,
          ref: refGrid,
          idPct: idPctGrid,
          frozen: frozenGrid,
          timestamp: matricesJson.ts ?? Date.now(),
          symbols: payloadSymbols,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setMarketMatrix((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();

    return () => controller.abort();
  }, [marketCoinsKey, marketQuoteKey, marketTimestampKey, coinsKey]);

  const matrixCoins = marketMatrix.coins.length ? marketMatrix.coins : requestCoins;
  const matrixCoinsKey = useMemo(() => matrixCoins.join("|"), [matrixCoins]);
  const snapshotCoinsKey = useMemo(
    () => (snapshot?.coins ?? []).map((coin) => ensureUpper(coin)).filter(Boolean).join("|"),
    [snapshot?.coins]
  );
  const snapshotCoins = useMemo(
    () => (snapshotCoinsKey ? snapshotCoinsKey.split("|") : []),
    [snapshotCoinsKey]
  );
  const fallbackBenchmarkGrid = useMemo(
    () => projectMatrixGrid(matrixCoins, snapshotCoins, snapshot?.matrix?.benchmark),
    [matrixCoinsKey, snapshotCoinsKey, snapshot?.matrix?.benchmark]
  );
  const fallbackMeaGrid = useMemo(
    () => projectMatrixGrid(matrixCoins, snapshotCoins, snapshot?.matrix?.mea),
    [matrixCoinsKey, snapshotCoinsKey, snapshot?.matrix?.mea]
  );
  const fallbackRefGrid = useMemo(
    () => projectMatrixGrid(matrixCoins, snapshotCoins, snapshot?.matrix?.ref),
    [matrixCoinsKey, snapshotCoinsKey, snapshot?.matrix?.ref]
  );
  const fallbackIdPctGrid = useMemo(
    () => projectMatrixGrid(matrixCoins, snapshotCoins, snapshot?.matrix?.id_pct),
    [matrixCoinsKey, snapshotCoinsKey, snapshot?.matrix?.id_pct]
  );
  const matrixBenchmark = useMemo(
    () => mergeGrids(matrixCoins, marketMatrix.benchmark, fallbackBenchmarkGrid),
    [matrixCoinsKey, marketMatrix.benchmark, fallbackBenchmarkGrid]
  );
  const matrixMea = useMemo(
    () => mergeGrids(matrixCoins, marketMatrix.mea, fallbackMeaGrid),
    [matrixCoinsKey, marketMatrix.mea, fallbackMeaGrid]
  );
  const matrixRef = useMemo(
    () => mergeGrids(matrixCoins, marketMatrix.ref, fallbackRefGrid),
    [matrixCoinsKey, marketMatrix.ref, fallbackRefGrid]
  );
  const matrixIdPct = useMemo(
    () => mergeGrids(matrixCoins, marketMatrix.idPct, fallbackIdPctGrid),
    [matrixCoinsKey, marketMatrix.idPct, fallbackIdPctGrid]
  );
  const matrixPct24h = useMemo(
    () => mergeGrids(matrixCoins, marketMatrix.pct24h, undefined),
    [matrixCoinsKey, marketMatrix.pct24h]
  );
  const matrixFrozen = marketMatrix.frozen;
  const matrixPayloadSymbols = marketMatrix.symbols;
  const matrixTimestamp = marketMatrix.timestamp ?? null;
  const matrixLoading = marketMatrix.loading;
  const matrixError = marketMatrix.error;

  const currencyMetrics = useMemo(
    () =>
      snapshot
        ? [
            {
              label: "MEA value",
              value: formatNumber(snapshot.metrics?.mea?.value, { fallback: "—", precision: 4 }),
              hint: `Tier ${snapshot.metrics?.mea?.tier ?? "n/a"}`,
            },
            {
              label: "Universe size",
              value: snapshot.coins?.length ?? 0,
              hint: "Tracked coins in dynamics grid",
            },
            {
              label: "Candidates",
              value: snapshot.candidates?.length ?? 0,
              hint: "Arbitrage search scope",
            },
          ]
        : [],
    [snapshot]
  );

  const handleSelectMatrixCell = useCallback(
    ({ base, quote }: { base: string; quote: string }) => {
      setSelected((prev) => {
        const next = normalizePair({ base, quote }, coins, fallbackPair);
        if (next.base === prev.base && next.quote === prev.quote) return prev;
        return next;
      });
    },
    [coins, fallbackPair]
  );

  const handleSelectCandidate = (coin: string) => {
    const upper = ensureUpper(coin);
    if (!upper) return;
    setSelected((prev) => {
      if (!allowedCoinSet.has(upper)) return prev;
      if (upper === prev.base || upper === prev.quote) return prev;
      return normalizePair({ base: prev.base, quote: upper }, coins, fallbackPair);
    });
  };

  const pageStatus = loading || availability.loading ? "Loading snapshot…" : vm ? "Snapshot ready" : "Awaiting data";

  return (
    <div className="min-h-screen bg-[#020305] text-slate-100">
      <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-8 px-6 py-8 lg:px-8 xl:px-12">
        <header className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-[0.35em] text-emerald-300/70">{pageStatus}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-emerald-200">Dynamics dashboard</h1>
          <p className="max-w-3xl text-sm text-slate-400">
            Scaffold for the refreshed dynamics client. Monitor selection identity and arbitrage flow while we rebuild
            the matrix and auxiliary panels.
          </p>
          {error ? (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          ) : null}
          {availability.error ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {`Market pairs unavailable (${availability.error}) – using fallback universe.`}
            </div>
          ) : null}
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.35fr_1.65fr] xl:grid-cols-[1.25fr_1.75fr]">
          <AssetIdentity
            base={selected.base}
            quote={selected.quote}
            wallets={snapshot?.wallets}
            lastUpdated={snapshot?.builtAt}
            candidates={candidateCoins}
            matrixCoins={matrixCoins}
            benchmarkGrid={matrixBenchmark}
            pct24hGrid={matrixPct24h}
            idPctGrid={matrixIdPct}
            refGrid={matrixRef}
            series={snapshot?.series ?? null}
            strMetrics={snapshot?.metrics?.str ?? null}
            loading={loading || availability.loading}
            previewSymbols={previewSymbolSet}
            allowedSymbols={allowedSymbolSet}
            onSelectCandidate={handleSelectCandidate}
            onSelectPair={handleSelectMatrixCell}
            className="min-w-0"
          />

          <ArbTable
            base={selected.base}
            quote={selected.quote}
            rows={arbRows}
            loading={loading || availability.loading}
            refreshing={loading && !!arbRows.length}
            onRefresh={refresh}
            onSelectRow={handleSelectCandidate}
            className="min-w-0"
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,0.3fr)] xl:grid-cols-[minmax(0,0.72fr)_minmax(0,0.28fr)]">
          <DynamicsMatrix
            coins={matrixCoins}
            mea={matrixMea}
            ref={matrixRef}
            idPct={matrixIdPct}
            frozenGrid={matrixFrozen}
            allowedSymbols={allowedSymbolSet}
            previewSet={previewSymbolSet}
            payloadSymbols={matrixPayloadSymbols}
            selected={selected}
            lastUpdated={matrixTimestamp}
            loading={matrixLoading}
            onSelect={handleSelectMatrixCell}
            className="min-w-0"
          />

          <div className="flex min-w-0 flex-col gap-4">
            {matrixError ? (
              <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
                {matrixError}
              </div>
            ) : null}
            <AuxiliaryCard
              base={selected.base}
              quote={selected.quote}
              metrics={snapshot?.metrics ?? null}
              cin={snapshot?.cin ?? snapshot?.metrics?.cin ?? null}
              candidates={snapshot?.candidates?.length ? snapshot.candidates : candidateCoins}
              coins={snapshot?.coins?.length ? snapshot.coins : matrixCoins}
              benchmarkGrid={snapshot?.matrix?.benchmark}
              lastUpdated={snapshot?.builtAt ?? matrixTimestamp}
              loading={loading || availability.loading}
              className="min-w-0"
            />
          </div>
        </section>

        {currencyMetrics.length ? (
          <footer className="mt-10">
            <div className="rounded-3xl border border-emerald-500/20 bg-[#03070f]/70 p-4 shadow-[0_0_24px_rgba(16,185,129,0.12)]">
              <div className="text-[11px] uppercase tracking-[0.35em] text-emerald-300/70">Metrics</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {currencyMetrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-2xl border border-emerald-500/25 bg-[#010b14]/80 px-3 py-3 text-right"
                  >
                    <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-300/60">
                      {metric.label}
                    </div>
                    <div className="mt-1 font-mono text-base text-emerald-100">{metric.value}</div>
                    {metric.hint ? (
                      <div className="mt-1 text-[10px] text-emerald-300/55">{metric.hint}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </footer>
        ) : null}
      </main>
    </div>
  );
}





