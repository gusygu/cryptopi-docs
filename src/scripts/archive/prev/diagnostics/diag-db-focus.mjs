// src/scripts/smokes/diagnostics/diag-db-focus.mjs
// Run: node --env-file=.env src/scripts/smokes/diagnostics/diag-db-focus.mjs
import { Client } from "pg";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("✖ DATABASE_URL not set"); process.exit(1); }

const CANON = [["BTC","ETH"], ["BTC","SOL"], ["ETH","SOL"]];

async function q(c, sql, p=[]) { const r = await c.query(sql, p); return r.rows; }

async function latestTwoTimestamps(c, type) {
  const r = await q(c, `
    select ts_ms::bigint as ts, count(*) as n
    from public.dyn_matrix_values
    where matrix_type=$1
    group by 1
    order by ts_ms desc
    limit 2
  `, [type]);
  const [latest, prev] = r;
  return {
    latestTs: latest?.ts ?? null,
    latestCount: Number(latest?.n ?? 0),
    prevTs: prev?.ts ?? null,
    prevCount: Number(prev?.n ?? 0),
  };
}

async function cellsAtTs(c, type, ts) {
  if (!ts) return [];
  const r = await q(c, `
    select base, quote, value::float8 as v
    from public.dyn_matrix_values
    where matrix_type=$1 and ts_ms=$2
  `, [type, ts]);
  return r;
}

function indexByKey(rows) {
  const m = new Map();
  for (const r of rows) m.set(`${r.base}/${r.quote}`, r.v);
  return m;
}

function topDeltas(latRows, prevRows, k=6) {
  const iPrev = indexByKey(prevRows);
  const out = [];
  for (const r of latRows) {
    const pv = iPrev.get(`${r.base}/${r.quote}`);
    if (pv == null || r.v == null) continue;
    const d = r.v - pv;
    out.push({ base: r.base, quote: r.quote, v: r.v, pv, d });
  }
  out.sort((a,b) => Math.abs(b.d) - Math.abs(a.d));
  return out.slice(0, k).map(x => ({
    base: x.base, quote: x.quote,
    v: Number(x.v.toPrecision(6)),
    pv: Number(x.pv.toPrecision(6)),
    d: Number(x.d.toPrecision(6))
  }));
}

function pickCanon(latRows, prevRows) {
  const iLat = indexByKey(latRows);
  const iPrev = indexByKey(prevRows);
  return CANON.map(([b,q]) => {
    const v = iLat.get(`${b}/${q}`);
    const pv = iPrev.get(`${b}/${q}`);
    const d = (v!=null && pv!=null) ? Number((v-pv).toPrecision(6)) : null;
    return {
      base:b, quote:q,
      v: v!=null ? Number(v.toPrecision(6)) : null,
      pv: pv!=null ? Number(pv.toPrecision(6)) : null,
      d
    };
  });
}

async function scanType(c, type) {
  const { latestTs, latestCount, prevTs, prevCount } = await latestTwoTimestamps(c, type);
  const lat = await cellsAtTs(c, type, latestTs);
  const prev = await cellsAtTs(c, type, prevTs);
  return {
    type,
    ts: latestTs,
    prev: prevTs,
    recency_ms: latestTs ? Date.now() - Number(latestTs) : null,
    counts: { latest: latestCount, prev: prevCount },
    topΔ: topDeltas(lat, prev, 6),
    canon: pickCanon(lat, prev)
  };
}

async function latestStrAux(c) {
  const r = await q(c, `
    select id::bigint as id, pair_base, pair_quote, window_key, app_session_id,
           opening_ts::bigint as opening_ts, opening_price::float8 as opening_price,
           price_min::float8 as price_min, price_max::float8 as price_max
    from strategy_aux.str_aux_session
    order by id desc
    limit 5
  `);
  return r.map(x => ({
    id:x.id, base:x.pair_base, quote:x.pair_quote, w:x.window_key, s:x.app_session_id,
    open_ts:x.opening_ts,
    op: x.opening_price!=null? Number(x.opening_price.toPrecision(6)) : null,
    min: x.price_min!=null? Number(x.price_min.toPrecision(6)) : null,
    max: x.price_max!=null? Number(x.price_max.toPrecision(6)) : null
  }));
}

(async () => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();

  const types = (await q(c, `select distinct matrix_type from public.dyn_matrix_values order by 1`))
               .map(r => r.matrix_type);

  const matrices = [];
  for (const t of types) matrices.push(await scanType(c, t));

  const out = {
    at: new Date().toISOString(),
    matrices,                 // [{type, ts, prev, recency_ms, counts:{latest,prev}, topΔ:[…6], canon:[3]}]
    str_aux_latest: await latestStrAux(c)
  };

  await c.end();
  console.log(JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
