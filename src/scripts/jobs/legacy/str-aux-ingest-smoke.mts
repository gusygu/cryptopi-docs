// src/scripts/smokes/str-aux-ingest-smoke.mts
 
import { query, db } from "@/core/db/pool_server";

function ts(ms: number) { return new Date(ms).toISOString(); }

async function main() {
  console.log("=== STR-AUX Ingest Smoke ===");
  const { rows: uni } = await query<{symbol:string}>(`select symbol from str_aux.v_enabled_symbols order by 1 limit 1`);
  if (!uni.length) throw new Error("No enabled symbols in v_enabled_symbols");
  const symbol = uni[0].symbol;
  const now = Date.now();
  const start = Math.floor((now - 8*5000) / 5000) * 5000;

  // Fake 8 buckets of 5s each (one 40s cycle)
  for (let i=0;i<8;i++) {
    const end = start + (i+1)*5000;
    const bids = Array.from({length: 3}, (_,k)=>({price:100+i*0.01+k*0.001, qty: 1+k}));
    const asks = Array.from({length: 3}, (_,k)=>({price:100.5+i*0.01+k*0.001, qty: 1+k}));
    await query(`select str_aux.upsert_sample_5s($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
      symbol, ts(end),
      100+i*0.01, 100.5+i*0.01, 0, i*0.001,
      0.1, 0.2, 0.3, 0.05, 1, 0, { smoke: true, i }
    ]);
  }

  // Roll cycle + window
  await query(`select str_aux.sp_roll_cycle_40s($1, str_aux._floor_to_seconds($2, 40))`, [symbol, ts(start+8*5000)]);
  await query(`select str_aux.try_roll_window_now($1,$2)`, [symbol, "30m"]);
  await query(`select str_aux.recompute_window_stats($1,$2)`, [symbol, "30m"]);
  await query(`select str_aux.recompute_window_vectors($1,$2)`, [symbol, "30m"]);

  // Checks
  const { rows: c } = await query(`select count(*)::int n from str_aux.cycles_40s where symbol=$1`, [symbol]);
  const { rows: w } = await query(`select count(*)::int n from str_aux.windows where symbol=$1 and window_label='30m'`, [symbol]);
  const { rows: s } = await query(`select count(*)::int n from str_aux.window_stats where symbol=$1 and window_label='30m'`, [symbol]);
  const { rows: v } = await query(`select count(*)::int n from str_aux.window_vectors where symbol=$1 and window_label='30m'`, [symbol]);

  console.log("symbol:", symbol);
  console.log("cycles_40s rows:", c[0].n, " windows(30m):", w[0].n, " stats:", s[0].n, " vectors:", v[0].n);

  await db.end();
  console.log("Ingest smoke OK");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
