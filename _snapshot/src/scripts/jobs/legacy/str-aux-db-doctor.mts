// src/scripts/smokes/str-aux-db-doctor.mts
// Brand-new, defensive smoke using your shared pool_server helpers.
// - No parameterized INTERVAL (uses inline seconds)
// - Works even if no symbols are enabled yet
// - Verifies market.assets PK and FK wiring to market.symbols
// - Checks Str-Aux sample table shapes, coverage, null-rates, duplicates

import { getPool, query, withClient } from "../../../core/db/pool_server";

const WINDOWS = ["1m", "3m", "5m", "15m", "1h"] as const;
const LOOKBACK_SECONDS = 2 * 60 * 60; // 2 hours

function rows<T = any>(res: any): T[] {
  if (!res) return [] as T[];
  if (Array.isArray(res)) return res as T[];
  if (Array.isArray(res.rows)) return res.rows as T[];
  return [] as T[];
}

async function main() {
  const pool = getPool();
  console.log("=== STR-AUX Doctor Smoke v2 ===");

  // 0) Environment sanity
  {
    const r = await query("select now() as now, current_user as user");
    const [p] = rows<{ now: string; user: string }>(r);
    console.log("db: ping", p?.now, "as", p?.user);
  }

  // 1) Market layer integrity — assets PK & FKs
  await withClient(async (c) => {
    const pkq = await c.query(`
      select a.attname as pk_col
      from pg_index i
      join pg_class t on t.oid = i.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute a on a.attrelid = t.oid and a.attnum = any(i.indkey)
      where n.nspname='market' and t.relname='assets' and i.indisprimary
      limit 1`);
    const pkcol = rows<{ pk_col: string }>(pkq)[0]?.pk_col;
    console.log("market.assets PK:", pkcol ?? "(not found)");

    const fks = await c.query(`
      select conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class t on t.oid=c.conrelid
      join pg_namespace n on n.oid=t.relnamespace
      where n.nspname='market' and t.relname='symbols' and c.contype='f'
      order by conname`);
    console.log("market.symbols FKs:");
    console.table(rows(fks));
  });

  // 2) Discovery snapshot
  let enabledSymbols: string[] = [];
  {
    const m = rows<{ n: number }>(await query(`select count(*)::int as n from market.symbols where quote='USDT' or quote_asset='USDT'`))[0]?.n ?? 0;
    console.log("market.symbols (USDT) total:", m);

    const cu = rows<{ symbol: string; enabled: boolean }>(await query(`
      select symbol, enabled
      from settings.coin_universe
      where (quote='USDT' or quote is null) -- tolerate older rows
      order by enabled desc, 1 asc`));
    enabledSymbols = cu.filter(x => x.enabled).map(x => x.symbol);
    console.log(`coin_universe: enabled pairs = ${enabledSymbols.length}`, enabledSymbols);
  }

  // 3) Table shapes for Str-Aux samples
  {
    const shapes = rows(await query(`
      with targets(t) as (
        values ('samples_1m'), ('samples_3m'), ('samples_5m'), ('samples_15m'), ('samples_1h')
      )
      select t as table,
             exists(
               select 1 from information_schema.columns
                where table_schema='str_aux' and table_name=t and column_name='ts'
             ) as has_ts,
             exists(
               select 1
               from pg_constraint c
               join pg_class rel on rel.oid = c.conrelid
               join pg_namespace n on n.oid = rel.relnamespace
               where c.contype='p' and n.nspname='str_aux' and rel.relname=t
             ) as has_pk
      from targets
      order by t`));
    console.log("\nStr-Aux table shapes (ts & PK):");
    console.table(shapes);
  }

  // 4) Coverage & NULL rates per window
  for (const w of WINDOWS) {
    const tbl = `str_aux.samples_${w}`;
    console.log(`\nWindow: ${w}`);

    // Build SQL that stays valid with/without symbol filter
    const symbolClause = enabledSymbols.length ? "s.symbol = any($1) and" : "";
    const params = enabledSymbols.length ? [enabledSymbols] : [];

    const sql = `
      select s.symbol,
             count(*) filter (where s.ts > now() - ${LOOKBACK_SECONDS} * interval '1 second') as rows_lookback,
             round(100.0 * avg(case when v_inner is null then 1 else 0 end), 2) as null_inner_pct,
             round(100.0 * avg(case when v_outer is null then 1 else 0 end), 2) as null_outer_pct,
             round(100.0 * avg(case when v_swap  is null then 1 else 0 end), 2) as null_swap_pct,
             round(100.0 * avg(case when v_tend  is null then 1 else 0 end), 2) as null_tend_pct,
             coalesce(sum( (case when v_inner is null then 1 else 0 end)
                          + (case when v_outer is null then 1 else 0 end)
                          + (case when v_swap  is null then 1 else 0 end)
                          + (case when v_tend  is null then 1 else 0 end)),0) as null_fields_sum
        from ${tbl} s
       where ${symbolClause} s.ts > now() - ${LOOKBACK_SECONDS} * interval '1 second'
       group by s.symbol
       order by rows_lookback asc, s.symbol asc`;

    const r = await query(sql, params);
    const cov = rows(r);
    if (!cov.length) console.log("  (no rows in lookback)");
    else console.table(cov);
  }

  // 5) Duplicate guard: more than one row per (symbol, minute) in last day
  await withClient(async (c) => {
    for (const w of WINDOWS) {
      const tbl = `str_aux.samples_${w}`;
      const dq = await c.query(`
        select symbol, date_trunc('minute', ts) as minute, count(*)
          from ${tbl}
         where ts > now() - interval '1 day'
         group by 1,2
        having count(*) > 1
         order by 3 desc, 1 asc
         limit 5`);
      const dups = rows(dq);
      if (dups.length) {
        console.warn(`!! duplicates in ${tbl} over last day:`);
        console.table(dups);
      }
    }
  });

  await pool.end();
}

main().catch(async (e) => {
  console.error("Doctor smoke error:", e);
  try { await getPool().end(); } catch {}
  process.exit(1);
});
