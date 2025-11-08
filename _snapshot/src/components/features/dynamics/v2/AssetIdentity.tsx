"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { DynamicsCard } from "@/components/features/dynamics/DynamicsCard";
import {
  classNames,
  formatNumber,
  formatPercent,
  uniqueUpper,
} from "@/components/features/dynamics/utils";
import type { DynamicsSnapshot } from "@/core/converters/provider.types";

type Grid = Array<Array<number | null>>;

export type CurrencyMetric = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "positive" | "negative";
};

type SeriesSnapshot = DynamicsSnapshot["series"];
type StrMetrics = DynamicsSnapshot["metrics"]["str"];

export type AssetIdentityProps = {
  base: string;
  quote: string;
  wallets?: Record<string, number>;
  lastUpdated?: number | string | Date | null;
  metrics?: CurrencyMetric[];
  candidates?: string[];
  matrixCoins?: string[];
  benchmarkGrid?: Grid;
  pct24hGrid?: Grid;
  idPctGrid?: Grid;
  refGrid?: Grid;
  series?: SeriesSnapshot | null;
  strMetrics?: StrMetrics | null;
  loading?: boolean;
  previewSymbols?: Set<string>;
  allowedSymbols?: Set<string>;
  onSelectCandidate?: (symbol: string) => void;
  onSelectPair?: (payload: { base: string; quote: string }) => void;
  className?: string;
};

type PairSummary = {
  key: string;
  base: string;
  quote: string;
  symbol: string;
  metrics: {
    benchmark: number | null;
    id_pct: number | null;
    pct24h: number | null;
    ref: number | null;
  };
  preview: boolean;
  exists: boolean;
  available: boolean;
};

type PairCardMetric = {
  key: string;
  label: string;
  value: string;
};

type PairCardProps = {
  title: string;
  metrics: PairCardMetric[];
  symbol: string;
  preview?: boolean;
  exists?: boolean;
  available?: boolean;
  onSelect?: () => void;
};

type SparkOption = {
  key: string;
  label: string;
  color: string;
  data: number[];
  current: string;
};

const TONE_CLASS: Record<NonNullable<CurrencyMetric["tone"]>, string> = {
  neutral: "text-emerald-200",
  positive: "text-emerald-300",
  negative: "text-rose-300",
};

const ensureUpper = (value: string | null | undefined): string =>
  String(value ?? "").trim().toUpperCase();

function toMillis(
  value: AssetIdentityProps["lastUpdated"],
): number | null {
  if (value == null && value !== 0) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime())
    ? value.getTime()
    : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatRelative(
  value: AssetIdentityProps["lastUpdated"],
): string {
  const millis = toMillis(value);
  if (millis == null) return "n/a";
  const delta = Math.max(0, Date.now() - millis);
  const seconds = Math.floor(delta / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function readGridValue(
  grid: Grid | undefined,
  indexMap: Map<string, number>,
  base: string,
  quote: string,
): number | null {
  if (!grid || !grid.length) return null;
  const i = indexMap.get(base);
  const j = indexMap.get(quote);
  if (i == null || j == null) return null;
  const raw = grid[i]?.[j];
  if (raw == null) return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

function buildSeries(
  raw: number[],
  fallbackValue: number | null,
  fallbackLength: number,
): number[] {
  if (raw.length >= 2) return raw;
  if (raw.length === 1) return [raw[0]!, raw[0]!];
  if (fallbackValue == null || !Number.isFinite(fallbackValue)) return [];
  const len = Math.max(fallbackLength, 12);
  return Array.from({ length: len }, () => fallbackValue);
}

function seriesToNumbers(
  series: SeriesSnapshot | null | undefined,
  kind: "id_pct" | "pct_drv",
): number[] {
  if (!series) return [];
  const bucket: number[] = [];
  const timeline =
    kind === "id_pct" ? series.id_pct_ts : series.pct_drv_ts;
  if (Array.isArray(timeline)) {
    for (const entry of timeline) {
      const value = Number((entry as any)?.value);
      if (Number.isFinite(value)) bucket.push(value);
    }
  }
  if (!bucket.length) {
    const arr = kind === "id_pct" ? series.id_pct : series.pct_drv;
    if (Array.isArray(arr)) {
      for (const value of arr) {
        const num = Number(value);
        if (Number.isFinite(num)) bucket.push(num);
      }
    }
  }
  return bucket;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const rawId = useId();
  const bars = useMemo(() => {
    if (!Array.isArray(data) || !data.length) return [];
    const finiteValues = data.filter((value) => Number.isFinite(value)) as number[];
    if (!finiteValues.length) return [];
    const maxAbs = Math.max(...finiteValues.map((value) => Math.abs(value))) || 1;
    return finiteValues.map((value, idx) => ({
      key: `${rawId}-${idx}`,
      value,
      normalized: Math.min(1, Math.abs(value) / maxAbs),
    }));
  }, [data, rawId]);

  if (!bars.length) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-emerald-300/60">
        Signal unavailable
      </div>
    );
  }

  const baseline = 24;
  const upperRange = 18;
  const lowerRange = 22;
  const step = 100 / Math.max(bars.length, 1);
  const barWidth = Math.max(3.5, step * 0.55);
  const offset = (step - barWidth) / 2;

  return (
    <svg
      viewBox="0 0 100 60"
      preserveAspectRatio="none"
      className="h-full w-full"
    >
      <rect x="0" y="0" width="100" height="60" fill="transparent" />
      <line
        x1="0"
        y1={baseline}
        x2="100"
        y2={baseline}
        stroke="rgba(94,234,212,0.15)"
        strokeWidth={0.9}
        strokeDasharray="2 3"
      />
      {bars.map((bar, idx) => {
        const x = idx * step + offset;
        if (bar.value >= 0) {
          const height = bar.normalized * upperRange;
          return (
            <rect
              key={bar.key}
              x={x}
              y={baseline - height}
              width={barWidth}
              height={height}
              fill={color}
              opacity={0.85}
              rx={1}
            />
          );
        }
        const height = bar.normalized * lowerRange;
        return (
          <rect
            key={bar.key}
            x={x}
            y={baseline}
            width={barWidth}
            height={height}
            fill="rgba(248,113,113,0.8)"
            rx={1}
          />
        );
      })}
    </svg>
  );
}

function InsightBadge({ metric }: { metric: CurrencyMetric }) {
  const toneClass = metric.tone
    ? TONE_CLASS[metric.tone]
    : "text-emerald-100";
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-black/15 p-2.5">
      <div className="text-[9px] uppercase tracking-[0.28em] text-emerald-300/60">
        {metric.label}
      </div>
      <div
        className={classNames(
          "mt-1 text-base font-semibold tracking-tight",
          toneClass,
        )}
      >
        {metric.value}
      </div>
      {metric.hint ? (
        <div className="mt-1 text-[10px] text-emerald-300/55">
          {metric.hint}
        </div>
      ) : null}
    </div>
  );
}

function PairCard({
  title,
  metrics,
  symbol,
  preview,
  exists = true,
  available = true,
  onSelect,
}: PairCardProps) {
  const disabled = !exists || !available || !onSelect;
  const statusLabel = !exists
    ? "No matrix data"
    : available
    ? `Focus ${symbol}`
    : "Not allowed";

  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-emerald-500/20 bg-[#03070f]/75 p-3 shadow-[0_0_18px_rgba(16,185,129,0.12)]">
      <header className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
          {title}
        </div>
        {preview ? (
          <span className="rounded-full border border-emerald-400/50 bg-emerald-400/15 px-2 py-[1px] text-[9px] uppercase tracking-[0.24em] text-emerald-200">
            preview
          </span>
        ) : null}
      </header>
      <ul className="space-y-1.5 text-[12px] text-emerald-100">
        {metrics.map((item) => (
          <li
            key={item.key}
            className="flex items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.2em]"
          >
            <span className="text-emerald-300/70">{item.label}</span>
            <span className="text-emerald-100/90 tracking-tight">
              {item.value}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={classNames(
          "mt-auto inline-flex items-center justify-center rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] transition",
          disabled
            ? "cursor-not-allowed border-emerald-500/20 bg-transparent text-emerald-400/40"
            : "border-emerald-400/40 bg-emerald-400/15 text-emerald-100 hover:border-emerald-300/60 hover:bg-emerald-400/25",
        )}
        disabled={disabled}
        onClick={() => onSelect?.()}
      >
        {statusLabel}
      </button>
    </div>
  );
}

export default function AssetIdentity({
  base,
  quote,
  wallets,
  lastUpdated,
  metrics,
  candidates,
  matrixCoins,
  benchmarkGrid,
  pct24hGrid,
  idPctGrid,
  refGrid,
  series,
  strMetrics,
  loading,
  previewSymbols,
  allowedSymbols,
  onSelectCandidate,
  onSelectPair,
  className,
}: AssetIdentityProps) {
  const A = useMemo(() => ensureUpper(base), [base]);
  const B = useMemo(() => ensureUpper(quote), [quote]);
  const coinsKey = useMemo(
    () => (matrixCoins ?? []).map((coin) => ensureUpper(coin)).join("|"),
    [matrixCoins],
  );
  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    (matrixCoins ?? []).forEach((coin, idx) => {
      const upper = ensureUpper(coin);
      if (upper && !map.has(upper)) map.set(upper, idx);
    });
    return map;
  }, [coinsKey]);

  const buildPair = useCallback(
    (
      baseSymbol: string | null,
      quoteSymbol: string | null,
      key: string,
    ): PairSummary | null => {
      const b = ensureUpper(baseSymbol);
      const q = ensureUpper(quoteSymbol);
      if (!b || !q || b === q) return null;
      const exists =
        indexMap.has(b) &&
        indexMap.has(q) &&
        (benchmarkGrid?.[indexMap.get(b)!]?.[indexMap.get(q)!] != null ||
          idPctGrid?.[indexMap.get(b)!]?.[indexMap.get(q)!] != null ||
          pct24hGrid?.[indexMap.get(b)!]?.[indexMap.get(q)!] != null ||
          refGrid?.[indexMap.get(b)!]?.[indexMap.get(q)!] != null);
      const symbolKey = `${b}${q}`;
      const allowed =
        allowedSymbols?.size
          ? allowedSymbols.has(symbolKey)
          : true;
      return {
        key,
        base: b,
        quote: q,
        symbol: `${b}/${q}`,
        metrics: {
          benchmark: readGridValue(benchmarkGrid, indexMap, b, q),
          id_pct: readGridValue(idPctGrid, indexMap, b, q),
          pct24h: readGridValue(pct24hGrid, indexMap, b, q),
          ref: readGridValue(refGrid, indexMap, b, q),
        },
        preview: previewSymbols?.has(symbolKey) ?? false,
        exists,
        available: exists && allowed,
      };
    },
    [
      indexMap,
      benchmarkGrid,
      idPctGrid,
      pct24hGrid,
      refGrid,
      previewSymbols,
      allowedSymbols,
    ],
  );

  const { directPair, inversePair, baseUsdtPair, quoteUsdtPair } =
    useMemo(() => {
      const direct = buildPair(A, B, "direct");
      const inverse = buildPair(B, A, "inverse");
      const baseUsdt =
        A && A !== "USDT" ? buildPair(A, "USDT", "base-usdt") : null;
      const quoteUsdt =
        B && B !== "USDT" && B !== A
          ? buildPair(B, "USDT", "quote-usdt")
          : null;
      return {
        directPair: direct,
        inversePair: inverse,
        baseUsdtPair: baseUsdt,
        quoteUsdtPair: quoteUsdt,
      };
    }, [A, B, buildPair]);

  const idPctSeries = useMemo(
    () => seriesToNumbers(series, "id_pct"),
    [series],
  );
  const pctDrvSeries = useMemo(
    () => seriesToNumbers(series, "pct_drv"),
    [series],
  );
  const fallbackSeriesLength =
    Math.max(idPctSeries.length, pctDrvSeries.length, 16) || 16;

  const gfmSeriesData = useMemo(
    () =>
      buildSeries(
        idPctSeries,
        strMetrics?.gfm ?? directPair?.metrics.benchmark ?? null,
        fallbackSeriesLength,
      ),
    [idPctSeries, strMetrics, directPair, fallbackSeriesLength],
  );
  const refSeriesData = useMemo(
    () =>
      buildSeries(
        pctDrvSeries,
        directPair?.metrics.ref ?? inversePair?.metrics.ref ?? null,
        fallbackSeriesLength,
      ),
    [pctDrvSeries, directPair, inversePair, fallbackSeriesLength],
  );
  const sparkOptions = useMemo<SparkOption[]>(() => {
    const opts: SparkOption[] = [
      {
        key: "gfm",
        label: "GFM",
        color: "#34d399",
        data: gfmSeriesData,
        current:
          strMetrics?.gfm != null
            ? formatNumber(strMetrics.gfm, { fallback: "-" })
            : formatNumber(directPair?.metrics.benchmark, {
                fallback: "-",
              }),
      },
      {
        key: "ref",
        label: "REF",
        color: "#60a5fa",
        data: refSeriesData,
        current: formatNumber(directPair?.metrics.ref, {
          fallback: "-",
          precision: 4,
        }),
      },
    ];
    return opts.filter((opt) => opt.data.length >= 1);
  }, [gfmSeriesData, refSeriesData, strMetrics, directPair]);

  const [focusKey, setFocusKey] = useState<string>(
    () => sparkOptions[0]?.key ?? "gfm",
  );

  useEffect(() => {
    if (!sparkOptions.length) return;
    if (!sparkOptions.some((opt) => opt.key === focusKey)) {
      setFocusKey(sparkOptions[0]!.key);
    }
  }, [sparkOptions, focusKey]);

  const selectedOption =
    sparkOptions.find((opt) => opt.key === focusKey) ??
    sparkOptions[0] ??
    null;

  const inlineMetrics = useMemo(() => (metrics?.length ? metrics : null), [metrics]);

  const walletEntries = useMemo(() => {
    const order = uniqueUpper([
      A,
      B,
      "USDT",
      ...(wallets ? Object.keys(wallets) : []),
    ]);
    return order.slice(0, 6).map((coin) => ({
      coin,
      balance: wallets?.[coin] ?? null,
    }));
  }, [wallets, A, B]);

  const variants = useMemo(() => {
    const tokens = uniqueUpper([
      ...(candidates ?? []),
      ...(wallets ? Object.keys(wallets) : []),
    ]);
    return tokens.filter((coin) => coin !== A && coin !== B).slice(0, 16);
  }, [candidates, wallets, A, B]);

  const statusLabel = loading
    ? "Loading identity..."
    : `Snapshot · ${formatRelative(lastUpdated)}`;

  const primaryPairs = useMemo(
    () =>
      [directPair, inversePair].filter(
        (pair): pair is PairSummary => !!pair,
      ),
    [directPair, inversePair],
  );
  const secondaryPairs = useMemo(
    () =>
      [baseUsdtPair, quoteUsdtPair].filter(
        (pair): pair is PairSummary => !!pair,
      ),
    [baseUsdtPair, quoteUsdtPair],
  );

  return (
    <DynamicsCard
      title="Asset identity"
      subtitle={`${A || "-"} / ${B || "-"}`}
      status={statusLabel}
      className={classNames(
        "rounded-3xl border border-emerald-500/25 bg-[#050812]/90 shadow-[0_0_36px_rgba(16,185,129,0.15)] backdrop-blur",
        className,
      )}
      contentClassName="flex flex-col gap-6"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/30 bg-[#03060f]/80 p-3.5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.35em] text-emerald-300/70">
              Wallet
            </div>
            <ul className="mt-2 space-y-1.5 text-xs">
              {walletEntries.map(({ coin, balance }) => (
                <li
                  key={coin}
                  className="flex items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-100/75"
                >
                  <span
                    className={classNames(
                      coin === A
                        ? "text-emerald-200"
                        : coin === B
                        ? "text-cyan-200"
                        : "text-emerald-300/60",
                    )}
                  >
                    {coin}
                  </span>
                  <span className="tracking-normal text-[11px] text-emerald-100">
                    {formatNumber(balance, { fallback: "-" })}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {inlineMetrics?.length ? (
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-300/65">
                Metrics
              </div>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                {inlineMetrics.map((metric) => (
                  <InsightBadge key={metric.label} metric={metric} />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex min-h-[140px] flex-col gap-3 rounded-2xl border border-emerald-500/30 bg-[#010b14]/80 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.35em] text-emerald-300/70">
                Metric focus
              </div>
              <div className="text-sm text-emerald-200/75">
                {selectedOption?.label ?? "Unavailable"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {sparkOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setFocusKey(option.key)}
                  className={classNames(
                    "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.35em] transition",
                    focusKey === option.key
                      ? "border-emerald-300/60 bg-emerald-300/20 text-emerald-100"
                      : "border-emerald-500/20 bg-transparent text-emerald-300/60 hover:border-emerald-400/40 hover:bg-emerald-400/10",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 rounded-xl border border-emerald-500/20 bg-[#030b16]/80 p-2">
            {selectedOption ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between text-xs text-emerald-300/70">
                  <span>Current</span>
                  <span className="font-mono text-sm text-emerald-100">
                    {selectedOption.current}
                  </span>
                </div>
                <div className="mt-2 h-14">
                  <Sparkline
                    data={selectedOption.data}
                    color={selectedOption.color}
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-emerald-200/60">
                Metric signals unavailable
              </div>
            )}
          </div>
        </div>
      </div>

      {primaryPairs.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {primaryPairs.map((pair) => {
            const metricsList: PairCardMetric[] = [
              {
                key: "bm",
                label: "bm",
                value: formatNumber(pair.metrics.benchmark, {
                  fallback: "-",
                  precision: 6,
                }),
              },
              {
                key: "id_pct",
                label: "id_pct",
                value: formatPercent(pair.metrics.id_pct, {
                  fallback: "-",
                  precision: 3,
                }),
              },
              {
                key: "pct24h",
                label: "pct24h",
                value: formatPercent(pair.metrics.pct24h, {
                  fallback: "-",
                  precision: 3,
                }),
              },
            ];
            return (
              <PairCard
                key={pair.key}
                title={pair.symbol}
                symbol={pair.symbol}
                metrics={metricsList}
                preview={pair.preview}
                exists={pair.exists}
                available={pair.available}
                onSelect={
                  onSelectPair
                    ? () => onSelectPair({ base: pair.base, quote: pair.quote })
                    : undefined
                }
              />
            );
          })}
        </div>
      ) : null}

      {secondaryPairs.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {secondaryPairs.map((pair) => {
            const metricsList: PairCardMetric[] = [
              {
                key: "bm",
                label: "bm",
                value: formatNumber(pair.metrics.benchmark, {
                  fallback: "-",
                  precision: 6,
                }),
              },
              {
                key: "id_pct",
                label: "id_pct",
                value: formatPercent(pair.metrics.id_pct, {
                  fallback: "-",
                  precision: 3,
                }),
              },
              {
                key: "pct24h",
                label: "pct24h",
                value: formatPercent(pair.metrics.pct24h, {
                  fallback: "-",
                  precision: 3,
                }),
              },
            ];
            return (
              <PairCard
                key={pair.key}
                title={pair.symbol}
                symbol={pair.symbol}
                metrics={metricsList}
                preview={pair.preview}
                exists={pair.exists}
                available={pair.available}
                onSelect={
                  onSelectPair
                    ? () => onSelectPair({ base: pair.base, quote: pair.quote })
                    : undefined
                }
              />
            );
          })}
        </div>
      ) : null}

      {variants.length ? (
        <div>
          <div className="text-[11px] uppercase tracking-[0.35em] text-emerald-300/70">
            Universe
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {variants.map((coin) => (
              <button
                key={coin}
                type="button"
                className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.24em] text-emerald-100 transition hover:border-emerald-400/40 hover:bg-emerald-400/20"
                onClick={() => onSelectCandidate?.(coin)}
              >
                {coin}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </DynamicsCard>
  );
}
