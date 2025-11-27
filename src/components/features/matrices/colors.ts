export const COLOR_POSITIVE_SHADES = [
  "#eef47a",
  "#c9ef52",
  "#97df3b",
  "#61c433",
  "#35a028",
  "#1e7a22",
  "#11551b",
  "#053116",
];

export const COLOR_NEGATIVE_SHADES = [
  "#ffb7a7",
  "#ff8f79",
  "#ff664f",
  "#f83d35",
  "#d3202b",
  "#a91825",
  "#7a1420",
  "#4a0d16",
];

export const COLOR_MOO_POSITIVE_SHADES = [
  "#c5dcff",
  "#9fcbff",
  "#6eaeff",
  "#3c8eff",
  "#1f6fe0",
  "#1553b4",
  "#0c377c",
  "#062047",
];

export const COLOR_MOO_NEGATIVE_SHADES = [
  "#ffd7b0",
  "#ffb57c",
  "#ff8f4c",
  "#ff6626",
  "#f2470c",
  "#c93608",
  "#992405",
  "#661703",
];

export const COLOR_AMBER = "#f7b733";
export const COLOR_MUTED = "rgba(148, 163, 184, 0.28)";
export const COLOR_FROZEN = "#a855f7";

export const NULL_SENSITIVITY = 1e-8;

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
