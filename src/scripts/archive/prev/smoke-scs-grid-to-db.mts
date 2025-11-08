// src/scripts/smokes/smoke-scs-grid-to-db.mts
// Builds a tiny cross-rate grid from prices, writes via upsertMatrixGrid, verifies count.
// Usage (mocked prices):
//   pnpm smoke:scs:grid
// Usage (real Binance, requires net):
//   ALLOW_NET=1 pnpm smoke:scs:grid -- --bases BTC,ETH,SOL --quote USDT --type benchmark

import process from "node:process";
import path from "node:path";
import url from "node:url";

type PriceMap = Record<string, number>;

const ARG = new Map(process.argv.slice(2).flatMap(s=>{
  const m = s.match(/^--([^=]+)=(.*)$/); return m ? [[m[1], m[2]]] : [];
}) as any);

const BASES = (process.argv.find(a=>a.startsWith("--bases="))?.split("=")[1] || "BTC,ETH")
  .split(/[,\s]+/)                 // accept comma or spaces
  .map(s=>s.trim().toUpperCase())
  .filter(Boolean);
const QUOTE  = (ARG.get("quote") || "USDT").toUpperCase();
const MTYPE  = (ARG.get("type")  || "benchmark");
const TS_MS  = Number(ARG.get("ts") || Date.now());

function ok(m:string){ console.log(`✔ ${m}`); }
function info(m:string){ console.log(`• ${m}`); }
function fail(m:string,e?:unknown){ console.error(`✖ ${m}${e?` — ${(e as any)?.message||e}`:""}`); process.exit(1); }

function resolveAlias(p:string){
  const root = process.cwd();
  if (p.startsWith("@/")) return path.join(root,"src",p.slice(2));
  if (p.startsWith("src/")||p.startsWith("./src/")) return path.join(root,p.replace(/^\.\//,""));
  return path.isAbsolute(p)?p:path.join(root,p);
}

async function fetchPrices(): Promise<PriceMap> {
  // If ALLOW_NET=1, fetch real Binance 24hr lastPrice
  if (process.env.ALLOW_NET === "1") {
    const syms = BASES.map(b=>`${b}${QUOTE}`);
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(syms))}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`binance ${r.status}`);
    const arr = await r.json() as any[];
    const pm: PriceMap = {};
    for (const t of arr) {
      const p = Number(t.lastPrice ?? t.weightedAvgPrice ?? NaN);
      if (Number.isFinite(p)) pm[String(t.symbol)] = p;
    }
    return pm;
  }

  // Mocked stable prices (no network)
  const mock: PriceMap = {};
  for (const b of BASES) mock[`${b}${QUOTE}`] = 1000 + Math.random()*100; // simple distinct numbers
  return mock;
}

function buildGrid(prices: PriceMap, bases: string[], quote: string): (number|null)[][] {
  // grid[i][j] = price(base_i/quote) / price(base_j/quote)
  const p: Record<string, number|undefined> = {};
  for (const b of bases) p[b] = prices[`${b}${quote}`];
  return bases.map((bi, i) =>
    bases.map((bj, j) => {
      if (i === j) return 0; // diagonal convention in your saver
      const pi = p[bi]; const pj = p[bj];
      const v = (pi && pj) ? (pi / pj) : NaN;
      return Number.isFinite(v) ? v : null;
    })
  );
}

async function main(){
  try{
    // 1) prices → grid
    const prices = await fetchPrices();
    const grid = buildGrid(prices, BASES, QUOTE);
    const finite = grid.flat().filter(v => typeof v === "number" && Number.isFinite(v) && v !== 0).length;
    info(`grid cells: ${BASES.length}x${BASES.length}; finite off-diagonal cells=${finite}`);

    if (finite === 0) throw new Error("composed grid has no finite cells");

    // 2) write via your real upsertMatrixGrid
    const modDB = await import(url.pathToFileURL(resolveAlias("@/core/pipelines/pipeline.db.ts")).href);
    const upsertMatrixGrid = modDB?.upsertMatrixGrid;
    if (typeof upsertMatrixGrid !== "function") throw new Error("upsertMatrixGrid not found");

    const res = await upsertMatrixGrid(MTYPE, BASES, QUOTE, grid, TS_MS);
    ok(`upsertMatrixGrid(${MTYPE}, ${BASES.join(",")}/${QUOTE}, ts=${TS_MS})`);

    // 3) verify count
    const modRead = await import(url.pathToFileURL(resolveAlias("@/core/db/db.ts")).href);
    const countRowsAt = modRead?.countRowsAt;
    if (typeof countRowsAt !== "function") throw new Error("countRowsAt not found");

    const count = await countRowsAt(MTYPE, TS_MS);
    ok(`countRowsAt -> ${count}`);

    if (count <= 0) throw new Error("no rows written for this ts_ms — saver likely filtered everything");
    process.exit(0);
  } catch(e){ fail("grid-to-db", e); }
}

main();
