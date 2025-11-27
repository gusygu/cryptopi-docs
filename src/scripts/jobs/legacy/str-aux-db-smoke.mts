// src/scripts/smokes/str-aux-db-smoke.mts
 
import { db, query } from "@/core/db/pool_server";

function floorTo(ms: number, stepMs: number) {
  return Math.floor(ms / stepMs) * stepMs;
}

async function main() {
  console.log("=== STR-AUX + DB Smoke ===");

  // Ping
  const ping = await query<{ now: string }>("select now()");
  console.log("db: ping", ping.rows[0]?.now);

  // NEW: pull the enabled, referential universe
  const { rows: uni } = await query<{ symbol: string }>(`
    select symbol from str_aux.v_enabled_symbols order by 1
  `);

  if (uni.length === 0) {
    console.log("WARN: no enabled symbols (settings.coin_universe ∩ market.symbols is empty).");
    console.log("     – If discovery already filled market.symbols, run:");
    console.log("       select settings.ensure_coin_universe_from_market(true);");
    await db.end();
    return;
  }
  console.log("coin_universe (enabled):", uni.length, uni.map(r => r.symbol));

  // Use the first enabled symbol for a concise smoke; feel free to loop all
  const symbol = uni[0].symbol;

  // Build aligned 5s samples
  const nowMs = Date.now();
  const baseStepMs = 5_000;
  const cycleMs = 40_000;
  const startMs = floorTo(nowMs - 16 * baseStepMs, baseStepMs);

  const rows = Array.from({ length: 16 }, (_, i) => {
    const ts = new Date(startMs + i * baseStepMs);
    const vInner = 100 + i * 0.01;
    const vOuter = 100.5 + i * 0.015;
    const vSwap = (i % 7) - 3;
    const vTendency = i > 0 ? vInner - 100 : 0;
    const disruption = Math.abs(Math.sin(i / 5));
    const amp = 0.5 + (i % 5) * 0.02;
    const volt = 0.8 + (i % 3) * 0.03;
    const inertia = 0.2 + (i % 4) * 0.01;
    const modeGeneral = (i % 4);
    const modeB = (i % 3);
    return { ts, vInner, vOuter, vSwap, vTendency, disruption, amp, volt, inertia, modeGeneral, modeB, attrs: { smoke: true, i } };
  });

  // Upsert 5s samples
  for (const r of rows) {
    await query(
      `select str_aux.upsert_sample_5s($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        symbol,
        r.ts,
        r.vInner,
        r.vOuter,
        r.vSwap,
        r.vTendency,
        r.disruption,
        r.amp,
        r.volt,
        r.inertia,
        r.modeGeneral,
        r.modeB,
        r.attrs,
      ],
    );
  }
  console.log(`PASS: inserted/upserted 5s samples for ${symbol}:`, rows.length);

  // Roll cycles across the range we populated
  const fromTs = new Date(floorTo(startMs, cycleMs));
  const toTs = new Date(floorTo(nowMs + cycleMs, cycleMs));
  const { rows: cyc } = await query<{ n: number }>(
    `select str_aux.roll_cycles_40s_between($1,$2,$3) as n`,
    [symbol, fromTs, toTs],
  );
  console.log("PASS: rolled cycles (40s):", cyc[0]?.n ?? 0);

  // Read back latest cycle
  const { rows: lastCyc } = await query(
    `
    select cycle_start, v_inner_close, v_outer_close, v_swap_close, v_tend_close
      from str_aux.cycles_40s
     where symbol=$1
  order by cycle_start desc
     limit 1
    `,
    [symbol],
  );
  if (!lastCyc.length) throw new Error("no cycles_40s row found after rolling");
  console.log("PASS: latest cycle:", lastCyc[0]);

  // Window roll (non-fatal)
  try {
    await query(`select str_aux.try_roll_window_now($1,$2)`, [symbol, "30m"]);
  } catch (e) {
    console.log("INFO: window roll skipped (not critical for this smoke):", String(e).slice(0, 160));
  }

  console.log("Str-Aux smoke OK");
  await db.end();
}

main().catch((err) => {
  console.error("error:", err?.stack || err);
  process.exitCode = 1;
});
