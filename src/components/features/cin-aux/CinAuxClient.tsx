"use client";

import React, { useCallback, useEffect, useState } from "react";
import type {
  CinRuntimeSessionSummary,
  CinRuntimeAssetPnl,
  CinRuntimeMoveRow,
} from "@/core/features/cin-aux/cinAuxContracts";
import { MooAlignmentPanelV2 } from "./MooAlignementPanelV2";

interface CinAuxClientProps {
  initialSessionId?: number | null;
  initialMooSessionUuid?: string | null;
}

const USD_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PCT_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatUsd = (value: string | number | null | undefined): string => {
  const num = toNumber(value);
  return USD_FORMAT.format(num);
};

const formatUsdSigned = (value: number | string | null | undefined): string => {
  const num = toNumber(value);
  const prefix = num >= 0 ? "+" : "-";
  return `${prefix}${USD_FORMAT.format(Math.abs(num))}`;
};

const formatUnitsWithAsset = (
  value: string | number | null | undefined,
  asset: string,
): string => {
  if (value == null) return "-";
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const magnitude = Math.abs(num);
  const decimals = magnitude >= 1 ? 4 : 6;
  return `${num.toFixed(decimals)} ${asset}`;
};

const formatPercent = (value: number | string | null | undefined): string => {
  const num = toNumber(value);
  if (!Number.isFinite(num)) return "-";
  return `${PCT_FORMAT.format(num * 100)}%`;
};

const formatUnits = (value: number | null | undefined, digits = 6): string => {
  if (value == null) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
};

const AUTO_SYNC_INTERVAL_MS = 8000;

async function safeJson(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return null;
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function ensureOk(res: Response, label: string) {
  const payload = await safeJson(res);
  if (!res.ok) {
    const detail =
      payload && typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as any).error ?? "")
        : "";
    const suffix = detail ? `: ${detail}` : "";
    throw new Error(`${label} failed (HTTP ${res.status}${suffix})`);
  }
  return payload;
}

const CinAuxClient: React.FC<CinAuxClientProps> = ({
  initialSessionId = null,
  initialMooSessionUuid = null,
}) => {
  const [sessions, setSessions] = useState<CinRuntimeSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    initialSessionId
  );
  const [selectedSession, setSelectedSession] =
    useState<CinRuntimeSessionSummary | null>(null);
  const [assets, setAssets] = useState<CinRuntimeAssetPnl[]>([]);
  const [moves, setMoves] = useState<CinRuntimeMoveRow[]>([]);
  const [assetTau, setAssetTau] = useState<CinAssetTauRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [mooSessionUuid, setMooSessionUuid] = useState<string | null>(
    initialMooSessionUuid
  );

  const [sessionError, setSessionError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // ---- helpers ----

  const [refreshToken, setRefreshToken] = useState(0);
  const forceReloadDetails = useCallback(() => {
    setRefreshToken((x) => x + 1);
  }, []);

  // ---- load sessions list ----

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    setSessionError(null);
    try {
      const res = await fetch("/api/cin-aux/runtime/sessions");

      if (!res.ok) {
        console.error("cin sessions HTTP error", res.status);
        setSessions([]);
        setSessionError(`HTTP ${res.status}`);
        return;
      }

      const data = await safeJson(res);
      if (!Array.isArray(data)) {
        console.warn("cin sessions unexpected payload", data);
        setSessions([]);
        setSessionError("Unexpected response format");
        return;
      }

      const list = data as CinRuntimeSessionSummary[];
      setSessions(list);

      if (list.length > 0 && selectedSessionId == null) {
        setSelectedSessionId(list[0].sessionId);
      }
    } catch (err) {
      console.error("Failed to load cin runtime sessions:", err);
      setSessions([]);
      setSessionError("Failed to load sessions");
    } finally {
      setLoadingSessions(false);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // ---- load balances + moves for selected session ----

  useEffect(() => {
    if (selectedSessionId == null) {
      setSelectedSession(null);
      setAssets([]);
      setMoves([]);
      setAssetTau([]);
      setDetailError(null);
      return;
    }

    const controller = new AbortController();

    const loadDetails = async () => {
      setLoadingDetails(true);
      setDetailError(null);

      try {
        const [assetsRes, movesRes, tauRes] = await Promise.all([
          fetch(
            `/api/cin-aux/runtime/sessions/${selectedSessionId}/balances`,
            { signal: controller.signal }
          ),
          fetch(`/api/cin-aux/runtime/sessions/${selectedSessionId}/moves`, {
            signal: controller.signal,
          }),
          fetch(
            `/api/cin-aux/runtime/sessions/${selectedSessionId}/tau/assets`,
            { signal: controller.signal },
          ),
        ]);

        // balances
        if (!assetsRes.ok) {
          console.error("cin balances HTTP error", assetsRes.status);
        } else {
          const assetsJson = await safeJson(assetsRes);
          if (
            assetsJson &&
            typeof assetsJson === "object" &&
            "session" in assetsJson &&
            "assets" in assetsJson
          ) {
            const sess = (assetsJson as any).session as CinRuntimeSessionSummary;
            const assetList = (assetsJson as any)
              .assets as CinRuntimeAssetPnl[];
            setSelectedSession(sess);
            setAssets(assetList);
          } else {
            console.warn("cin balances unexpected payload", assetsJson);
            setAssets([]);
          }
        }

        // moves
        if (!movesRes.ok) {
          console.error("cin moves HTTP error", movesRes.status);
        } else {
          try {
            const movesJson = await safeJson(movesRes);
            if (Array.isArray(movesJson)) {
              setMoves(movesJson as CinRuntimeMoveRow[]);
            } else {
              console.warn("cin moves unexpected payload", movesJson);
              setMoves([]);
            }
          } catch (err) {
            console.error("cin moves parse error", err);
            setMoves([]);
          }
        }

        // per-asset tau
        if (!tauRes.ok) {
          setAssetTau([]);
        } else {
          try {
            const tauJson = await safeJson(tauRes);
            if (Array.isArray(tauJson)) {
              setAssetTau(tauJson as CinAssetTauRow[]);
            } else {
              setAssetTau([]);
            }
          } catch (err) {
            console.error("cin tau parse error", err);
            setAssetTau([]);
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.error("Failed to load cin session details:", err);
        setDetailError("Failed to load details");
        setAssets([]);
        setMoves([]);
      } finally {
        setLoadingDetails(false);
      }
    };

    loadDetails();

    return () => controller.abort();
  }, [selectedSessionId, refreshToken]);

  // ---- open new session ----

    const handleOpenSession = async () => {
    try {
      let newId: number | null = null;

      // 1) tenta o endpoint novo: POST /api/cin-aux/runtime/sessions
      try {
        const res = await fetch("/api/cin-aux/runtime/sessions", {
          method: "POST",
        });

        if (!res.ok) {
          console.warn("runtime/sessions POST not ok:", res.status);
        } else {
          const data = await safeJson(res);
          if (data && typeof data === "object" && "sessionId" in data) {
            newId = Number((data as any).sessionId);
          } else {
            console.warn("runtime/sessions unexpected payload:", data);
          }
        }
      } catch (err) {
        console.warn("runtime/sessions POST failed:", err);
      }

      // 2) fallback: tenta o endpoint legado /api/cin-aux/session/open
      if (newId == null) {
        try {
          const res2 = await fetch("/api/cin-aux/session/open", {
            method: "POST",
          });

          if (!res2.ok) {
            console.warn("session/open POST not ok:", res2.status);
          } else {
            const data2 = await safeJson(res2);
            if (data2 && typeof data2 === "object" && "sessionId" in data2) {
              newId = Number((data2 as any).sessionId);
            } else {
              console.warn("session/open unexpected payload:", data2);
            }
          }
        } catch (err2) {
          console.warn("session/open POST failed:", err2);
        }
      }

      // 3) sempre recarrega lista de sessões
      await fetchSessions();

      // 4) se conseguimos descobrir um id, seleciona ele
      if (newId != null) {
        setSelectedSessionId(newId);
      }
    } catch (err) {
      console.error("Error opening session:", err);
    }
  };

  // ---- render ----

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 lg:p-8 w-full h-full">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
            Cin-Aux Runtime
          </h1>
          <p className="text-sm text-gray-500">
            Runtime ledger, luggage, reconciliation and Moo/MEA alignment.
          </p>
          {sessionError && (
            <p className="text-xs text-rose-600 mt-1">
              Sessions: {sessionError}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleOpenSession}
          className="px-3 py-1 rounded-md bg-indigo-600 text-white text-sm shadow hover:bg-indigo-700"
        >
          + New Runtime Session
        </button>
      </header>

      <main className="flex flex-col xl:flex-row gap-4 lg:gap-6 h-full">
        <section className="w-full xl:w-1/3 flex flex-col">
          <RuntimeSessionBoard
            sessions={sessions}
            loading={loadingSessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
          />
        </section>

        <section className="w-full xl:w-2/3 flex flex-col gap-4">
          <RuntimeSessionDetail
            session={selectedSession}
            assets={assets}
            moves={moves}
            assetTau={assetTau}
            loading={loadingDetails}
            error={detailError}
            onRefreshSession={forceReloadDetails}
            actionMessage={actionMessage}
            onActionMessage={setActionMessage}
          />

          <MooAlignmentPanelV2
            sessionUuid={mooSessionUuid}
            onChangeSessionUuid={setMooSessionUuid}
          />
        </section>
      </main>
    </div>
  );
};


interface RuntimeSessionBoardProps {
  sessions: CinRuntimeSessionSummary[];
  loading: boolean;
  selectedSessionId: number | null;
  onSelectSession: (id: number) => void;
}

const RuntimeSessionBoard: React.FC<RuntimeSessionBoardProps> = ({
  sessions,
  loading,
  selectedSessionId,
  onSelectSession,
}) => {
  return (
    <div className="border rounded-xl p-3 md:p-4 bg-white/80 shadow-sm flex-1 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
          Sessions
        </h2>
        {loading && (
          <span className="text-xs text-gray-400 animate-pulse">
            Loading...
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {sessions.length === 0 && !loading && (
          <p className="text-sm text-gray-500">
            No runtime sessions found. Use the button above to open one.
          </p>
        )}

        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.sessionId}>
              <button
                type="button"
                onClick={() => onSelectSession(s.sessionId)}
                className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition hover:border-gray-400 hover:bg-gray-50 ${
                  selectedSessionId === s.sessionId
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    #{s.sessionId} · {s.windowLabel}
                  </span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>
                    Luggage: {s.luggageTotalProfitUsdt} USDT profit ·{" "}
                    {s.luggageTotalPrincipalUsdt} USDT principal
                  </span>
                  {s.deltaRatio != null && (
                    <span>
                      Drift:{" "}
                      {Number(s.deltaRatio) * 100 < 0 ? "-" : "+"}
                      {Math.abs(Number(s.deltaRatio) * 100).toFixed(2)}%
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ status: CinRuntimeSessionSummary["status"] }> = ({
  status,
}) => {
  const label =
    status === "balanced"
      ? "Balanced"
      : status === "drifted"
      ? "Drifted"
      : "Broken";
  const colorClass =
    status === "balanced"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : status === "drifted"
      ? "bg-amber-100 text-amber-700 border-amber-200"
      : "bg-rose-100 text-rose-700 border-rose-200";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colorClass}`}
    >
      {label}
    </span>
  );
};

interface RuntimeSessionDetailProps {
  session: CinRuntimeSessionSummary | null;
  assets: CinRuntimeAssetPnl[];
  moves: CinRuntimeMoveRow[];
  assetTau: CinAssetTauRow[];
  loading: boolean;
  error: string | null;
  onRefreshSession?: () => void;
  actionMessage?: string | null;
  onActionMessage?: (msg: string | null) => void;
}

const RuntimeSessionDetail: React.FC<RuntimeSessionDetailProps> = ({
  session,
  assets,
  moves,
  assetTau,
  loading,
  error,
  onRefreshSession,
  actionMessage,
  onActionMessage,
}) => {
  if (!session) {
    return (
      <div className="border rounded-xl p-4 bg-white/80 shadow-sm flex-1 flex items-center justify-center">
        <p className="text-sm text-gray-500">
          Select a session on the left to inspect its balances and moves.
        </p>
      </div>
    );
  }

  const imprintPrincipal = toNumber(session.imprintPrincipalChurnUsdt);
  const imprintProfit = toNumber(session.imprintProfitChurnUsdt);
  const luggagePrincipal = toNumber(session.luggageTotalPrincipalUsdt);
  const luggageProfit = toNumber(session.luggageTotalProfitUsdt);
  const imprintNet = imprintProfit - luggageProfit;
  const cinTotal = toNumber(session.cinTotalMtmUsdt);
  const refTotal = toNumber(session.refTotalUsdt);
  const deltaUsdt =
    session.deltaUsdt != null ? toNumber(session.deltaUsdt) : cinTotal - refTotal;
  const deltaRatio =
    session.deltaRatio != null
      ? toNumber(session.deltaRatio)
      : refTotal !== 0
      ? deltaUsdt / refTotal
      : null;
  const startedAt = session.startedAt
    ? new Date(session.startedAt).toLocaleString()
    : "-";
  const endedAt = session.endedAt
    ? new Date(session.endedAt).toLocaleString()
    : null;
  const deltaClass =
    deltaRatio == null
      ? "text-gray-500"
      : Math.abs(deltaRatio) < 0.005
      ? "text-emerald-600"
      : Math.abs(deltaRatio) < 0.02
      ? "text-amber-600"
      : "text-rose-600";

  return (
    <div className="flex flex-col gap-4 flex-1">
      <div className="border rounded-xl p-4 bg-white/80 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
              Session Summary
            </h2>
            <p className="text-xs text-gray-500">
              #{session.sessionId} · {session.windowLabel} · Started {startedAt}
              {endedAt ? ` · Closed ${endedAt}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={session.status} />
            <CinButtons
              sessionId={session.sessionId}
              onAfterAction={onRefreshSession}
              onMessage={onActionMessage}
            />
          </div>
        </div>

        <p className="text-[11px] text-gray-500 leading-snug mb-3">
          Workflow: 1) Sync trades to pull Binance fills, 2) Refresh wallet to
          ingest them and rebuild balances, 3) Refresh prices to update MTM. Use
          Close Session once reconciled.
        </p>

        {actionMessage && (
          <p className="text-xs text-sky-700 bg-sky-50 border border-sky-100 rounded-md px-2 py-1 mb-2">
            {actionMessage}
          </p>
        )}

        {error && (
          <p className="text-xs text-rose-600 mb-2">Details: {error}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
          <div>
            <p className="text-[11px] uppercase text-gray-500">Imprint & Luggage</p>
            <div className="mt-1 space-y-1">
              <p>
                Imprint principal:{" "}
                <span className="font-semibold">
                  {formatUsd(imprintPrincipal)}
                </span>
              </p>
              <p>
                Imprint PnL:{" "}
                <span className="font-semibold">
                  {formatUsd(imprintProfit)}
                </span>
              </p>
              <p>
                Luggage principal:{" "}
                <span className="font-semibold">
                  {formatUsd(luggagePrincipal)}
                </span>
              </p>
              <p>
                Luggage PnL:{" "}
                <span className="font-semibold">
                  {formatUsd(luggageProfit)}
                </span>
              </p>
              <p
                className={`text-sm font-semibold ${
                  imprintNet >= 0 ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                Net imprint: {formatUsdSigned(imprintNet)}
              </p>
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase text-gray-500">Reconciliation</p>
            <div className="mt-1 space-y-1">
              <p>
                CIN MTM:{" "}
                <span className="font-semibold">{formatUsd(cinTotal)}</span>
              </p>
              <p>
                Reference:{" "}
                <span className="font-semibold">{formatUsd(refTotal)}</span>
              </p>
              <p>
                Delta:{" "}
                <span className={`font-semibold ${deltaClass}`}>
                  {formatUsdSigned(deltaUsdt)}{" "}
                  {deltaRatio != null ? `(${formatPercent(deltaRatio)})` : ""}
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="border rounded-xl p-4 bg-white/80 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
            Assets &amp; Wallet
          </h2>
          {loading && (
            <span className="text-xs text-gray-400 animate-pulse">
              Refreshing...
            </span>
          )}
        </div>
        <AssetGrid assets={assets} />
      </div>

      <div className="border rounded-xl p-4 bg-white/80 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
            Move Ledger
          </h2>
          {loading && (
            <span className="text-xs text-gray-400 animate-pulse">
              Refreshing...
            </span>
          )}
        </div>
        <MoveTable moves={moves} />
        <AssetTauTable rows={assetTau} />
      </div>
    </div>
  );
};

const AssetGrid: React.FC<{ assets: CinRuntimeAssetPnl[] }> = ({ assets }) => {
  if (assets.length === 0) {
    return <p className="text-sm text-gray-500">No balances for this session.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {assets.map((a, idx) => {
        const total = toNumber(a.mtmValueUsdt);
        const profit = toNumber(a.profitUsdt);
        const pnlPct = total !== 0 ? profit / total : 0;
        const weightPct =
          a.weightInPortfolio != null ? formatPercent(a.weightInPortfolio) : "-";
        const walletUnits =
          a.accountUnits != null ? formatUnits(a.accountUnits) : null;

        return (
          <div
            key={`${a.assetId}-${idx}`}
            className="border rounded-lg p-3 bg-white flex flex-col justify-between"
          >
            <div className="flex items-center justify-between mb-1">
              <div>
                <div className="font-semibold text-sm">{a.assetId}</div>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-[1px] text-[10px] ${
                    a.inUniverse
                      ? "border-emerald-200 text-emerald-600"
                      : "border-zinc-300 text-zinc-500"
                  }`}
                >
                  {a.inUniverse ? "Universe" : "Off universe"}
                </span>
              </div>
              <div className="text-right text-xs text-gray-500">
                {a.priceUsdt ? `${formatUsd(a.priceUsdt)} price` : "—"}
              </div>
            </div>
            <div className="text-xs text-gray-600 space-y-0.5">
              <div>
                Principal:{" "}
                <span className="font-medium">
                  {formatUsd(a.principalUsdt)}
                </span>
              </div>
              <div>
                Profit:{" "}
                <span
                  className={`font-medium ${
                    profit >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {formatUsd(a.profitUsdt)}
                </span>
                <span className="text-[11px] text-gray-400 ml-1">
                  ({formatPercent(pnlPct)})
                </span>
              </div>
              <div>
                MTM:{" "}
                <span className="font-medium">{formatUsd(a.mtmValueUsdt)}</span>
              </div>
              <div>
                Weight: <span className="font-medium">{weightPct}</span>
              </div>
              {a.referenceUsdt && (
                <div>
                  Reference:{" "}
                  <span className="font-medium">
                    {formatUsd(a.referenceUsdt)}
                  </span>
                </div>
              )}
              {walletUnits && (
                <div>
                  Wallet: <span className="font-medium">{walletUnits}</span>{" "}
                  units
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const MoveTable: React.FC<{ moves: CinRuntimeMoveRow[] }> = ({ moves }) => {
  if (moves.length === 0) {
    return <p className="text-sm text-gray-500">No moves recorded.</p>;
  }

  const totals = moves.reduce(
    (acc, move) => {
      const pnl = getMovePnl(move);
      const imprint = getMoveImprint(move);
      const luggage = getMoveLuggage(move);
      return {
        pnl: acc.pnl + pnl,
        imprint: acc.imprint + imprint,
        luggage: acc.luggage + luggage,
      };
    },
    { pnl: 0, imprint: 0, luggage: 0 },
  );

  return (
    <>
      <div className="flex flex-wrap gap-4 text-xs text-gray-600 mb-2">
        <span>
          Moves: <span className="font-semibold text-gray-800">{moves.length}</span>
        </span>
        <span>
          Net PnL:{" "}
          <span
            className={`font-semibold ${
              totals.pnl >= 0 ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {formatUsdSigned(totals.pnl)}
          </span>
        </span>
        <span>
          Imprint:{" "}
          <span className="font-semibold">
            {formatUsdSigned(totals.imprint)}
          </span>
        </span>
        <span>
          Luggage:{" "}
          <span className="font-semibold">{formatUsd(totals.luggage)}</span>
        </span>
      </div>
      <div className="overflow-auto max-h-80 border rounded-lg">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-gray-500">
              <th className="px-2 py-1">Time</th>
              <th className="px-2 py-1">From</th>
              <th className="px-2 py-1">To</th>
              <th className="px-2 py-1">Symbol</th>
              <th className="px-2 py-1">Side</th>
              <th className="px-2 py-1">Sold</th>
              <th className="px-2 py-1">Bought</th>
              <th className="px-2 py-1">Notional</th>
              <th className="px-2 py-1">PnL</th>
              <th className="px-2 py-1">Imprint</th>
              <th className="px-2 py-1">Luggage</th>
              <th className="px-2 py-1">Fees</th>
              <th className="px-2 py-1">Trace</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => {
            const pnl = getMovePnl(m);
            const imprint = getMoveImprint(m);
            const luggage = getMoveLuggage(m);
            return (
              <tr key={m.moveId} className="border-b last:border-0">
                <td className="px-2 py-1 whitespace-nowrap text-gray-500">
                  {new Date(m.ts).toLocaleString()}
                </td>
                <td className="px-2 py-1">
                  <span className="font-medium">{m.fromAsset}</span>
                </td>
                <td className="px-2 py-1">
                  <span className="font-medium">{m.toAsset}</span>
                </td>
                <td className="px-2 py-1 text-gray-600">
                  <div className="font-mono text-[11px]">
                    {m.srcSymbol ?? "—"}
                  </div>
                  {m.srcTradeId && (
                    <div className="text-[10px] text-gray-400">
                      #{m.srcTradeId}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1">
                  <span className="font-medium uppercase">
                    {m.srcSide ?? "-"}
                  </span>
                </td>
                <td className="px-2 py-1 text-gray-700">
                  {m.fromUnits
                    ? formatUnitsWithAsset(m.fromUnits, m.fromAsset)
                    : "-"}
                </td>
                <td className="px-2 py-1 text-gray-700">
                  {m.toUnitsReceived
                    ? formatUnitsWithAsset(m.toUnitsReceived, m.toAsset)
                    : "-"}
                </td>
                <td className="px-2 py-1">
                  {formatUsd(m.executedUsdt)}
                </td>
                <td
                  className={`px-2 py-1 font-medium ${
                    pnl >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {pnl.toFixed(2)}
                </td>
                <td
                  className={`px-2 py-1 font-medium ${
                    imprint >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {imprint.toFixed(2)}
                </td>
                <td className="px-2 py-1">{luggage.toFixed(2)}</td>
                <td className="px-2 py-1">{m.feeUsdt}</td>
                <td className="px-2 py-1 text-gray-500">{m.traceUsdt}</td>
              </tr>
            );
          })}
          </tbody>
        </table>
      </div>
    </>
  );
};

const AssetTauTable: React.FC<{ rows: CinAssetTauRow[] }> = ({ rows }) => {
  if (!rows.length) {
    return (
      <p className="text-xs text-gray-500 mt-2">
        Imprint by coin will appear after moves are recorded.
      </p>
    );
  }

  const totals = rows.reduce(
    (acc, row) => ({
      imprint: acc.imprint + toNumber(row.imprintUsdt),
      luggage: acc.luggage + toNumber(row.luggageUsdt),
    }),
    { imprint: 0, luggage: 0 },
  );

  return (
    <div className="border rounded-lg bg-white/80 overflow-auto mt-3">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 border-b text-gray-500">
          <tr>
            <th className="px-2 py-1 text-left">Asset</th>
            <th className="px-2 py-1 text-left">Imprint</th>
            <th className="px-2 py-1 text-left">Luggage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.assetId} className="border-b last:border-0">
              <td className="px-2 py-1 font-semibold text-gray-700">
                {row.assetId}
              </td>
              <td
                className={`px-2 py-1 ${
                  toNumber(row.imprintUsdt) >= 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }`}
              >
                {formatUsdSigned(row.imprintUsdt)}
              </td>
              <td className="px-2 py-1">{formatUsd(row.luggageUsdt)}</td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-semibold text-gray-700">
            <td className="px-2 py-1">Total</td>
            <td
              className={`px-2 py-1 ${
                totals.imprint >= 0 ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {formatUsdSigned(totals.imprint)}
            </td>
            <td className="px-2 py-1">{formatUsd(totals.luggage)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

function getMovePnl(move: CinRuntimeMoveRow): number {
  if (move.pnlForMoveUsdt != null) return toNumber(move.pnlForMoveUsdt);
  if (move.compProfitUsdt != null) return toNumber(move.compProfitUsdt);
  return 0;
}

function getMoveImprint(move: CinRuntimeMoveRow): number {
  return toNumber(move.compProfitUsdt) - toNumber(move.profitConsumedUsdt);
}

function getMoveLuggage(move: CinRuntimeMoveRow): number {
  return (
    toNumber(move.feeUsdt) +
    toNumber(move.slippageUsdt) +
    toNumber(move.traceUsdt) +
    toNumber(move.principalHitUsdt)
  );
}

export function CinButtons({
  sessionId,
  onAfterAction,
  onMessage,
}: {
  sessionId: number;
  onAfterAction?: () => void;
  onMessage?: (message: string | null) => void;
}) {
  const [autoSync, setAutoSync] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const RATE_LIMIT_COOLDOWN_MS = Number(process.env.NEXT_PUBLIC_CIN_RATE_LIMIT_COOLDOWN_MS ?? 60_000);

  const isCoolingDown = () =>
    cooldownUntil != null && cooldownUntil > Date.now();

  const formatCooldownMessage = () => {
    if (!isCoolingDown()) return "";
    const seconds = Math.max(
      1,
      Math.ceil(((cooldownUntil as number) - Date.now()) / 1000),
    );
    return `Binance rate limit cooling down (${seconds}s remaining).`;
  };

  useEffect(() => {
    setAutoSync(false);
    setCooldownUntil(null);
  }, [sessionId]);

  const run = async (
    action: () => Promise<void>,
    opts?: { silent?: boolean },
  ) => {
    if (isCoolingDown()) {
      if (!opts?.silent) {
        onMessage?.(formatCooldownMessage());
      }
      return;
    }
    if (!opts?.silent) {
      onMessage?.(null);
    }
    try {
      await action();
      onAfterAction?.();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Operation failed. Check server logs for details.";
      const rateLimited =
        message.includes("HTTP 429") ||
        message.toLowerCase().includes("request weight");
      if (rateLimited) {
        const until = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        setCooldownUntil(until);
        setAutoSync(false);
        onMessage?.(
          `Binance request limit reached. Waiting ~${Math.ceil(
            RATE_LIMIT_COOLDOWN_MS / 1000,
          )}s before retry.`,
        );
      } else if (!opts?.silent) {
        onMessage?.(message);
      }
      console.error("[cin-aux action]", err);
    }
  };

  const requestTradeSync = async () => {
    const res = await fetch(
      `/api/cin-aux/runtime/sessions/${sessionId}/trades/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      },
    );
    if (res.status === 404) {
      onMessage?.("Trade/convert sync endpoint not available yet.");
      return null;
    }
    return ensureOk(res, "Trade sync");
  };

  const requestWalletIngest = async () => {
    const ingestRes = await fetch(
      `/api/cin-aux/runtime/sessions/${sessionId}/wallet/ingest`,
      { method: "POST" },
    );
    return ensureOk(ingestRes, "Wallet ingest");
  };

  const requestWalletRefresh = async () => {
    const refreshRes = await fetch(
      `/api/cin-aux/runtime/sessions/${sessionId}/wallet/refresh`,
      { method: "POST" },
    );
    return ensureOk(refreshRes, "Wallet refresh");
  };

  const requestPriceRefresh = async () => {
    const res = await fetch(
      `/api/cin-aux/runtime/sessions/${sessionId}/prices/refresh`,
      { method: "POST" },
    );
    if (res.status === 404) {
      onMessage?.("Price refresh endpoint not available yet.");
      return null;
    }
    return ensureOk(res, "Price refresh");
  };

  const runWalletPipeline = async ({
    includeTradeSync = false,
    includePriceRefresh = false,
    silent = false,
  }: {
    includeTradeSync?: boolean;
    includePriceRefresh?: boolean;
    silent?: boolean;
  }) => {
    if (includeTradeSync) {
      await requestTradeSync();
    }
    const ingest = await requestWalletIngest();
    await requestWalletRefresh();
    let priceInfo: any = null;
    if (includePriceRefresh) {
      priceInfo = await requestPriceRefresh();
    }
    if (!silent) {
      onMessage?.(
        `Wallet recomputed (${ingest?.importedMoves ?? 0} moves imported)${
          includePriceRefresh
            ? `, prices refreshed for ${priceInfo?.marked ?? 0} assets.`
            : "."
        }`,
      );
    }
  };

  useEffect(() => {
    if (!autoSync || isCoolingDown()) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await run(
        () =>
          runWalletPipeline({
            includeTradeSync: true,
            includePriceRefresh: true,
            silent: true,
          }),
        { silent: true },
      );
      if (!cancelled) {
        timer = setTimeout(tick, AUTO_SYNC_INTERVAL_MS);
      }
    };
    let timer = setTimeout(tick, AUTO_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [autoSync, sessionId, cooldownUntil]);

  return (
    <div className="flex flex-wrap gap-2">
        <button
          className="rounded-2xl px-3 py-1 border text-sm"
          onClick={() =>
            run(async () => {
              const data = await requestTradeSync();
              if (data) {
                const convert = data.importedConvert ?? 0;
                onMessage?.(
                  `Trades synced: ${data.importedTrades ?? "?"} (convert: ${convert})`,
                );
              }
            })
          }
        >
          Sync Trades + Convert
        </button>
        <button
          className="rounded-2xl px-3 py-1 border text-sm"
          onClick={() =>
            run(async () => {
              const ingest = await requestWalletIngest();
              onMessage?.(
                `Ingestion job queued (${ingest?.importedMoves ?? 0} move(s)).`,
              );
            })
          }
        >
          Run Ingestion Job
        </button>
        <button
          className="rounded-2xl px-3 py-1 border text-sm"
          onClick={() =>
            run(() =>
              runWalletPipeline({
                includeTradeSync: true,
              }),
            )
          }
        >
          Refresh Wallet
        </button>
        <button
          className="rounded-2xl px-3 py-1 border text-sm"
          onClick={() =>
            run(async () => {
              const data = await requestPriceRefresh();
              if (data) {
                onMessage?.(
                  `Prices refreshed for ${data?.marked ?? 0} assets.`,
                );
              }
            })
          }
        >
          Refresh Prices
        </button>
        <button
          className="rounded-2xl px-3 py-1 border text-sm"
          onClick={() => {
            if (!confirm("Close this session?")) return;
            run(async () => {
              const res = await fetch(
                `/api/cin-aux/runtime/sessions/${sessionId}/close`,
                { method: "POST" }
              );
              if (res.status === 404) {
                onMessage?.("Close session endpoint not available yet.");
                return;
              }
              await ensureOk(res, "Close session");
              onMessage?.("Session closed.");
            });
          }}
        >
        Close Session
      </button>
      <button
        className={`rounded-2xl px-3 py-1 border text-sm ${
          autoSync ? "bg-emerald-600 text-white" : ""
        }`}
        onClick={() => {
          if (!autoSync && isCoolingDown()) {
            onMessage?.(formatCooldownMessage());
            return;
          }
          const next = !autoSync;
          setAutoSync(next);
          onMessage?.(
            next
              ? "Auto refresh enabled (syncs every 8 seconds)."
              : "Auto refresh disabled.",
          );
        }}
      >
        {autoSync ? "Auto Sync ON" : "Auto Sync OFF"}
      </button>
      <button
        className="rounded-2xl px-3 py-1 text-sm text-white bg-blue-600 hover:bg-blue-700 shadow"
        onClick={() =>
          run(() =>
            runWalletPipeline({
              includeTradeSync: true,
              includePriceRefresh: true,
            }),
          )
        }
      >
        Full Sync &amp; Refresh
      </button>
    </div>
  );
}


export default CinAuxClient;
