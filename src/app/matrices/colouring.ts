import type { MatrixCell } from "@/components/features/matrices/Matrix";
import {
  COLOR_AMBER,
  COLOR_FROZEN,
  COLOR_MUTED,
  COLOR_NEGATIVE_SHADES,
  COLOR_POSITIVE_SHADES,
  FROZEN_STAGE_COLORS,
  type FrozenStage,
  withAlpha,
} from "@/components/features/matrices/colors";
import { getPreviewSymbols, type PreviewSource } from "@/lib/preview";

export type RingStrategy = "preview" | "sign-flip" | "none";

export type MatrixColorRules = {
  key: string;
  thresholds: readonly number[];
  positivePalette?: readonly string[];
  negativePalette?: readonly string[];
  zeroFloor: number;
  derive: (value: number | null) => number | null;
  ringStrategy: RingStrategy;
};

export type CellPresentation = {
  background: string;
  polarity: MatrixCell["polarity"];
  textColor?: string;
  ringColor: string | null;
  derived: number | null;
  signFlip: "plusToMinus" | "minusToPlus" | null;
  frozenStage: FrozenStage | null;
};

export const POSITIVE_SHADES = COLOR_POSITIVE_SHADES;
export const NEGATIVE_SHADES = COLOR_NEGATIVE_SHADES;

export const ZERO_BACKGROUND = withAlpha(COLOR_AMBER, 0.32);
export const MUTED_BACKGROUND = withAlpha(COLOR_MUTED, 0.28);
export const FROZEN_STAGE_BACKGROUNDS: Record<FrozenStage, string> = {
  recent: withAlpha(FROZEN_STAGE_COLORS.recent, 0.42),
  mid: withAlpha(FROZEN_STAGE_COLORS.mid, 0.5),
  long: withAlpha(FROZEN_STAGE_COLORS.long, 0.62),
};

export const PREVIEW_RING_COLORS = {
  direct: "#34d399",
  inverse: "#f87171",
  missing: "#94a3b8",
  frozen: COLOR_FROZEN,
} as const;

export const FROZEN_RING_COLORS: Record<FrozenStage, string> = {
  recent: FROZEN_STAGE_COLORS.recent,
  mid: FROZEN_STAGE_COLORS.mid,
  long: FROZEN_STAGE_COLORS.long,
};

export const SIGN_FLIP_RING_COLORS = {
  minusToPlus: "#38bdf8",
  plusToMinus: "#fb923c",
} as const;

type SymbolSets = {
  preview: Set<string>;
  payload?: Set<string>;
};

const makeSet = (values: Iterable<string>): Set<string> => {
  const out = new Set<string>();
  for (const value of values) {
    out.add(String(value ?? "").toUpperCase());
  }
  return out;
};

const hasSymbol = (set: Set<string> | undefined, symbol: string): boolean => {
  if (!set) return false;
  return set.has(String(symbol ?? "").toUpperCase());
};

const clampPaletteIndex = (idx: number, palette: readonly string[]): number => {
  if (!palette.length) return 0;
  if (idx < 0) return palette.length - 1;
  if (idx >= palette.length) return palette.length - 1;
  return idx;
};

function resolveBaseRingColor({
  frozen,
  frozenStage,
  ringStrategy,
  directSymbol,
  inverseSymbol,
  symbolSets,
}: {
  frozen: boolean;
  frozenStage: FrozenStage | null;
  ringStrategy: RingStrategy;
  directSymbol: string;
  inverseSymbol: string;
  symbolSets: SymbolSets;
}): string | null {
  if (frozen) {
    if (frozenStage) return FROZEN_STAGE_COLORS[frozenStage];
    return PREVIEW_RING_COLORS.frozen;
  }
  if (ringStrategy === "none") return null;

  const hasDirect = hasSymbol(symbolSets.preview, directSymbol) || hasSymbol(symbolSets.payload, directSymbol);
  if (hasDirect) return PREVIEW_RING_COLORS.direct;

  const hasInverse = hasSymbol(symbolSets.preview, inverseSymbol) || hasSymbol(symbolSets.payload, inverseSymbol);
  if (hasInverse) return PREVIEW_RING_COLORS.inverse;

  return PREVIEW_RING_COLORS.missing;
}

function detectSignFlip({
  ringStrategy,
  frozen,
  current,
  previous,
}: {
  ringStrategy: RingStrategy;
  frozen: boolean;
  current: number | null;
  previous: number | null;
}): "plusToMinus" | "minusToPlus" | null {
  if (ringStrategy !== "sign-flip" || frozen) return null;
  if (current == null || previous == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;

  const prevSign = Math.sign(previous);
  const currSign = Math.sign(current);
  if (prevSign > 0 && currSign < 0) return "plusToMinus";
  if (prevSign < 0 && currSign > 0) return "minusToPlus";
  return null;
}

export function resolveCellPresentation({
  rules,
  value,
  prevValue,
  frozen,
  frozenStage = null,
  directSymbol,
  inverseSymbol,
  symbolSets,
}: {
  rules: MatrixColorRules;
  value: number | null;
  prevValue?: number | null;
  frozen: boolean;
  frozenStage?: FrozenStage | null;
  directSymbol: string;
  inverseSymbol: string;
  symbolSets: SymbolSets;
}): CellPresentation {
  const palettePositive = rules.positivePalette ?? POSITIVE_SHADES;
  const paletteNegative = rules.negativePalette ?? NEGATIVE_SHADES;
  const derived = rules.derive(value);
  const previousDerived = prevValue === undefined ? null : rules.derive(prevValue ?? null);

  let polarity: MatrixCell["polarity"] = "neutral";
  let background = MUTED_BACKGROUND;
  let textColor: string | undefined;

  const effectiveStage: FrozenStage | null = frozenStage ?? (frozen ? "mid" : null);

  if (frozen || effectiveStage) {
    const stage = effectiveStage ?? "mid";
    background = FROZEN_STAGE_BACKGROUNDS[stage];
    textColor = stage === "long" ? "#ede9fe" : "#20103f";
  } else if (derived != null && Number.isFinite(derived)) {
    const abs = Math.abs(derived);
    if (abs < rules.zeroFloor) {
      background = ZERO_BACKGROUND;
      textColor = "#422006";
    } else {
      const idx = rules.thresholds.findIndex((t) => abs < t);
      const palette = derived >= 0 ? palettePositive : paletteNegative;
      const paletteIndex = clampPaletteIndex(idx === -1 ? palette.length - 1 : idx, palette);
      const hex = palette[paletteIndex] ?? palette[palette.length - 1] ?? "#0f172a";
      background = withAlpha(hex, 0.85);
      polarity = derived >= 0 ? "positive" : "negative";
    }
  } else {
    background = MUTED_BACKGROUND;
  }

  const ringColor = resolveBaseRingColor({
    frozen,
    frozenStage: effectiveStage,
    ringStrategy: rules.ringStrategy,
    directSymbol,
    inverseSymbol,
    symbolSets,
  });

  const signFlip = detectSignFlip({
    ringStrategy: rules.ringStrategy,
    frozen,
    current: derived,
    previous: previousDerived,
  });

  let finalRing = ringColor;
  if (signFlip === "plusToMinus") {
    finalRing = SIGN_FLIP_RING_COLORS.plusToMinus;
  } else if (signFlip === "minusToPlus") {
    finalRing = SIGN_FLIP_RING_COLORS.minusToPlus;
  }

  return {
    background,
    polarity,
    textColor,
    ringColor: finalRing,
    derived,
    signFlip,
    frozenStage: effectiveStage,
  };
}

export async function loadPreviewSymbolSet(
  coins: string[]
): Promise<{ symbols: string[]; set: Set<string>; source: PreviewSource }> {
  const normalized = coins.map((coin) => String(coin ?? "").toUpperCase());
  const { symbols, source } = await getPreviewSymbols(normalized);
  const normalizedSymbols = symbols.map((sym) => String(sym ?? "").toUpperCase());
  return {
    symbols: normalizedSymbols,
    set: makeSet(normalizedSymbols),
    source,
  };
}
