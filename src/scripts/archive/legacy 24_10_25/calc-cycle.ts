import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Route-tier bands (keep in sync)
const BANDS = [
  { min:0.00, max:0.25, w:0.2 },
  { min:0.25, max:0.75, w:0.4 },
  { min:0.75, max:1.50, w:1.0 },
  { min:1.50, max:2.50, w:1.5 },
  { min:2.50, max: Infinity, w:2.0 },
];
const bandW = v => (BANDS.find(b => Math.abs(Number(v||0)) >= b.min && Math.abs(Number(v||0)) < b.max) || BANDS[BANDS.length-1]).w;

async function latestCoins(client){
  const { rows } = await client.query(`SELECT base, quote FROM id_pct_latest LIMIT 2000`);
  const s = new Set(); rows.forEach(r => { s.add(String(r.base).toUpperCase()); s.add(String(r.quote).toUpperCase()); });
  const out = Array.from(s);
  if (!out.includes("USDT")) out.unshift("USDT");
  return out;
}
async function readIdPct(client, coins){
  const grid = {};
  for (const b of coins) { grid[b] = {}; for (const q of coins) grid[b][q] = b===q ? null : 0; }
  const { rows } = await client.query(
    `SELECT base, quote, id_pct FROM id_pct_latest
     WHERE base = ANY($1::text[]) AND quote = ANY($1::text[])`, [coins]
  );
  rows.forEach(r => { const B=r.base.toUpperCase(), Q=r.quote.toUpperCase(); if (B!==Q) grid[B][Q] = Number(r.id_pct||0); });
  return grid;
}
async function readBalances(client, coins){
  const out = Object.fromEntries(coins.map(c => [c, 0]));
  const { rows } = await client.query(
    `SELECT asset, amount FROM wallet_balances_latest WHERE asset = ANY($1::text[])`, [coins]
  );
  rows.forEach(r => out[r.asset.toUpperCase()] = Number(r.amount||0));
  return out;
}

function computeMeaWeights({ coins, grid, balances }){
  const k = Math.max(1, coins.length - 1);
  const n = coins.length;
  const w = {};
  for (const b of coins) {
    const avail = Number(balances[b] || 0);
    let acc = 0;
    for (const q of coins) if (q !== b) acc += bandW(grid[b][q]);
    w[b] = avail * (acc / k) * n; // same pattern as API (pre-mood)
  }
  return w;
}
function computeStrVectorMean({ coins, grid }){
  const out = {};
  for (const b of coins) {
    let acc = 0, m = 0;
    for (const q of coins) if (q !== b) {
      const v = Number(grid[b][q]);
      if (Number.isFinite(v)) { acc += v; m++; }
    }
    out[b] = m ? acc / m : 0;
  }
  return out;
}

async function main(){
  const client = await pool.connect();
  try {
    const coins = await latestCoins(client);
    const grid  = await readIdPct(client, coins);
    const bals  = await readBalances(client, coins);

    const mea = computeMeaWeights({ coins, grid, balances: bals });
    const str = computeStrVectorMean({ coins, grid });

    const now = Date.now();
    await client.query("BEGIN");
    for (const [coin, val] of Object.entries(mea)) {
      await client.query(
        `INSERT INTO metrics (metric_key, value, ts_epoch_ms)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [`mea_weight:${coin}`, Number(val||0), now]
      );
    }
    for (const [coin, val] of Object.entries(str)) {
      await client.query(
        `INSERT INTO metrics (metric_key, value, ts_epoch_ms)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [`str_vector:${coin}`, Number(val||0), now]
      );
    }
    await client.query("COMMIT");
    console.log("cycle OK", new Date(now).toISOString());
  } catch (e) {
    await pool.query("ROLLBACK").catch(()=>{});
    console.error("cycle ERR", e.message);
    process.exitCode = 1;
  } finally {
    pool.end();
  }
}
main();
