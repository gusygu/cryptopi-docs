"use client";

import React, { useEffect, useMemo, useState } from "react";

interface ScoredRow {
  symbol: string;
  suggested_weight: number | null;
  actual_weight: number | null;
  weight_delta: number | null;
  abs_delta: number | null;
  severity_level: string;
  alignment_score: number;
  need_rebalance: boolean;
}

interface MooAlignmentPanelV2Props {
  sessionUuid: string | null;
  onChangeSessionUuid: (value: string | null) => void;
}

export const MooAlignmentPanelV2: React.FC<MooAlignmentPanelV2Props> = ({
  sessionUuid,
  onChangeSessionUuid,
}) => {
  const [rows, setRows] = useState<ScoredRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Fetch scored alignment when we have a valid UUID
  useEffect(() => {
    if (!sessionUuid) {
      setRows([]);
      setErrorText(null);
      return;
    }

    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setErrorText(null);

      try {
        const res = await fetch(
          `/api/cin-aux/mea/${encodeURIComponent(sessionUuid)}/scored`,
          { signal: controller.signal }
        );

        if (!res.ok) {
          console.warn("Moo scored HTTP error:", res.status);
          setRows([]);
          setErrorText(`HTTP ${res.status}`);
          return;
        }

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) {
          console.warn("Moo scored non-JSON response:", contentType);
          setRows([]);
          setErrorText("Non-JSON response from server");
          return;
        }

        const data = await res.json();
        if (!Array.isArray(data)) {
          console.warn("Moo scored unexpected payload:", data);
          setRows([]);
          setErrorText("Unexpected response format");
          return;
        }

        setRows(data as ScoredRow[]);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.error("MOA V2 load error:", err);
        setRows([]);
        setErrorText("Failed to load Moo alignment");
      } finally {
        setLoading(false);
      }
    };

    load();

    return () => controller.abort();
  }, [sessionUuid]);

  const globalScore = useMemo(() => {
    if (!rows.length) return null;
    const sum = rows.reduce(
      (acc, r) => acc + (typeof r.alignment_score === "number" ? r.alignment_score : 0),
      0
    );
    return sum / rows.length;
  }, [rows]);

  const chartData = rows.map((r) => ({
    symbol: r.symbol,
    suggestedWeight: r.suggested_weight ?? 0,
    actualWeight: r.actual_weight ?? 0,
    weightDelta: r.weight_delta ?? 0,
  }));

  return (
    <div className="border rounded-xl p-4 bg-white/80 shadow-sm mt-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
          Moo / MEA Alignment — Advanced
        </h2>
        {loading && (
          <p className="text-xs text-gray-500 animate-pulse">Loading…</p>
        )}
      </div>

      {/* SESSION UUID INPUT */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-600 mb-1">
          Moo Session UUID
        </label>
        <input
          className="w-full border rounded-md px-2 py-1 text-xs"
          value={sessionUuid ?? ""}
          onChange={(e) => onChangeSessionUuid(e.target.value || null)}
          placeholder="uuid from cin_aux.sessions"
        />
      </div>

      {errorText && (
        <p className="text-xs text-rose-600 mb-2">
          Moo endpoint: {errorText}
        </p>
      )}

      {/* GLOBAL SCORE */}
      {globalScore !== null && (
        <div className="mb-4">
          <p className="text-sm font-medium text-gray-700 mb-1">
            Alignment Score
          </p>
          <div className="w-full bg-gray-200 rounded-full h-3 relative">
            <div
              className={`h-3 rounded-full ${
                globalScore > 80
                  ? "bg-emerald-500"
                  : globalScore > 60
                  ? "bg-amber-500"
                  : "bg-rose-500"
              }`}
              style={{ width: `${Math.max(0, Math.min(100, globalScore))}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {globalScore.toFixed(2)} / 100
          </p>
        </div>
      )}

      {/* SIMPLE BAR VIEW */}
      {chartData.length > 0 && (
        <div className="mb-6">
          <p className="text-sm font-medium text-gray-700 mb-2">
            Weight Comparison
          </p>
          <div className="space-y-3">
            {chartData.map((row) => (
              <div key={row.symbol}>
                <p className="text-xs font-semibold">{row.symbol}</p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div>
                    <p className="text-[11px] text-gray-500">Suggested</p>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(100, row.suggestedWeight * 100)
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-500">Actual</p>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-purple-500 h-2 rounded-full"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(100, row.actualWeight * 100)
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  Δ {(row.weightDelta * 100).toFixed(2)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TABLE */}
      {rows.length > 0 && (
        <div className="overflow-auto max-h-80 border rounded-lg">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 border-b text-gray-600">
              <tr>
                <th className="px-2 py-1 text-left">Symbol</th>
                <th className="px-2 py-1 text-right">Sug.%</th>
                <th className="px-2 py-1 text-right">Act.%</th>
                <th className="px-2 py-1 text-right">Δ</th>
                <th className="px-2 py-1 text-center">Severity</th>
                <th className="px-2 py-1 text-right">Score</th>
                <th className="px-2 py-1 text-center">Rebalance?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sug = r.suggested_weight ?? 0;
                const act = r.actual_weight ?? 0;
                const delta = r.weight_delta ?? act - sug;

                return (
                  <tr key={r.symbol} className="border-b last:border-0">
                    <td className="px-2 py-1">{r.symbol}</td>
                    <td className="px-2 py-1 text-right">
                      {(sug * 100).toFixed(2)}%
                    </td>
                    <td className="px-2 py-1 text-right">
                      {(act * 100).toFixed(2)}%
                    </td>
                    <td className="px-2 py-1 text-right">
                      {(delta * 100).toFixed(2)}%
                    </td>
                    <td className="px-2 py-1 text-center font-medium">
                      {r.severity_level === "green" && (
                        <span className="text-emerald-600">Green</span>
                      )}
                      {r.severity_level === "yellow" && (
                        <span className="text-amber-600">Yellow</span>
                      )}
                      {r.severity_level === "red" && (
                        <span className="text-rose-600">Red</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {r.alignment_score.toFixed(2)}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {r.need_rebalance ? (
                        <span className="text-rose-600 font-semibold">YES</span>
                      ) : (
                        <span className="text-gray-400">no</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!rows.length && !loading && (
        <p className="text-sm text-gray-500 mt-3">
          No Moo data loaded. Enter a session UUID.
        </p>
      )}
    </div>
  );
};
