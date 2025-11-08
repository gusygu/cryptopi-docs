// src/scripts/smokes/smoke-scs-read-trace.mts
// REMOVE: import 'dotenv/config';
import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/core/db'; // keep as-is

type MatrixType = 'benchmark'|'delta'|'pct24h'|'id_pct'|'pct_drv';

function parseArg(k: string, def?: string) {
  const hit = process.argv.find(a => a.startsWith(`--${k}=`));
  if (!hit) return def;
  return hit.slice(k.length + 3);
}
function parseBool(v: string|undefined, d = true) {
  if (v == null) return d;
  const s = v.toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

(async () => {
  const matrix_type = (parseArg('type') ?? 'benchmark') as MatrixType;
  const basesCsv = parseArg('bases') ?? 'BTC,ETH';
  const bases = basesCsv.split(/[,\s]+/).filter(Boolean).map(s => s.toUpperCase());
  const tsArg = parseArg('ts') ?? 'latest';
  const outDir = parseArg('out');
  const schema = parseArg('schema') ?? 'public';
  const grid = parseBool(parseArg('grid'), true);

  if (!bases.length) {
    console.error('ERR: --bases required (comma or space separated)');
    process.exit(2);
  }
  if (!['benchmark','delta','pct24h','id_pct','pct_drv'].includes(matrix_type)) {
    console.error('ERR: --type must be one of benchmark|delta|pct24h|id_pct|pct_drv');
    process.exit(2);
  }

  const TABLE = `${schema}.dyn_matrix_values`;

  // resolve latest ts for the filtered grid
  let targetTs: number;
  if (tsArg === 'latest') {
    const { rows } = await db.query<{ ts: string }>(
      `
      SELECT MAX(ts_ms) AS ts
        FROM ${TABLE}
       WHERE matrix_type = $1
         AND base = ANY($2)
         AND quote = ANY($2)
         ${grid ? 'AND base <> quote' : ''}
      `,
      [matrix_type, bases]
    );
    if (!rows?.[0]?.ts) {
      console.log(`• No rows found for type=${matrix_type} bases=[${bases.join(',')}]`);
      await db.end();
      process.exit(0);
    }
    targetTs = Number(rows[0].ts);
  } else {
    const n = Number(tsArg);
    if (!Number.isFinite(n)) {
      console.error('ERR: --ts must be "latest" or a numeric epoch ms');
      await db.end();
      process.exit(2);
    }
    targetTs = n;
  }

  const { rows } = await db.query<{
    matrix_type: MatrixType; base: string; quote: string; ts_ms: string; value: number; meta: any;
  }>(
    `
    SELECT matrix_type, base, quote, ts_ms, value, meta
      FROM ${TABLE}
     WHERE matrix_type = $1
       AND ts_ms = $2
       AND base = ANY($3)
       AND quote = ANY($3)
       ${grid ? 'AND base <> quote' : ''}
     ORDER BY base, quote
    `,
    [matrix_type, targetTs, bases]
  );

  const tsIso = new Date(targetTs).toISOString();
  console.log(`• TABLE=${TABLE} TYPE=${matrix_type} BASES=${bases.join(',')} TS_MS=${targetTs} (${tsIso})`);
  console.log(`• rows=${rows.length}`);

  const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
  console.log(pad('base',6), pad('quote',6), pad('value',18));
  console.log('-'.repeat(34));
  for (const r of rows) {
    const v = Number.isFinite(r.value) ? r.value : NaN;
    console.log(pad(r.base,6), pad(r.quote,6), pad(v.toString(),18));
  }

  if (outDir) {
    const dir = path.join(outDir, `read-trace-${matrix_type}-${targetTs}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'rows.json'),
      JSON.stringify({ matrix_type, ts_ms: targetTs, ts_iso: tsIso, bases, rows }, null, 2),
      'utf8'
    );
    console.log(`✔ dump: ${path.join(dir, 'rows.json')}`);
  }

  await db.end();
})().catch(async (e) => {
  console.error('SMOKE READ TRACE FAILED:', e);
  try { await db.end(); } catch {}
  process.exit(1);
});
