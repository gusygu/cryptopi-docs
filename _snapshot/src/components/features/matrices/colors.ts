export const COLOR_POSITIVE_SHADES = [
  "#bbf7d0",
  "#86efac",
  "#4ade80",
  "#22c55e",
  "#16a34a",
  "#15803d",
  "#166534",
  "#14532d",
];

export const COLOR_NEGATIVE_SHADES = [
  "#fecaca",
  "#fca5a5",
  "#f87171",
  "#ef4444",
  "#dc2626",
  "#b91c1c",
  "#991b1b",
  "#7f1d1d",
];

export const COLOR_AMBER = "#facc15";
export const COLOR_MUTED = "rgba(148, 163, 184, 0.28)";
export const COLOR_FROZEN = "#a855f7";

export type FrozenStage = "recent" | "mid" | "long";

export const FROZEN_STAGE_COLORS: Record<FrozenStage, string> = {
  recent: "#d8b4fe",
  mid: COLOR_FROZEN,
  long: "#6d28d9",
};

const MAG_THRESHOLDS = [0.0005, 0.0015, 0.003, 0.006, 0.0125, 0.025, 0.05];

export function colorForChange(
  value: number | null | undefined,
  opts: { frozen?: boolean; frozenStage?: FrozenStage | null; zeroFloor?: number } = {}
): string {
  const { frozen = false, frozenStage = null, zeroFloor = MAG_THRESHOLDS[0] } = opts;
  if (frozenStage) return FROZEN_STAGE_COLORS[frozenStage];
  if (frozen) return COLOR_FROZEN;
  if (value == null || !Number.isFinite(value)) return COLOR_MUTED;
  const abs = Math.abs(value);
  if (abs < zeroFloor) return COLOR_AMBER;
  let idx = MAG_THRESHOLDS.findIndex((t) => abs < t);
  if (idx < 0) idx = COLOR_POSITIVE_SHADES.length - 1;
  return value >= 0 ? COLOR_POSITIVE_SHADES[idx] : COLOR_NEGATIVE_SHADES[idx];
}

export function withAlpha(color: string, alpha: number): string {
  if (!color) return `rgba(15, 23, 42, ${alpha})`;
  if (color.startsWith("rgba")) {
    return color.replace(/rgba\(([^)]+)\)/, (_match, inner) => {
      const parts = inner.split(",").map((part) => part.trim());
      const [r, g, b] = parts;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    });
  }
  if (color.startsWith("rgb")) {
    return color.replace(/rgb\(([^)]+)\)/, (_match, inner) => `rgba(${inner}, ${alpha})`);
  }
  if (!color.startsWith("#")) return color;
  const hex = color.slice(1);
  const normalized = hex.length === 3 ? hex.split("").map((h) => h + h).join("") : hex;
  const int = parseInt(normalized, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
