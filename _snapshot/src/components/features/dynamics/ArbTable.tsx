"use client";

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DynamicsCard } from "./DynamicsCard";
import { classNames, formatNumber, uniqueUpper } from "./utils";

export type SwapTag = {
  count: number;
  direction: "up" | "down" | "frozen";
  changedAtIso?: string;
};

export type RowMetrics = {
  benchmark?: number;
  id_pct?: number;
  vTendency?: number;
  inertia?: "low" | "neutral" | "high" | "frozen";
  swapTag?: SwapTag;
};

type EdgeKey = "cb_ci" | "ci_ca" | "ca_ci";

export type ArbRow = {
  ci: string;
  cols?: Partial<Record<EdgeKey, Partial<RowMetrics>>> & Record<string, Partial<RowMetrics> | undefined>;
  metrics?: Partial<RowMetrics>;
};

export type ArbTableProps = {
  Ca: string;
  Cb: string;
  candidates: string[];
  wallets?: Record<string, number>;
  rows: ArbRow[];
  loading?: boolean;
  className?: string;
  defaultSort?: { key: "id_pct" | "benchmark" | "symbol"; dir: "asc" | "desc" };
  onRowClick?: (ci: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshLabel?: string;
};

const EMPTY_ROWS: ArbRow[] = [];

const ArrowUpDownIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    {/* up arrow (left) */}
    <path d="M7 3v14" />
    <path d="M3 7l4-4 4 4" />
    {/* down arrow (right) */}
    <path d="M17 21V7" />
    <path d="M13 17l4 4 4-4" />
  </svg>
);



const EDGE_ORDER: EdgeKey[] = ["cb_ci", "ci_ca", "ca_ci"];
const EDGE_LABEL: Record<EdgeKey, string> = {
  cb_ci: "Cb>Ci",
  ci_ca: "Ci>Ca",
  ca_ci: "Ca>Ci",
};

const EDGE_VARIANTS: Record<EdgeKey, string[]> = {
  cb_ci: ["cbToCi", "CB_CI", "cb-ci"],
  ci_ca: ["ciToCa", "CI_CA", "ci-ca"],
  ca_ci: ["caToCi", "CA_CI", "ca-ci"],
};

const DEFAULT_SORT: Required<ArbTableProps["defaultSort"]> = {
  key: "id_pct",
  dir: "desc",
};

const NEUTRAL_TAG: SwapTag = { count: 0, direction: "frozen" };

type SortKey = NonNullable<ArbTableProps["defaultSort"]>["key"];
type SortDir = NonNullable<ArbTableProps["defaultSort"]>["dir"];

type SortState = {
  key: SortKey;
  dir: SortDir;
};

type PreparedRow = {
  ci: string;
  row: ArbRow;
  edges: Record<EdgeKey, Partial<RowMetrics> | undefined>;
  sortBench: number;
  sortId: number;
};

function getEdgeMetrics(row: ArbRow, edge: EdgeKey): Partial<RowMetrics> | undefined {
  const cols = (row.cols ?? {}) as Record<string, Partial<RowMetrics> | undefined>;
  if (cols[edge]) return cols[edge];
  for (const alias of EDGE_VARIANTS[edge]) {
    if (cols[alias]) return cols[alias];
  }
  return row.metrics;
}

function pickNumber(src: any, keys: string[]): number {
  if (!src || typeof src !== "object") return Number.NaN;
  for (const key of keys) {
    const value = Number((src as any)[key]);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

const SortButton = memo(
  function SortButton({
    label,
    active,
    direction,
    onClick,
  }: {
    label: string;
    active: boolean;
    direction?: SortDir;
    onClick(): void;
  }) {
    const iconClass = classNames(
      "h-3 w-3 transition-transform",
      active && direction === "asc" ? "rotate-180" : "rotate-0",
      active ? "opacity-100" : "opacity-70"
    );

    return (
      <button
        type="button"
        className={classNames(
          "inline-flex items-center gap-1 text-left",
          active ? "text-slate-100" : "text-slate-400 hover:text-slate-200"
        )}
        onClick={onClick}
      >
        {label} <ArrowUpDownIcon className="h-4 w-4" />
        <span className="sr-only">sort</span>
      </button>
    );
  }
);

SortButton.displayName = "SortButton";

const EdgeCell = memo(function EdgeCell({
  metrics,
  pill,
  bootNeutral,
}: {
  metrics?: Partial<RowMetrics>;
  pill: SwapTag;
  bootNeutral: boolean;
}) {
  const showPill = bootNeutral || pill.direction !== "frozen" || pill.count > 0;

  return (
    <td className="px-3 py-2 text-right align-top">
      <div className="inline-flex items-center gap-2">
        <span className="font-mono tabular-nums">{formatNumber(metrics?.id_pct, { precision: 6 })}</span>
        {showPill ? <PillSwap tag={pill} /> : null}
      </div>
      <div className="text-[11px] cp-subtle">
        bm {formatNumber(metrics?.benchmark, { precision: 4 })} | drv {formatNumber(metrics?.vTendency, { precision: 3 })}
      </div>
    </td>
  );
});

EdgeCell.displayName = "EdgeCell";

function PillSwap({ tag }: { tag: SwapTag }) {
  const tone =
    tag.direction === "up"
      ? "border-emerald-500/40 text-emerald-200 bg-emerald-600/15"
      : tag.direction === "down"
      ? "border-rose-500/40 text-rose-200 bg-rose-600/15"
      : "border-zinc-500/40 text-zinc-300 bg-black/20";

  const label =
    tag.direction === "up"
      ? "Trending up"
      : tag.direction === "down"
      ? "Trending down"
      : "Frozen";

  return (
    <span
      title={tag.changedAtIso ? `${label} - last flip ${new Date(tag.changedAtIso).toLocaleString()}` : label}
      className={classNames(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone
      )}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums">{formatNumber(tag.count, { precision: 0, minimumFractionDigits: 0 })}</span>
    </span>
  );
}

const WalletChips = memo(function WalletChips({
  wallets,
  coins,
}: {
  wallets?: Record<string, number>;
  coins: string[];
}) {
  if (!wallets) return null;

  const chips = coins
    .map((coin) => [coin, wallets[coin]] as const)
    .filter(([, balance]) => balance != null)
    .slice(0, 8);

  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {chips.map(([coin, balance]) => (
        <span key={coin} className="cp-pill" title={`${coin} balance`}>
          {coin}:{" "}
          {formatNumber(balance, { precision: 3, minimumFractionDigits: 0 })}
        </span>
      ))}
    </div>
  );
});

WalletChips.displayName = "WalletChips";

export default function ArbTable({
  Ca,
  Cb,
  candidates,
  wallets,
  rows,
  loading,
  className,
  defaultSort = DEFAULT_SORT,
  onRowClick,
  onRefresh,
  refreshing,
  refreshLabel,
}: ArbTableProps) {
  const A = useMemo(() => String(Ca).toUpperCase(), [Ca]);
  const B = useMemo(() => String(Cb).toUpperCase(), [Cb]);
  const safeRows = rows.length ? rows : EMPTY_ROWS;

  const candidatesUpper = useMemo(() => {
    const normalized = uniqueUpper(candidates);
    return normalized.filter((coin) => coin !== A && coin !== B);
  }, [candidates, A, B]);

  const [sort, setSort] = useState<SortState>(defaultSort);
  const baselinesRef = useRef<Record<string, number>>({});
  const [bootNeutral, setBootNeutral] = useState(true);

  const normalizeTag = useCallback(
    (ci: string, edge: EdgeKey, tag?: SwapTag): SwapTag => {
      const key = `${ci}|${edge}`;
      const baselines = baselinesRef.current;
      const raw = Math.max(0, Number(tag?.count ?? 0));
      if (!(key in baselines)) baselines[key] = raw;
      const normalized = Math.max(0, raw - baselines[key]);
      return {
        count: normalized,
        direction: tag?.direction ?? "frozen",
        changedAtIso: tag?.changedAtIso,
      };
    },
    []
  );

  const prepared = useMemo<PreparedRow[]>(() => {
    const map = new Map<string, ArbRow>();
    for (const ci of candidatesUpper) map.set(ci, { ci });
    for (const row of safeRows) {
      if (!row?.ci) continue;
      const ci = String(row.ci).toUpperCase();
      map.set(ci, { ...row, ci });
    }

    return Array.from(map.values()).map((row) => {
      const edges: Record<EdgeKey, Partial<RowMetrics> | undefined> = {
        cb_ci: getEdgeMetrics(row, "cb_ci"),
        ci_ca: getEdgeMetrics(row, "ci_ca"),
        ca_ci: getEdgeMetrics(row, "ca_ci"),
      };
      const primary = edges.cb_ci ?? row.metrics ?? {};
      const sortId = pickNumber(primary, ["id_pct", "id", "idpct", "idPct"]);
      const sortBench = pickNumber(primary, ["benchmark", "bm", "bench"]);
      return {
        ci: row.ci,
        row,
        edges,
        sortId,
        sortBench,
      };
    });
  }, [candidatesUpper, safeRows]);

  const sorted = useMemo(() => {
    const next = [...prepared];
    next.sort((a, b) => {
      if (sort.key === "symbol") {
        return sort.dir === "asc" ? a.ci.localeCompare(b.ci) : b.ci.localeCompare(a.ci);
      }
      const aVal = sort.key === "id_pct" ? a.sortId : a.sortBench;
      const bVal = sort.key === "id_pct" ? b.sortId : b.sortBench;
      const aSafe = Number.isFinite(aVal) ? aVal : Number.NEGATIVE_INFINITY;
      const bSafe = Number.isFinite(bVal) ? bVal : Number.NEGATIVE_INFINITY;
      return sort.dir === "asc" ? aSafe - bSafe : bSafe - aSafe;
    });
    return next.slice(0, 5);
  }, [prepared, sort]);

  useEffect(() => {
    if (!bootNeutral && sorted.length) return;
    if (sorted.length) setBootNeutral(false);
  }, [sorted, bootNeutral]);

  const handleSort = useCallback(
    (key: SortKey) => {
      setSort((current) =>
        current.key === key
          ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
          : { key, dir: "desc" }
      );
    },
    []
  );

  const walletCoins = useMemo(() => uniqueUpper([A, B, ...candidatesUpper]), [A, B, candidatesUpper]);
  const refreshText = refreshLabel ?? "Refresh";
  const headerSubtitle = `A:${A} / B:${B}`;
  const headerStatus = refreshing ? "Refreshing..." : loading ? "Loading..." : undefined;
  const headerActions =
    onRefresh ? (
      <button
        type="button"
        className="btn btn-silver text-xs disabled:opacity-60"
        onClick={onRefresh}
        disabled={refreshing || loading}
      >
        {refreshText}
      </button>
    ) : undefined;

  return (
    <DynamicsCard
      title="Arbitrage paths"
      subtitle={headerSubtitle}
      status={headerStatus}
      actions={headerActions}
      className={className}
    >
      <WalletChips wallets={wallets} coins={walletCoins} />

      <div className="mt-1 flex-1 overflow-hidden">
        <div className="h-full overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">
                  <SortButton label="Ci" active={sort.key === "symbol"} direction={sort.dir} onClick={() => handleSort("symbol")} />
                </th>
                {EDGE_ORDER.map((edge) => (
                  <th key={edge} className="px-3 py-2 text-right">
                    {EDGE_LABEL[edge]}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">
                  <SortButton label="id_pct" active={sort.key === "id_pct"} direction={sort.dir} onClick={() => handleSort("id_pct")} />
                </th>
                <th className="px-3 py-2 text-right">
                  <SortButton label="bench" active={sort.key === "benchmark"} direction={sort.dir} onClick={() => handleSort("benchmark")} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ ci, edges, row, sortBench, sortId }) => {
                const upperCi = ci.toUpperCase();
                const pills: Record<EdgeKey, SwapTag> = {
                  cb_ci: bootNeutral ? NEUTRAL_TAG : normalizeTag(upperCi, "cb_ci", edges.cb_ci?.swapTag),
                  ci_ca: bootNeutral ? NEUTRAL_TAG : normalizeTag(upperCi, "ci_ca", edges.ci_ca?.swapTag),
                  ca_ci: bootNeutral ? NEUTRAL_TAG : normalizeTag(upperCi, "ca_ci", edges.ca_ci?.swapTag),
                };

                const idValue = Number.isFinite(sortId) ? sortId : row.metrics?.id_pct;
                const benchValue = Number.isFinite(sortBench) ? sortBench : row.metrics?.benchmark;

                return (
                  <tr
                    key={upperCi}
                    className="cursor-pointer border-t border-[var(--cp-border)] hover:bg-white/5"
                    onClick={() => onRowClick?.(upperCi)}
                    title={`Inspect ${upperCi}`}
                  >
                    <td className="px-3 py-2 text-left font-mono uppercase tracking-wide">{upperCi}</td>
                    {EDGE_ORDER.map((edge) => (
                      <EdgeCell key={edge} metrics={edges[edge]} pill={pills[edge]} bootNeutral={bootNeutral} />
                    ))}
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatNumber(idValue, { precision: 6 })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatNumber(benchValue, { precision: 4 })}
                    </td>
                  </tr>
                );
              })}

              {!sorted.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">
                    {loading || refreshing ? "Loading arbitrage candidates..." : "No candidates."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DynamicsCard>
  );
}
