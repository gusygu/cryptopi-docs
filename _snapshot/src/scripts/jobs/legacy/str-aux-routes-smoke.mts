#!/usr/bin/env tsx
/**
 * Str-Aux doctor smoke:
 *  • Confirms enabled universe → windows → stats → vectors coverage
 *  • Recomputes gaps (DB)
 *  • Optionally hits HTTP /api/str-aux/stats and /api/str-aux/vectors
 *
 * Env:
 *   DATABASE_URL=postgres://...
 *   CRYPTO_API_BASE=http://localhost:3000 (optional)
 */
import pg from "pg";

type Row = Record<string, any>;
const BASE = process.env.CRYPTO_API_BASE; // optional

async function q<T=Row>(client: pg.Client, sql: string, params: any[] = []): Promise<T[]> {
  const { rows } = await client.query(sql, params);
  return rows as T[];
}

function pad(s: string, n: number) { return (s ?? '').toString().padEnd(n); }
function fmt(ts?: string) { return ts ? new Date(ts).toISOString() : '-' }

async function run() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  console.log("=== STR-AUX Routes + DB Smoke ===");

  // 1) Universe
  const enabled = await q(client, `
    select symbol from settings.coin_universe where enabled order by symbol
  `);
  console.log(`enabled symbols: ${enabled.length}`);
  if (enabled.length === 0) {
    console.log("!! No enabled symbols. Toggle some in settings.coin_universe.enabled = true");
    await client.end(); return;
  }

  // 2) Coverage snapshot
  const cov = await q(client, `
    select symbol, window_label, windows, stats_rows, vector_rows,
           last_win_updated, last_stats_updated, last_vec_updated
    from str_aux.v_stats_coverage
    order by symbol, window_label
  `);

  if (cov.length === 0) {
    console.log("!! No windows found yet. Rolling once for every enabled symbol…");
    await q(client, `
      select str_aux.try_roll_all_windows_now(symbol)
      from settings.coin_universe where enabled
    `);
  }

  console.log("\n-- Coverage (symbol label | win | stats | vec | last_win | last_stats | last_vec)");
  const cov2 = await q(client, `
    select symbol, window_label, windows, stats_rows, vector_rows,
           to_char(last_win_updated, 'YYYY-MM-DD HH24:MI:SS') as last_win_updated,
           to_char(last_stats_updated,'YYYY-MM-DD HH24:MI:SS') as last_stats_updated,
           to_char(last_vec_updated,  'YYYY-MM-DD HH24:MI:SS') as last_vec_updated
    from str_aux.v_stats_coverage
    order by symbol, window_label
  `);
  for (const r of cov2) {
    console.log(
      `${pad(r.symbol,10)} ${pad(r.window_label,5)} | ${pad(r.windows,4)} | ${pad(r.stats_rows,5)} | ${pad(r.vector_rows,5)} | ${pad(r.last_win_updated,19)} | ${pad(r.last_stats_updated,19)} | ${pad(r.last_vec_updated,19)}`
    );
  }

  // 3) Fix any gaps (DB recompute)
  const gaps = await q(client, `select * from str_aux.v_stats_vectors_gaps`);
  if (gaps.length) {
    console.log(`\n-- Found ${gaps.length} gap rows. Recomputing stats/vectors…`);
    // Recompute per-symbol/label
    for (const g of gaps) {
      if (g.missing_stats > 0) {
        await q(client, `select str_aux.recompute_window_stats($1, $2)`, [g.symbol, g.window_label]);
      }
      if (g.missing_vectors > 0) {
        await q(client, `select str_aux.recompute_window_vectors($1, $2)`, [g.symbol, g.window_label]);
      }
    }
    // Show deltas
    const after = await q(client, `
      select symbol, window_label, windows, stats_rows, vector_rows
      from str_aux.v_stats_coverage
      order by symbol, window_label
    `);
    console.log("\n-- Coverage after recompute:");
    for (const r of after) {
      console.log(`${pad(r.symbol,10)} ${pad(r.window_label,5)} | win=${r.windows} stats=${r.stats_rows} vec=${r.vector_rows}`);
    }
  } else {
    console.log("\n-- No gaps. Stats & vectors aligned with windows.");
  }

  // 4) Optional HTTP checks
  if (BASE) {
    console.log(`\n-- HTTP checks against ${BASE}`);
    const sampleSyms = enabled.slice(0, Math.min(5, enabled.length)).map(r => r.symbol as string);
    const withFetch = (globalThis as any).fetch ? true : false;

    if (!withFetch) {
      // Node 18+ has fetch; if your tsx runtime doesn’t, require('node-fetch')
      // but we’ll keep this simple: only run if fetch exists.
      console.log("fetch() not available in this runtime; skipping HTTP checks.");
    } else {
      const qs = (params: Record<string,string>) => {
        const search = new URLSearchParams(params);
        return `?${search.toString()}`;
      };
      // Pick one symbol to assert shape
      const sym = sampleSyms[0];
      try {
        const statsUrl   = `${BASE}/api/str-aux/stats${qs({ symbol: sym })}`;
        const vectorsUrl = `${BASE}/api/str-aux/vectors${qs({ symbol: sym })}`;

        const [rs, rv] = await Promise.all([ fetch(statsUrl), fetch(vectorsUrl) ]);
        const [js, jv] = await Promise.all([ rs.json(), rv.json() ]);

        const okStats   = Array.isArray(js?.rows ?? js) && (js.rows?.length ?? js.length) >= 0;
        const okVectors = Array.isArray(jv?.rows ?? jv) && (jv.rows?.length ?? jv.length) >= 0;

        console.log(`GET /stats  (${sym}) → ${okStats ? "OK" : "WARN"} length=${okStats ? (js.rows?.length ?? js.length) : 0}`);
        console.log(`GET /vectors(${sym}) → ${okVectors ? "OK" : "WARN"} length=${okVectors ? (jv.rows?.length ?? jv.length) : 0}`);

        // Compare counts (roughly) vs DB latest for the same symbol
        const dbCounts = await q(client, `
          select
            (select count(*) from str_aux.window_stats   where symbol=$1) as stats_rows,
            (select count(*) from str_aux.window_vectors where symbol=$1) as vector_rows
        `, [sym]);
        const { stats_rows, vector_rows } = dbCounts[0];

        console.log(`DB counts for ${sym}: stats=${stats_rows} vectors=${vector_rows}`);
      } catch (e) {
        console.log("HTTP check failed:", (e as Error).message);
      }
    }
  }

  // 5) Summarize suspects for the “only 4 symbols” issue
  console.log("\n-- Suspects if a previous smoke showed only 4 symbols:");
  console.log("  • That smoke probably enumerated from market.symbols instead of settings.coin_universe");
  console.log("  • Or it required v_latest_windows rows and skipped symbols without any rolled window yet");
  console.log("  • Or it filtered on a hard-coded label set that not all symbols have");

  await client.end();
  console.log("\nStr-Aux doctor smoke: DONE.");
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
