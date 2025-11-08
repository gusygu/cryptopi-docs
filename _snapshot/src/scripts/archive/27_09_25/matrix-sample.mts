// Prints a small base×quote numeric grid slice for each kind at its latest ts.
// Args: --limit=4  --kinds=benchmark,ref
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COINS = (process.env.COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,DOGE,USDT")
  .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const allKinds = ["benchmark","delta","pct24h","id_pct","pct_drv","pct_ref","ref"];

const args = new URLSearchParams(process.argv.slice(2).join("&").replace(/--/g,""));
const limit = Math.max(2, Math.min(8, Number(args.get("limit") ?? 4)));
const KINDS = (args.get("kinds") ?? allKinds.join(",")).split(",").map(s=>s.trim()).filter(Boolean);

async function latestTs(kind:string): Promise<number|null> {
  const { rows } = await pool.query(`SELECT MAX(ts_ms) AS ts FROM dyn_matrix_values WHERE matrix_type=$1`, [kind]);
  return rows?.[0]?.ts ? Number(rows[0].ts) : null;
}

async function grid(kind:string, ts:number) {
  const idx:Record<string,number> = {}; COINS.forEach((c,i)=>idx[c]=i);
  const g:(number|null)[][] = Array.from({length:COINS.length},()=>Array(COINS.length).fill(null));
  const { rows } = await pool.query(
    `SELECT base,quote,value FROM dyn_matrix_values WHERE matrix_type=$1 AND ts_ms=$2`,
    [kind, ts]
  );
  for (const r of rows) {
    const i = idx[r.base], j = idx[r.quote];
    if (i==null || j==null || i===j) continue;
    g[i][j] = Number(r.value);
  }
  return g;
}

function show(kind:string, ts:number, g:(number|null)[][]) {
  const rows = COINS.slice(0, limit), cols = COINS.slice(0, limit);
  console.log(`\n[${kind}] ts=${ts} sample ${limit}×${limit}`);
  console.log((" ".repeat(6)) + cols.map(c=> (c+"     ").slice(0,7)).join(" "));
  for (const r of rows) {
    const i = COINS.indexOf(r);
    const line = cols.map(c=>{
      const j = COINS.indexOf(c);
      const v = (i===j) ? null : g[i]?.[j];
      return (v==null ? "·" : Number(v).toFixed(5)).padStart(7);
    }).join(" ");
    console.log((r+"     ").slice(0,6) + " " + line);
  }
}

(async () => {
  try {
    for (const k of KINDS) {
      const ts = await latestTs(k);
      if (!ts) { console.log(`\n[${k}] ts=— (no data)`); continue; }
      const g = await grid(k, ts);
      show(k, ts, g);
    }
  } catch (e) {
    console.error("[matrix-sample] error", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
