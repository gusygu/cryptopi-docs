// src/core/features/str-aux/panel.ts
import type { Panel, PanelCell } from "./schema";
import type { SnapshotWithRefs } from "@/core/features/str-aux/frame/analytics";

export function buildPanelWithStreams(payload: SnapshotWithRefs, includeInnerMatrices = false): Panel {
  const { snapshot, frames, ref } = payload;

  const rows: PanelCell[] = [];
  rows.push({ key: "cycleTs",    value: snapshot.tick.cycleTs });
  rows.push({ key: "cycleStart", value: frames.cycleStart });
  rows.push({ key: "cycleEnd",   value: frames.cycleEnd });
  if (frames.windowStart != null) rows.push({ key: "windowStart", value: frames.windowStart });
  if (frames.windowEnd   != null) rows.push({ key: "windowEnd",   value: frames.windowEnd });
  if (ref?.ts != null)            rows.push({ key: "referenceTs", value: ref.ts });

  const avg = (xs: Array<number | null | undefined>) => {
    const v = xs.filter((x): x is number => Number.isFinite(Number(x)));
    return v.length ? v.reduce((a, b) => a + Number(b), 0) / v.length : null;
  };
  rows.push({ key: "nPoints",       value: snapshot.points.length });
  rows.push({ key: "avgSpreadBps",  value: avg(snapshot.points.map(p => p.spreadBps)) });
  rows.push({ key: "avgLiqScore",   value: avg(snapshot.points.map(p => p.liqScore)) });

  for (const p of snapshot.points) {
    const pair = p.symbol;
    const rp   = ref?.points?.[pair];
    const d = (a?: number|null, b?: number|null) =>
      (a != null && b != null) ? a - b : null;

    rows.push({ key: `${pair}::mid`,     value: p.mid,        hint: ref ? `Δ ${fmt(d(p.mid, rp?.mid))}` : undefined });
    rows.push({ key: `${pair}::spr_bps`, value: p.spreadBps,  hint: ref ? `Δ ${fmt(d(p.spreadBps, rp?.spreadBps))}` : undefined });
    rows.push({ key: `${pair}::imb01`,   value: p.topImbalance, hint: ref ? `Δ ${fmt(d(p.topImbalance, rp?.topImbalance))}` : undefined });
    rows.push({ key: `${pair}::liq`,     value: p.liqScore,   hint: ref ? `Δ ${fmt(d(p.liqScore, rp?.liqScore))}` : undefined });
  }
  return { rows };
}

function fmt(x: number | null): string {
  if (x == null || !Number.isFinite(Number(x))) return "—";
  return `${Number(x).toFixed(6)}`;
}

