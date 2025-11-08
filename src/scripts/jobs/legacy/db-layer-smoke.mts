import { query } from "../../../core/db/pool_server";

// Small helper: report and throw with context
function assert(cond: any, msg: string) {
  if (!cond) throw new Error(msg);
}

async function tableExists(qualified: string) {
  const [schema, table] = qualified.split(".");
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema=$1 AND table_name=$2
     ) AS exists`,
    [schema, table]
  );
  return rows[0]?.exists === true;
}

async function showNotNullCols(qualified: string) {
  const [schema, table] = qualified.split(".");
  const { rows } = await query<{ column_name: string; column_default: string | null }>(`
    SELECT column_name, column_default
    FROM information_schema.columns
    WHERE table_schema=$1 AND table_name=$2 AND is_nullable='NO'
    ORDER BY ordinal_position
  `, [schema, table]);
  return rows;
}

async function latestCountByBase(qualified: string, matrixType: string) {
  const { rows } = await query<{ base: string; rows: number }>(`
    SELECT base, COUNT(*)::int AS rows
    FROM ${qualified}
    WHERE matrix_type = $1
    GROUP BY base
    ORDER BY base
  `, [matrixType]);
  return rows;
}

async function main() {
  console.log("=== DB Layer Smoke ===");

  // 0) basic ping
  const ping = await query<{ now: string }>("SELECT now()::text AS now");
  console.log("db: ping", ping.rows[0].now);

  // 1) expected tables
  const MAT = "matrices.dyn_values";
  const MAT_STAGE = "matrices.dyn_values_stage";
  const UNIVERSE = "settings.coin_universe";
  const WINDOWS = "settings.windows";

  assert(await tableExists(MAT), `Missing table: ${MAT}`);
  assert(await tableExists(MAT_STAGE), `Missing table: ${MAT_STAGE}`);
  assert(await tableExists(UNIVERSE), `Missing table: ${UNIVERSE}`);
  assert(await tableExists(WINDOWS), `Missing table: ${WINDOWS}`);

  // 2) NOT NULL columns that can block inserts
  console.log("dyn_values NOT NULL columns:");
  console.table(await showNotNullCols(MAT));

  // 3) seed minimal settings if empty (idempotent)
  const { rows: wcount } = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${WINDOWS}`);
  // seed windows with amount+unit (+ computed ms if that column exists)
// seed windows with amount+unit (+ computed ms if that column exists)
// seed windows: DO NOT touch duration_ms (it's generated in the table)
await query(`
  WITH base AS (
    SELECT * FROM (VALUES
      ('1m',  1, 'minute'),
      ('3m',  3, 'minute'),
      ('5m',  5, 'minute'),
      ('15m', 15, 'minute'),
      ('30m', 30, 'minute'),
      ('1h',  1, 'hour'),
      ('4h',  4, 'hour'),
      ('1d',  1, 'day')
    ) AS v(window_label, amount, unit)
  )
  INSERT INTO settings.windows (window_label, amount, unit)
  SELECT window_label, amount, unit
  FROM base
  ON CONFLICT (window_label)
  DO UPDATE SET
    amount = EXCLUDED.amount,
    unit   = EXCLUDED.unit
`);
console.log("seed: settings.windows (label, amount, unit) — duration_ms is generated");



  const { rows: ucount } = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${UNIVERSE} WHERE enabled=true`);
  if (ucount[0].n < 4) {
    await query(`
      INSERT INTO ${UNIVERSE}(symbol,base_asset,quote_asset,enabled,sort_order) VALUES
      ('BTCUSDT','BTC','USDT',true,1),
      ('ETHUSDT','ETH','USDT',true,2),
      ('ADAUSDT','ADA','USDT',true,3),
      ('SOLUSDT','SOL','USDT',true,4)
      ON CONFLICT (symbol) DO UPDATE SET enabled=EXCLUDED.enabled, sort_order=EXCLUDED.sort_order
    `);
    console.log("seed: settings.coin_universe (minimal 4)");
  }

  // 4) test a controlled insert into matrices (no pipeline/feature logic)
  //    We'll write a small benchmark slice for BTC/ETH/ADA/SOL against USDT at a single timestamp.
  const bases = ["BTC","ETH","ADA","SOL"];
  const quote = "USDT";
  const ts = Date.now();
  const type = "benchmark";

  // Build a simple directed NxN graph (i->j = price_i/price_j) with mockable prices.
  // You can swap this for real prices if you like; the goal is WRITE correctness, not computation.
  const price: Record<string, number> = {
    "BTC/USDT": 65000,
    "ETH/USDT": 3200,
    "ADA/USDT": 0.45,
    "SOL/USDT": 180,
  };
  const rows: Array<[string,string,string,number,number]> = []; // (type, base, quote, ts_ms, value)

  for (let i=0;i<bases.length;i++) {
    for (let j=0;j<bases.length;j++) {
      if (i===j) continue;
      const pi = price[`${bases[i]}/${quote}`];
      const pj = price[`${bases[j]}/${quote}`];
      const v = (Number.isFinite(pi) && Number.isFinite(pj)) ? (pi/pj) : null;
      if (v != null) rows.push([type, bases[i], bases[j], ts, v]); // NOTE: quote stored as "to-asset" here if your schema wants base/quote pair, adjust accordingly
    }
  }

  // Upsert respecting your unique index (matrix_type, base, quote, ts_ms)
  // If your design expects (matrix_type, base, quote, ts_ms) exactly as columns, this will work.
  // Otherwise, adjust column names to match DDL.
  const insertSql = `
    INSERT INTO ${MAT} (matrix_type, base, quote, ts_ms, value)
    VALUES ${rows.map((_,i)=>`($${5*i+1},$${5*i+2},$${5*i+3},$${5*i+4},$${5*i+5})`).join(",")}
    ON CONFLICT (matrix_type, base, quote, ts_ms)
    DO UPDATE SET value = EXCLUDED.value
  `;
  const insertParams = rows.flat();
  const res = await query(insertSql, insertParams);
  console.log(`write: upserted rows = ${rows.length} (affected ${res.rowCount})`);

  // 5) verify counts by base and “latest” visibility
  const counts = await latestCountByBase(MAT, type);
  console.log("counts by base (all-time):");
  console.table(counts);

  // “latest per base/quote” check
  const { rows: latest } = await query(`
    SELECT DISTINCT ON (base, quote) base, quote, ts_ms, value
    FROM ${MAT}
    WHERE matrix_type = $1
    ORDER BY base, quote, ts_ms DESC
  `, [type]);

  console.log("latest per base/quote:");
  console.table(latest);

  console.log("=== DB Layer Smoke OK ===");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
