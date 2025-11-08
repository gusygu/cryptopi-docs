// src/core/features/matrices/matricesLatest.ts
import { getLatestTsForType, getSnapshotByType, getPrevSnapshotByType } from "@/core/db/db";
import type { MatrixType } from "@/core/pipelines/types";

const TYPES: MatrixType[] = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"];

const EPS_ABS = Number(process.env.SIGN_EPS_ABS ?? 1e-9);
const EPS_REL = Number(process.env.SIGN_EPS_REL ?? 1e-3);

const keyFor = (base: string, quote: string) => `${base.toUpperCase()}_${quote.toUpperCase()}`;

const signWithTolerance = (value: number, reference: number) => {
  const eps = Math.max(EPS_ABS, EPS_REL * Math.max(Math.abs(value), Math.abs(reference)));
  if (value > eps) return 1;
  if (value < -eps) return -1;
  return 0;
};

export type MatrixFlags = {
  frozen: boolean[][];
  preview?: number[][];
  flip?: (-1 | 0 | 1)[][];
};

export type MatrixEntry = {
  grid: (number | null)[][];
  flags?: MatrixFlags;
  ts: number | null;
  prevTs?: number | null;
};

export type MatricesLatestPayload = {
  ok: true;
  coins: string[];
  ts: Record<string, number | null>;
  prevTs: Record<string, number | null>;
  matrices: Record<string, MatrixEntry | null>;
  flags: Record<string, MatrixFlags | null>;
};

export type BuildLatestPayloadOptions = {
  coins: string[];
  previewSymbols?: Set<string>;
};

export async function buildLatestPayload(options: BuildLatestPayloadOptions): Promise<MatricesLatestPayload> {
  const coins = Array.from(new Set((options.coins ?? []).map((c) => c.toUpperCase()).filter(Boolean)));
  const n = coins.length;

  const tsRecord: Record<string, number | null> = {
    benchmark: null,
    delta: null,
    pct24h: null,
    id_pct: null,
    pct_drv: null,
    ref: null,
    pct_ref: null,
  };
  const prevTsRecord: Record<string, number | null> = { ...tsRecord };

  const currentMaps: Record<MatrixType, Map<string, number>> = {
    benchmark: new Map(),
    delta: new Map(),
    pct24h: new Map(),
    id_pct: new Map(),
    pct_drv: new Map(),
  };
  const previousMaps: Record<MatrixType, Map<string, number>> = {
    benchmark: new Map(),
    delta: new Map(),
    pct24h: new Map(),
    id_pct: new Map(),
    pct_drv: new Map(),
  };

  for (const type of TYPES) {
    const latestTs = await getLatestTsForType(type);
    tsRecord[type] = latestTs == null ? null : Number(latestTs);
    if (!latestTs) continue;

    const snapshot = await getSnapshotByType(type, Number(latestTs), coins);
    const previous = await getPrevSnapshotByType(type, Number(latestTs), coins);

    const targetCurrent = currentMaps[type];
    snapshot.forEach((row) => {
      targetCurrent.set(keyFor(row.base, row.quote), Number(row.value));
    });

    const targetPrev = previousMaps[type];
    previous.forEach((row) => {
      targetPrev.set(keyFor(row.base, row.quote), Number(row.value));
    });
  }

  const matrices: Record<string, MatrixEntry | null> = {
    benchmark: null,
    delta: null,
    pct24h: null,
    id_pct: null,
    pct_drv: null,
    ref: null,
    pct_ref: null,
  };
  const flags: Record<string, MatrixFlags | null> = {
    benchmark: null,
    delta: null,
    pct24h: null,
    id_pct: null,
    pct_drv: null,
    ref: null,
    pct_ref: null,
  };

  const makeEmptyGrid = () => Array.from({ length: n }, () => Array(n).fill(null as number | null));
  const makeBooleanGrid = () => Array.from({ length: n }, () => Array(n).fill(false));
  const makePreviewGrid = () => Array.from({ length: n }, () => Array(n).fill(0));
  const makeFlipGrid = () => Array.from({ length: n }, () => Array(n).fill(0 as -1 | 0 | 1));

  for (const type of TYPES) {
    const tsValue = tsRecord[type];
    if (!tsValue) {
      matrices[type] = { grid: makeEmptyGrid(), ts: null };
      flags[type] = null;
      continue;
    }

    const grid = makeEmptyGrid();
    const frozen = makeBooleanGrid();
    const preview = options.previewSymbols ? makePreviewGrid() : undefined;
    const flip = type === "pct_drv" ? makeFlipGrid() : undefined;

    const curMap = currentMaps[type];
    const prevMap = previousMaps[type];

    for (let i = 0; i < n; i++) {
      const base = coins[i]!;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const quote = coins[j]!;
        const k = keyFor(base, quote);
        const value = curMap.get(k);
        const prevValue = prevMap.get(k);
        grid[i][j] = Number.isFinite(value!) ? value! : null;
        frozen[i][j] = Number.isFinite(value!) && Number.isFinite(prevValue!) && value === prevValue;

        if (preview && options.previewSymbols) {
          const symbol = `${base}${quote}`;
          preview[i][j] = options.previewSymbols.has(symbol) ? 1 : 0;
        }

        if (flip) {
          const idMap = currentMaps["id_pct"];
          const prevIdMap = previousMaps["id_pct"];
          const now = idMap.get(k);
          const before = prevIdMap.get(k);
          if (Number.isFinite(now!) && Number.isFinite(before!)) {
            const prevSign = signWithTolerance(before!, now!);
            const nextSign = signWithTolerance(now!, before!);
            if (prevSign !== 0 && nextSign !== 0 && prevSign !== nextSign) {
              flip[i][j] = nextSign as -1 | 0 | 1;
            }
          }
        }
      }
    }

    const matrixFlags: MatrixFlags = { frozen };
    if (preview) matrixFlags.preview = preview;
    if (flip) matrixFlags.flip = flip;

    matrices[type] = { grid, flags: matrixFlags, ts: tsValue, prevTs: prevTsRecord[type] };
    flags[type] = matrixFlags;
  }

  // Keep placeholders for ref/pct_ref for compatibility with the UI (currently derived elsewhere).
  return {
    ok: true,
    coins,
    ts: tsRecord,
    prevTs: prevTsRecord,
    matrices,
    flags,
  };
}
