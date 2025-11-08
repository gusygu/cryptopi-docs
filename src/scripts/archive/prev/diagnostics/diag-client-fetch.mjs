// Compact client fetch probe
// Run: node --env-file=.env src/scripts/smokes/diagnostics/diag-client-fetch.mjs

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const COMPACT = process.env.SMOKE_COMPACT !== "0";
const MAX_TXT = COMPACT ? 400 : 1200;

const ROUTES = [
  "/auth/session","/cin-aux","/converter/vm",
  "/market","/market/pairs","/market/preview","/market/preview/symbols",
  "/market/providers","/market/providers/binance/account/test","/market/providers/binance/preview","/market/providers/binance/wallet",
  "/market/sources","/market/ticker","/market/wallet",
  "/matrices","/matrices/latest",
  "/mea-aux",
  "/pipeline/auto","/pipeline/run-once",
  "/settings","/settings/wallet",
  "/str-aux","/str-aux/bins","/str-aux/latest","/str-aux/matrix",
  "/vitals","/vitals/health","/vitals/status",
];

const ENDPOINTS = ROUTES.map((r) => "/api" + r);

const round = (v) => (typeof v === "number" && Number.isFinite(v) ? +v.toFixed(3) : v);
const trimJSON = (obj) => {
  if (Array.isArray(obj)) return obj.slice(0, 5).map(trimJSON);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const k of Object.keys(obj).slice(0, 8)) out[k] = trimJSON(obj[k]);
    return out;
  }
  return round(obj);
};

async function probe(path) {
  const url = `${BASE}${path}`;
  const t0 = performance.now();
  try {
    const r = await fetch(url);
    const ms = +(performance.now() - t0).toFixed(1);
    const ct = r.headers.get("content-type") || "";
    let size = 0, sample = null;
    if (ct.includes("application/json")) {
      const j = await r.json();
      size = JSON.stringify(j).length;
      sample = trimJSON(j);
    } else {
      const txt = await r.text();
      size = txt.length;
      sample = txt.slice(0, MAX_TXT);
    }
    return { p: path, s: r.status, ok: r.ok, ms, len: size, smp: sample };
  } catch (e) {
    return { p: path, err: String(e?.message || e) };
  }
}

(async () => {
  const res = [];
  for (const e of ENDPOINTS) res.push(await probe(e));
  console.log(JSON.stringify({ at: new Date().toISOString(), base: BASE, compact: COMPACT, res }));
})().catch((e) => { console.error(e); process.exit(1); });
