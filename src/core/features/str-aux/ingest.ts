// Ingest orchestration (DB-facing) for discover / enable / status / coverage / batch sample upsert.
// Uses pool_server; no parameterized INTERVALs (uses inline seconds).
import { query, withClient } from "@/core/db/pool_server";

const WINDOWS = ["1m", "3m", "5m", "15m", "1h"] as const;
type Window = (typeof WINDOWS)[number];

function tblForWindow(w: Window) {
  if (!WINDOWS.includes(w)) throw new Error("invalid window");
  return `str_aux.samples_${w}` as const;
}

export async function status() {
  const [p] = rows(await query(`select now() as now, current_user as "user"`));
  const [{ n: marketUsdt = 0 } = {}] = rows(
    await query(
      `select count(*)::int as n from market.symbols where quote='USDT' or quote_asset='USDT'`
    )
  );
  const cu = rows(await query(
    `select symbol, enabled from settings.coin_universe where (quote='USDT' or quote is null) order by 1`
  ));
  return {
    now: p?.now,
    user: p?.user,
    marketUsdt,
    enabled: cu.filter((x: any) => x.enabled).map((x: any) => x.symbol),
  };
}

/** Sync discovered USDT symbols into settings.coin_universe (non-destructive). */
export async function discover() {
  await withClient(async (c) => {
    await c.query(`
      create table if not exists settings.coin_universe(
        symbol  text primary key,
        base    text,
        quote   text,
        enabled boolean not null default false,
        source  text default 'binance',
        discovered_at timestamptz,
        last_seen_at  timestamptz,
        notes   text
      );
    `);

    await c.query(`
      update settings.coin_universe c
         set base = coalesce(c.base, m.base),
             quote = coalesce(c.quote, m.quote)
        from market.symbols m
       where m.symbol = c.symbol;
    `);

    await c.query(`
      insert into settings.coin_universe(symbol, base, quote, source, discovered_at, last_seen_at)
      select m.symbol, m.base, m.quote, 'binance', now(), now()
        from market.symbols m
        left join settings.coin_universe c using(symbol)
       where (m.quote='USDT' or m.quote_asset='USDT') and c.symbol is null;
    `);

    await c.query(`
      update settings.coin_universe c
         set last_seen_at = now()
        from market.symbols m
       where m.symbol = c.symbol;
    `);
  });

  return { message: "discovery synced", ...(await status()) };
}

export async function enableSymbols(symbols: string[], enable = true) {
  if (!symbols?.length) throw new Error("symbols[] required");
  const res = rows(
    await query(
      `update settings.coin_universe
          set enabled = $2
        where symbol = any($1::text[])
        returning symbol, enabled`,
      [symbols, enable]
    )
  );
  return { message: `updated ${res.length} symbols`, changes: res };
}

/** Batch upsert 5s samples in one call (uses the SQL function). */
export async function upsertSamples5s(samples: Array<{
  symbol: string;
  ts: string;
  metrics: {
    v_inner?: number | null;
    v_outer?: number | null;
    v_swap?: number | null;
    v_tendency?: number | null;
    disruption?: number | null;
    amp?: number | null;
    volt?: number | null;
    inertia?: number | null;
    mode_general?: number | null;
    mode_b?: number | null;
    attrs?: Record<string, unknown> | null;
  };
}>) {
  if (!samples?.length) return { message: "no samples provided" };
  await withClient(async (c) => {
    for (const s of samples) {
      const m = s.metrics ?? {};
      await c.query(
        `select str_aux.upsert_sample_5s(
           $1::text, $2::timestamptz,
           $3::numeric, $4::numeric, $5::numeric, $6::numeric,
           $7::numeric, $8::numeric, $9::numeric, $10::numeric,
           $11::int, $12::int, $13::jsonb,
           $14::smallint, $15::int, $16::int, $17::int,
           $18::numeric, $19::numeric, $20::numeric,
           $21::numeric, $22::numeric,
           $23::numeric,
           $24::jsonb
         )`,
        [
          s.symbol,
          s.ts,
          m.v_inner ?? null,
          m.v_outer ?? null,
          m.v_swap ?? null,
          m.v_tendency ?? null,
          m.disruption ?? null,
          m.amp ?? null,
          m.volt ?? null,
          m.inertia ?? null,
          m.mode_general ?? null,
          m.mode_b ?? null,
           m.attrs ?? {},
           null,
           null,
           null,
           null,
           null,
           null,
           null,
           null,
           null,
           null,
           [],
        ]
      );
    }
  });
  return { message: `upserted ${samples.length} rows` };
}

/** Coverage + NULL rates for a window, over the last N seconds. */
export async function coverage(window: Window, symbols: string[] | null, lookbackSeconds = 2 * 60 * 60) {
  const tbl = tblForWindow(window);
  const filtering = symbols && symbols.length;
  const sql = `
    select s.symbol,
           count(*) filter (where s.ts > now() - ${lookbackSeconds} * interval '1 second') as rows_lookback,
           round(100.0 * avg(case when v_inner   is null then 1 else 0 end), 2) as null_inner_pct,
           round(100.0 * avg(case when v_outer   is null then 1 else 0 end), 2) as null_outer_pct,
           round(100.0 * avg(case when v_swap    is null then 1 else 0 end), 2) as null_swap_pct,
           round(100.0 * avg(case when v_tendency is null then 1 else 0 end), 2) as null_tendency_pct
      from ${tbl} s
     where ${filtering ? "s.symbol = any($1)" : "true"}
       and  s.ts > now() - ${lookbackSeconds} * interval '1 second'
     group by s.symbol
     order by rows_lookback asc, s.symbol asc`;
  const res = await query(sql, filtering ? [symbols] as any[] : []);
  return { rows: rows(res) };
}

/* ----------------------------- utils ----------------------------- */
function rows<T = any>(res: any): T[] {
  if (!res) return [] as T[];
  if (Array.isArray(res)) return res as T[];
  if (Array.isArray(res.rows)) return res.rows as T[];
  return [] as T[];
}
