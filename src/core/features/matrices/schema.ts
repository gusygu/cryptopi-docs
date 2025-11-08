// src/core/features/matrices/schema.ts
// Updated types describe the table rows rendered on /matrices.

export type MatrixRow = {
  symbol: string;
  benchPct: number | null;
  pctDrv: number | null;
  pct24h: number | null;
  pct_ref: number | null;
  ref: number | null;
  id_pct: number | null;
  isShift?: boolean;
  base: string;
  quote: string;
  benchmark?: number | null;
  delta?: number | null;
  pct_drv?: number | null;
  frozen?: boolean;
  bridged?: boolean;
};  

export const MATRICES_COLUMNS: Array<{
  key: keyof MatrixRow;
  label: string;
  align?: 'left' | 'right' | 'center';
  fmt?: (v: any) => string;
}> = [
  { key: 'symbol', label: 'Pair', align: 'left' },
  { key: 'benchPct', label: 'Bench %', align: 'right', fmt: (v) => fmtPct(v) },
  { key: 'pctDrv', label: 'Drv %', align: 'right', fmt: (v) => fmtPct(v) },
  { key: 'pct24h', label: '24h %', align: 'right', fmt: (v) => fmtPct(v) },
  { key: 'pct_ref', label: 'Ref %', align: 'right', fmt: (v) => fmtPct(v) },
  { key: 'ref', label: 'Ref', align: 'right', fmt: (v) => fmtNum(v) },
  { key: 'id_pct', label: 'ID %', align: 'right', fmt: (v) => fmtPct(v) },
];

export const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : `${(v * 100).toFixed(2)}%`;

export const fmtNum = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : `${Number(v).toLocaleString()}`;
