// ESM
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type T24 = { symbol: string; lastPrice?: string; openPrice?: string };
type Dense = Map<string, Map<string, number>>;

const BRIDGES = ["USDT","FDUSD","BTC","ETH","BNB","SOL","XRP","ADA","DOGE","BRL"] as const;

const uniqUpper = (xs: string[]) => {
  const s = new Set(xs.map(x => x.toUpperCase().trim()).filter(Boolean));
  const arr = [...s];
  if (!arr.includes("USDT")) arr.push("USDT");
  return arr;
};

async function fetchAll24h(): Promise<T24[]> {
  const r = await fetch("https://api.binance.com/api/v3/ticker/24hr", { cache: "no-store" });
  if (!r.ok) throw new Error(`binance 24hr ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? (j as T24[]) : [];
}

function buildUsdPricesWithBridges(coins: string[], all: T24[]) {
  const by = new Map(all.map(t => [t.symbol, t]));
  const px = new Map<string, number>();
  px.set("USDT", 1);

  const direct = (c: string): number | null => {
    const d = by.get(`${c}USDT`);
    if (d) { const p = Number(d.lastPrice); if (Number.isFinite(p) && p > 0) return p; }
    const r = by.get(`USDT${c}`);
    if (r) { const p = Number(r.lastPrice); if (Number.isFinite(p) && p > 0) return 1 / p; }
    return null;
  };

  // seed direct
  for (const c of coins) {
    const p = direct(c);
    if (p != null) px.set(c, p);
  }

  // two-hop via bridges
  for (const c of coins) {
    if (px.has(c)) continue;
    for (const b of BRIDGES) {
      if (b === c) continue;

      // COIN per bridge
      let coin_per_b: number | null = null;
      const d1 = by.get(`${c}${b}`);
      if (d1) { const p = Number(d1.lastPrice); if (Number.isFinite(p) && p > 0) coin_per_b = p; }
      const r1 = by.get(`${b}${c}`);
      if (coin_per_b == null && r1) { const p = Number(r1.lastPrice); if (Number.isFinite(p) && p > 0) coin_per_b = 1 / p; }
      if (coin_per_b == null) continue;

      const b_usdt = direct(b);
      if (b_usdt != null) {
        px.set(c, coin_per_b * b_usdt);
        break;
      }
    }
  }

  return px;
}

function makeDense<T=number>(coins: string[], fill: (b: string, q: string) => T): Dense {
  const m = new Map<string, Map<string, T>>();
  for (const b of coins) {
    const row = new Map<string, T>();
    for (const q of coins) { if (b !== q) row.set(q, fill(b, q)); }
    m.set(b, row);
  }
  return m as any;
}

/* ── DB helpers ─────────────────────────────────────────────────────────── */

async function resolveCoins(): Promise<string[]> {
  for (const t of ["settings","app_settings","app_config","config"]) {
    const rc = await pool.query(`select to_regclass($1) is not null as ok`, [`public.${t}`]);
    if (rc.rows?.[0]?.ok) {
      const r = await pool.query(`select coins from public.${t} where (is_active is null or is_active) order by updated_at desc nulls last limit 1`);
      const raw = r.rows?.[0]?.coins;
      const arr = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,\s]+/);
      const norm = uniqUpper(arr.map(String));
      if (norm.length) return norm;
    }
  }
  const env = uniqUpper(String(process.env.COINS || "").split(/[,\s]+/));
  return env.length ? env : ["BTC","ETH","USDT"];
}

async function loadLatestDense(kind: string, coins: string[]): Promise<{ ts: number|null; grid: Dense }> {
  const c = await pool.connect();
  try {
    const r1 = await c.query<{ ts_ms: string | null }>(
      `select max(ts_ms)::bigint as ts_ms from public.dyn_matrix_values where matrix_type=$1`, [kind]
    );
    const ts = r1.rows[0]?.ts_ms ? Number(r1.rows[0].ts_ms) : null;
    const grid: Dense = new Map(); for (const b of coins) grid.set(b, new Map());
    if (ts == null) return { ts: null, grid };
    const r2 = await c.query<{ base: string; quote: string; value: string | number }>(
      `select base, quote, value
         from public.dyn_matrix_values
        where matrix_type=$1 and ts_ms=$2
          and base  = any($3::text[]) and quote = any($3::text[])`,
      [kind, ts, coins]
    );
    for (const row of r2.rows) {
      const b = row.base.toUpperCase(), q = row.quote.toUpperCase();
      if (b === q) continue;
      grid.get(b)!.set(q, Number(row.value));
    }
    return { ts, grid };
  } finally { c.release(); }
}

/* earliest benchmark per pair in current UTC day */
function startOfDayUtc(ts: number) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function loadOpeningPerPair(coins: string[], nowTs: number): Promise<Dense> {
  const sod = startOfDayUtc(nowTs), eod = sod + 86_400_000;
  const c = await pool.connect();
  try {
    const r = await c.query<{ base: string; quote: string; value: number }>(
      `
      with firsts as (
        select base, quote, min(ts_ms) as ts
        from public.dyn_matrix_values
        where matrix_type='benchmark'
          and ts_ms >= $1 and ts_ms < $2
          and base  = any($3::text[]) and quote = any($3::text[])
        group by base, quote
      )
      select v.base, v.quote, v.value::double precision
      from public.dyn_matrix_values v
      join firsts f on f.base=v.base and f.quote=v.quote and f.ts=v.ts_ms
      `,
      [sod, eod, coins]
    );
    const grid: Dense = new Map(); for (const b of coins) grid.set(b, new Map());
    for (const row of r.rows) {
      const b = row.base.toUpperCase(), q = row.quote.toUpperCase();
      if (b === q) continue;
      grid.get(b)!.set(q, Number(row.value));
    }
    return grid;
  } finally { c.release(); }
}

/* insert helper: decimals → 0 if not finite; ratios → NaN if not finite (never NULL) */
function denseToRows(kind: string, ts_ms: number, grid: Dense, decimal = false) {
  const out: { matrix_type: string; base: string; quote: string; ts_ms: number; value: number }[] = [];
  for (const [b, row] of grid) {
    for (const [q, v] of row) {
      if (b === q) continue;
      const val = Number(v);
      if (decimal) out.push({ matrix_type: kind, base: b, quote: q, ts_ms, value: Number.isFinite(val) ? val : 0 });
      else         out.push({ matrix_type: kind, base: b, quote: q, ts_ms, value: Number.isFinite(val) ? val : Number.NaN });
    }
  }
  return out;
}

/* ── main ───────────────────────────────────────────────────────────────── */

async function main() {
  const ts_ms = Date.now();
  const coins = await resolveCoins();

  // live prices (direct + 2-hop bridges)
  const all = await fetchAll24h();
  const pxUSDT = buildUsdPricesWithBridges(coins, all);

  // benchmark (ratio)
  const bm = makeDense(coins, (b, q) => {
    const pb = pxUSDT.get(b), pq = pxUSDT.get(q);
    return (pb != null && pq != null) ? pb / pq : Number.NaN;
  });

  // prev frames
  const prevBm = await loadLatestDense("benchmark", coins);          // for id_pct baseline
  const prevId = await loadLatestDense("id_pct",    coins);          // for pct_drv baseline

  // opening per pair (UTC day)
  const openGrid = await loadOpeningPerPair(coins, ts_ms);

  // pct_ref (decimal): (bm_now - bm_open)/bm_open, bootstrap->0 when open missing
  const pct_ref = makeDense(coins, (b, q) => {
    const v = bm.get(b)?.get(q);
    const o = openGrid.get(b)?.get(q);
    return (Number.isFinite(v as any) && Number.isFinite(o as any) && Number(o) !== 0)
      ? (Number(v) - Number(o)) / Number(o)
      : 0;
  });

  // id_pct (decimal): (bm_now / bm_prev) - 1, bootstrap->0 when prev missing
  const id_pct = makeDense(coins, (b, q) => {
    const v = bm.get(b)?.get(q);
    const p = prevBm.grid.get(b)?.get(q);
    return (Number.isFinite(v as any) && Number.isFinite(p as any) && Number(p) !== 0)
      ? (Number(v) / Number(p)) - 1
      : 0;
  });

  // pct_drv (decimal): id_pct_now - id_pct_prev, bootstrap->0 if prev id_pct missing
  const pct_drv = makeDense(coins, (b, q) => {
    const now = id_pct.get(b)?.get(q);
    const was = prevId.grid.get(b)?.get(q);
    return (Number.isFinite(now as any) && Number.isFinite(was as any))
      ? Number(now) - Number(was)
      : 0;
  });

  // ref (decimal): (1 + id_pct) * pct_ref
  const ref = makeDense(coins, (b, q) => {
    const id = id_pct.get(b)?.get(q);
    const pr = pct_ref.get(b)?.get(q);
    return (Number.isFinite(id as any) && Number.isFinite(pr as any))
      ? (1 + Number(id)) * Number(pr)
      : 0;
  });

  // delta (ratio residual vs opening + ref): computed in API; store a placeholder if you want (optional)
  // Here we store NaN to keep NOT NULL happy but avoid stale definition.
  const delta = makeDense(coins, () => Number.NaN);

  // write (NO pct24h here; API serves it live)
  const rows = [
    ...denseToRows("benchmark", ts_ms, bm,       false),
    ...denseToRows("pct_ref",   ts_ms, pct_ref,  true),
    ...denseToRows("id_pct",    ts_ms, id_pct,   true),
    ...denseToRows("pct_drv",   ts_ms, pct_drv,  true),
    ...denseToRows("ref",       ts_ms, ref,      true),
    ...denseToRows("delta",     ts_ms, delta,    false),
  ];

  await pool.query("begin");
  try {
    for (const r of rows) {
      await pool.query(
        `insert into public.dyn_matrix_values (matrix_type, base, quote, ts_ms, value)
         values ($1,$2,$3,$4,$5)
         on conflict (matrix_type, base, quote, ts_ms)
         do update set value = excluded.value`,
        [r.matrix_type, r.base, r.quote, ts_ms, r.value]
      );
    }
    await pool.query("commit");
  } catch (e) {
    await pool.query("rollback");
    throw e;
  }

  const pairs = coins.length, cells = pairs * Math.max(0, pairs - 1);
  console.log(`[mat-refresh] ts=${ts_ms} pairs=${pairs} cells=${cells} coins=${coins.join(",")}`);
}

main().catch(e => { console.error("[mat-refresh] error", e); process.exit(1); });
