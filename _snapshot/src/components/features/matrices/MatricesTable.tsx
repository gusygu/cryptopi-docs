import React from "react";

type Ring = "green" | "red" | "grey" | "purple";
type Cell = { value: number | null; color: string; derivation?: "direct" | "inverse" | "bridged"; ring?: Ring; };
type DualRow = { top: Cell; bottom: Cell };

export type MatrixRow = {
  pair: string;
  base: string;
  quote: string;
  derivation: "direct" | "inverse" | "bridged";
  ring: Ring;               // pair-level ring (cell)
  symbolRing: Ring;         // symbol availability ring
  symbolFrozen: boolean;    // frozen symbol flag
  benchmark_pct24h: DualRow; // top=benchmark, bottom=24h% (color only)
  ref_block: DualRow;        // top=pct_ref, bottom=ref
  delta: Cell;
  id_pct: Cell;
  pct_drv: Cell;
  meta: { frozen: boolean };
};

type Props = {
  rows: MatrixRow[];
  /** Optionally pass raw 24h% values from API to display as number (color still from rows). */
  pct24hValues?: Record<string, Record<string, number | null>>;
};

const ringClass = (r: Ring) =>
  r === "green" ? "ring ring-green"
: r === "red"   ? "ring ring-red"
: r === "purple"? "ring ring-purple"
:                 "ring ring-grey";

const fmtPct = (v: number | null) => (v == null || !Number.isFinite(v)) ? "—" : `${(v * 100).toFixed(2)}%`;
const fmtNum = (v: number | null, digits = 6) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v.toFixed(digits);
  return s.replace(/(\.\d*?[1-9])0+$/,"$1").replace(/\.$/,"");
};

export const MatricesTable: React.FC<Props> = ({ rows, pct24hValues }) => {
  return (
    <div className="overflow-auto rounded-2xl border cp-border bg-black/10">
      <table className="min-w-full border-separate border-spacing-y-1 text-sm">
        <thead className="text-xs uppercase tracking-wide text-[var(--cp-silver-2)]/80">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Pair</th>
            <th className="px-3 py-2 text-left font-semibold">Benchmark</th>
            <th className="px-3 py-2 text-left font-semibold">24h %</th>
            <th className="px-3 py-2 text-left font-semibold">pct_ref</th>
            <th className="px-3 py-2 text-left font-semibold">ref</th>
            <th className="px-3 py-2 text-left font-semibold">id_pct</th>
            <th className="px-3 py-2 text-left font-semibold">pct_drv</th>
            <th className="px-3 py-2 text-left font-semibold">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p24v =
              pct24hValues?.[r.base]?.[r.quote] ??
              r.benchmark_pct24h.bottom.value ?? null;

            return (
              <tr key={r.pair} className="rounded-xl transition">
                {/* Pair / symbol ring */}
                <td className="px-3 py-2 text-left">
                  <div className="flex items-center gap-2">
                    <div className={`sym ${ringClass(r.symbolRing)}`}>
                      <span>{r.base}</span>
                    </div>
                    <div className="text-xs text-[var(--cp-silver-2)]">{r.pair}</div>
                  </div>
                </td>

                {/* Benchmark */}
                <td className="px-3 py-2 font-mono tabular-nums text-[13px]">
                  <div className="cell" style={{ background: r.benchmark_pct24h.top.color }}>
                    {fmtNum(r.benchmark_pct24h.top.value)}
                  </div>
                </td>

                {/* 24h% (value from API if provided; color from rows) */}
                <td className="px-3 py-2 font-mono tabular-nums text-[13px]">
                  <div className="cell" style={{ background: r.benchmark_pct24h.bottom.color }}>
                    {fmtPct(p24v)}
                  </div>
                </td>

                {/* pct_ref */}
                <td className="px-3 py-2 font-mono tabular-nums text-[13px]">
                  <div className="cell" style={{ background: r.ref_block.top.color }}>
                    {fmtPct(r.ref_block.top.value)}
                  </div>
                </td>

                {/* ref */}
                <td className="px-3 py-2 font-mono tabular-nums text-[13px]">
                  <div className="cell" style={{ background: r.ref_block.bottom.color }}>
                    {fmtPct(r.ref_block.bottom.value)}
                  </div>
                </td>

                {/* id_pct */}
                <td className="px-3 py-2 font-mono tabular-nums text-[13px]">
                  <div className="cell" style={{ background: r.id_pct.color }}>
                    {fmtPct(r.id_pct.value)}
                  </div>
                </td>

                {/* pct_drv */}
                <td className="px-3 py-2 font-mono tabular-nums text-[13px]">
                  <div className="cell" style={{ background: r.pct_drv.color }}>
                    {fmtPct(r.pct_drv.value)}
                  </div>
                </td>

                {/* delta */}
                <td className="px-3 py-2 font-mono tabular-nums text-[13px]">
                  <div className="cell" style={{ background: r.delta.color }}>
                    {fmtNum(r.delta.value)}
                  </div>
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={8} className="px-3 py-4 text-center text-xs text-[var(--cp-silver-2)]/80">
                No matrix rows yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* component-scoped styles */}
      <style jsx>{`
        .cell {
          width: 100%;
          padding: 8px 10px;
          border-radius: 6px;
          line-height: 1.2;
          border: 1px solid rgba(0,0,0,0.04);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.4);
        }
        .sym {
          position: relative;
          width: 56px; height: 32px;
          border-radius: 16px;
          background: #0b0b0b;
          display:flex; align-items:center; justify-content:center;
          font-weight: 700;
          color:#e0e0e0;
        }
        .ring::before {
          content: "";
          position: absolute;
          inset: -3px;
          border-radius: 18px;
          border: 3px solid transparent;
        }
        .ring-green::before { border-color: #4caf50; }
        .ring-red::before   { border-color: #f44336; }
        .ring-grey::before  { border-color: #90a4ae; }
        .ring-purple::before{ border-color: #7e57c2; }
      `}</style>
    </div>
  );
};
