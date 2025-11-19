// src/core/features/moo-aux/tiers.ts

/** ---------- legacy MEA bins (id_pct → weight) ---------- */
export type TierRule = {
  minAbs: number;                // inclusive
  maxAbs: number | null;         // inclusive when number; null => +∞
  weight: number;                // unsigned bin weight
  name: string;                  // "Alpha" | ...
  key: "alpha"|"beta"|"gamma"|"delta"|"epsilon";
};

// default bins (tune freely)
export const DEFAULT_TIER_RULES: TierRule[] = [
  { key: "alpha",   name: "Alpha",   minAbs: 0.00016, maxAbs: 0.00032, weight: 0.15 },
  { key: "beta",    name: "Beta",    minAbs: 0.00033, maxAbs: 0.00045, weight: 0.55 },
  { key: "gamma",   name: "Gamma",   minAbs: 0.00046, maxAbs: 0.00076, weight: 1.15 },
  { key: "delta",   name: "Delta",   minAbs: 0.00077, maxAbs: 0.00120, weight: 0.65 },
  { key: "epsilon", name: "Epsilon", minAbs: 0.00121, maxAbs: null,     weight: 0.50 },
];

export function getTierWeighting(id_pct: number, rules: TierRule[] = DEFAULT_TIER_RULES): number {
  const a = Math.abs(Number(id_pct || 0));
  const r = rules.find(r => a >= r.minAbs && (r.maxAbs == null || a <= r.maxAbs));
  return r ? r.weight : 0;
}

/** ---------- mood classes (engine-aligned) ---------- */

export type Mn = "inj"|"drn"|"trl"|"rev"|"wnd"|"emg"|"std"|"stb"|"flo";
export type MetricKey =
  | "GFMdelta" | "vSwap" | "vTendency"
  | "Volt" | "Inertia" | "Disruption" | "Amp" | "MEA";

/**
 * Base per-mood weights (mirror of engine presets).
 * These are normalized inside the engines at runtime; keep relative shape here.
 */
export const MOOD_CLASS_WEIGHTS: Record<Mn, Partial<Record<MetricKey, number>>> = {
  std:{ vTendency:0.28, vSwap:0.22, Volt:0.16, Inertia:0.14, Amp:0.10, Disruption:0.10 },
  trl:{ vTendency:0.40, vSwap:0.25, Inertia:0.18, Volt:0.07, Amp:0.05, Disruption:0.05 },
  rev:{ vSwap:0.34, Disruption:0.20, Amp:0.16, vTendency:0.16, Volt:0.08, Inertia:0.06 },
  inj:{ GFMdelta:0.38, vSwap:0.22, Volt:0.18, Disruption:0.12, Inertia:0.05, Amp:0.05 },
  drn:{ GFMdelta:0.36, Volt:0.22, vSwap:0.16, Disruption:0.12, Inertia:0.08, Amp:0.06 },
  wnd:{ Inertia:0.36, Volt:0.18, Amp:0.10, vSwap:0.12, vTendency:0.14, Disruption:0.10 },
  emg:{ Disruption:0.30, Volt:0.26, vSwap:0.20, vTendency:0.12, Amp:0.07, Inertia:0.05 },
  stb:{ Inertia:0.44, vTendency:0.18, vSwap:0.16, Volt:0.08, Amp:0.06, Disruption:0.08 },
  flo:{ Amp:0.30, vSwap:0.28, Volt:0.16, vTendency:0.12, Disruption:0.08, Inertia:0.06 },
};

/**
 * Optional: per-mood “interval lines” you want to display in UI or use for rank guidance.
 * For now we reuse the id_pct DEFAULT_TIER_RULES as the reference line.
 */
export type MoodClassRow = {
  mn: Mn;
  weights: Partial<Record<MetricKey, number>>;
  intervals: TierRule[];          // reference bands attached to this mood row
};

export const MOOD_CLASS_ROWS: MoodClassRow[] = (Object.keys(MOOD_CLASS_WEIGHTS) as Mn[]).map(mn => ({
  mn,
  weights: MOOD_CLASS_WEIGHTS[mn],
  intervals: DEFAULT_TIER_RULES,
}));

