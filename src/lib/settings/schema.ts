// src/lib/settings/schema.ts
export type Cluster = { id: string; name: string; coins: string[] };

export type AppSettings = {
  version: number;
  coinUniverse: string[];
  profile: { nickname: string; email: string; binanceKeyId: string };
  stats: { histogramLen: number; bmDecimals: number; idPctDecimals: number };
  timing: {
    autoRefresh: boolean;           // <-- required flag
    autoRefreshMs: number;
    secondaryEnabled: boolean;
    secondaryCycles: number;        // 1..10
    strCycles: { m30: number; h1: number; h3: number };
  };
  clustering: {
    clusters: Cluster[];
  };
  params: { values: Record<string, number> };
};

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  coinUniverse: [],
  profile: { nickname: "", email: "", binanceKeyId: "" },
  stats: { histogramLen: 64, bmDecimals: 4, idPctDecimals: 6 },
  timing: {
    autoRefresh: true,
    autoRefreshMs: 40_000,
    secondaryEnabled: true,
    secondaryCycles: 3,
    strCycles: { m30: 45, h1: 90, h3: 270 },
  },
  clustering: { clusters: [{ id: "cl-1", name: "Cluster 1", coins: [] }] },
  params: { values: { eta: 0.02, epsilon: 0.2, iota: 0.5 } },
  
};

// ---------- internal helpers ----------
const toUpperArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const upper = String(entry ?? "").trim().toUpperCase();
    if (!upper || seen.has(upper)) continue;
    seen.add(upper);
    result.push(upper);
  }
  if (!seen.has("USDT")) result.push("USDT");
  return result;
};

const toNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toClusterArray = (value: unknown): Cluster[] => {
  if (!Array.isArray(value)) return DEFAULT_SETTINGS.clustering.clusters;
  return value.map((entry, index) => {
    const obj = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
    return {
      id: String(obj.id ?? `cl-${index + 1}`),
      name: String(obj.name ?? `Cluster ${index + 1}`),
      coins: toUpperArray(obj.coins),
    };
  });
};

const toParams = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS.params.values };
  const result: Record<string, number> = { ...DEFAULT_SETTINGS.params.values };
  for (const [key, raw] of Object.entries(value)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) result[key] = parsed;
  }
  return result;
};

// ---------- public migration (existing) ----------
export function migrateSettings(input: unknown): AppSettings {
  const s = (input && typeof input === "object") ? (input as Record<string, unknown>) : {};

  const statsSource = (s.stats && typeof s.stats === "object") ? s.stats as Record<string, unknown> : {};
  const timingSource = (s.timing && typeof s.timing === "object") ? s.timing as Record<string, unknown> : {};
  const timingCycles = (timingSource.strCycles && typeof timingSource.strCycles === "object")
    ? timingSource.strCycles as Record<string, unknown>
    : {};

  const out: AppSettings = {
    version: SETTINGS_VERSION,
    coinUniverse: toUpperArray(s.coinUniverse),
    profile: {
      nickname: String((s.profile as Record<string, unknown> | undefined)?.nickname ?? ""),
      email: String((s.profile as Record<string, unknown> | undefined)?.email ?? ""),
      binanceKeyId: String((s.profile as Record<string, unknown> | undefined)?.binanceKeyId ?? ""),
    },
    stats: {
      histogramLen: Math.max(16, toNumber(statsSource.histogramLen, DEFAULT_SETTINGS.stats.histogramLen)),
      bmDecimals: clamp(toNumber(statsSource.bmDecimals, DEFAULT_SETTINGS.stats.bmDecimals), 0, 6),
      idPctDecimals: clamp(toNumber(statsSource.idPctDecimals, DEFAULT_SETTINGS.stats.idPctDecimals), 0, 8),
    },
    timing: {
      autoRefresh: Boolean(timingSource.autoRefresh ?? DEFAULT_SETTINGS.timing.autoRefresh),
      autoRefreshMs: Math.max(500, toNumber(timingSource.autoRefreshMs, DEFAULT_SETTINGS.timing.autoRefreshMs)),
      secondaryEnabled: Boolean(timingSource.secondaryEnabled ?? DEFAULT_SETTINGS.timing.secondaryEnabled),
      secondaryCycles: clamp(toNumber(timingSource.secondaryCycles, DEFAULT_SETTINGS.timing.secondaryCycles), 1, 10),
      strCycles: {
        m30: Math.max(1, toNumber(timingCycles.m30, DEFAULT_SETTINGS.timing.strCycles.m30)),
        h1: Math.max(1, toNumber(timingCycles.h1, DEFAULT_SETTINGS.timing.strCycles.h1)),
        h3: Math.max(1, toNumber(timingCycles.h3, DEFAULT_SETTINGS.timing.strCycles.h3)),
      },
    },
    clustering: { clusters: toClusterArray((s.clustering as Record<string, unknown> | undefined)?.clusters) },
    params: { values: toParams((s.params as Record<string, unknown> | undefined)?.values) },
  };

  if (out.coinUniverse.length === 0) {
    out.coinUniverse = [...DEFAULT_SETTINGS.coinUniverse];
  }

  return out;
}

// ---------- NEW: public, ergonomic helpers ----------
/** Deep partial type for ergonomic patching/creation. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Normalize coins from a string (comma/space-separated) or array; ensures USDT present and uppercase+deduped. */
export function normalizeCoinUniverse(input: string | string[] | unknown): string[] {
  if (Array.isArray(input)) return toUpperArray(input);
  if (typeof input === "string") {
    const parts = input.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    return toUpperArray(parts);
  }
  return toUpperArray([]);
}

/** Type guard to check if an object already looks like an AppSettings after migration. */
export function isAppSettings(x: unknown): x is AppSettings {
  return !!x && typeof x === "object" && "version" in (x as any) && "coinUniverse" in (x as any);
}

/**
 * Factory — create a normalized AppSettings object.
 * - If you pass nothing, you get migrated DEFAULT_SETTINGS.
 * - If you pass a deep-partial or any unknown, it is migrated safely.
 */
export function AppSettings(input?: DeepPartial<AppSettings> | unknown): AppSettings {
  return migrateSettings(input ?? DEFAULT_SETTINGS);
}

/** Merge a base AppSettings with a deep-partial patch, then normalize. */
export function mergeAppSettings(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  // shallow-merge at top level; nested objects are re-validated by migrateSettings
  return migrateSettings({ ...base, ...patch });
}
