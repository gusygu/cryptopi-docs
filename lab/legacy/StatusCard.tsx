"use client";
import { useEffect, useState } from "react";

type Status = {
  ok: boolean;
  mode?: string;
  coins?: string[];
  poller?: { running: boolean; intervalMs: number; embedded?: boolean };
  latestTs?: Record<string, number | null>;
  counts?: Record<string, number>;
  error?: string;
};

type ReportItem = { key: string; value: unknown };

const tsPill = (ts: number | null | undefined) => {
  if (!ts || !Number.isFinite(ts)) return "-";
  const d = new Date(Number(ts));
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleTimeString();
};

const findItem = (items: ReportItem[], key: string) =>
  items.find((item) => item?.key === key);

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function StatusCard() {
  const [s, setS] = useState<Status | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/vitals", { cache: "no-store" });
      const data = await r.json();
      const items: ReportItem[] = Array.isArray(data?.status?.items)
        ? data.status.items
        : [];
      const pollerItem = findItem(items, "poller:state");
      const pollerState = typeof pollerItem?.value === "string" ? pollerItem.value : String(pollerItem?.value ?? "");
      const ticksetItem = findItem(items, "tickset:size");
      const ticksetSize = toNumber(ticksetItem?.value);
      const warn = data?.status?.summary?.level === "warn" ? data.status.summary.text : undefined;

      setS({
        ok: data?.ok !== false && data?.status?.summary?.level !== "error",
        mode: data?.status?.scope ?? "aux",
        coins: Array.isArray(data?.health?.coins) ? data.health.coins : undefined,
        poller: {
          running: pollerState === "running",
          intervalMs: 0,
          embedded: pollerState === "running",
        },
        counts: data?.health?.counts ?? (ticksetSize ? { tickers: ticksetSize } : undefined),
        latestTs: {
          status: toNumber(data?.status?.ts) || null,
          health: toNumber(data?.health?.ts) || null,
        },
        error: warn,
      });
    } catch (e) {
      setS({ ok: false, error: String(e) });
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  if (!s) return null;

  const coins = s.coins ?? [];
  const lt = s.latestTs ?? {};
  const cnt = s.counts ?? {};

  return (
    <div className="mb-3 rounded-2xl bg-slate-800/60 p-3 text-[12px] text-slate-200 border border-slate-700/30">
      <div className="flex items-center justify-between">
        <div>
          Mode: <b>{s.mode ?? "-"}</b> • Coins: {coins.length ? coins.join(", ") : "-"}
        </div>
        <div>Poller: {s.poller?.running ? "running" : "stopped"}</div>
      </div>
      <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {Object.entries(lt).map(([k, ts]) => (
          <div key={k} className="rounded bg-slate-900/50 px-2 py-1 border border-slate-700/30">
            <div className="text-slate-400">{k}</div>
            <div className="font-mono tracking-tight">
              {tsPill(ts)} • {cnt[k] ?? 0} rows
            </div>
          </div>
        ))}
      </div>
      {s.error ? <div className="mt-2 text-red-300">warning: {s.error}</div> : null}
    </div>
  );
}
