// src/scripts/smokes/smoke-apis-current.mjs
/* eslint-disable no-console */
import "../../src/scripts/env/load-env.cjs";

const base = process.env.BASE_URL || "http://localhost:3000";
const coinsEnv =
  (process.env.COINS || process.env.NEXT_PUBLIC_COINS || "BTC,ETH,USDT")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const session =
  process.env.NEXT_PUBLIC_APP_SESSION_ID ||
  process.env.APP_SESSION_ID ||
  "dev-session";

function row(ok, name, info = "") {
  const mark = ok ? "✓" : "✖";
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  console.log(`${mark} ${pad(name, 28)} ${info}`);
  return !!ok;
}
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const txt = await res.text();
  let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  return { ok: res.ok, status: res.status, data };
}
function pickPair(list) {
  const set = new Set(list);
  if (set.has("BTC") && set.has("USDT")) return ["BTC","USDT"];
  if (list.length >= 2) return [list[0], list[1]];
  return ["BTC","USDT"];
}

(async () => {
  console.log(`[apis-current] base=${base}  coins=${coinsEnv.join(",")}  session=${session}`);

  const results = [];

  // vitals
  try {
    const r = await getJson(`${base}/api/vitals/health`);
    results.push(row(r.ok && (typeof r.data === "string" || /ok/i.test(JSON.stringify(r.data))), "vitals health", `status ${r.status}`));
  } catch (e) {
    results.push(row(false, "vitals health", e?.message));
  }
  try {
    const r = await getJson(`${base}/api/vitals/status`);
    results.push(row(r.ok, "vitals status", `status ${r.status}`));
  } catch (e) {
    results.push(row(false, "vitals status", e?.message));
  }

  // matrices
  try {
    const r = await getJson(`${base}/api/matrices`);
    const ok = r.ok && r.status === 200;
    results.push(row(ok, "matrices", `status ${r.status}`));
  } catch (e) {
    results.push(row(false, "matrices", e?.message));
  }
  try {
    const r = await getJson(`${base}/api/matrices/latest`);
    const ok = r.ok && r.status === 200;
    results.push(row(ok, "matrices latest", `status ${r.status}`));
  } catch (e) {
    results.push(row(false, "matrices latest", e?.message));
  }

  // str-aux (on-demand run)
  try {
    const r = await getJson(`${base}/api/str-aux`);
    const ok = r.ok && r.status === 200; // returns a snapshot object (not wrapped with {ok:true})
    results.push(row(ok, "str-aux run", `status ${r.status}`));
  } catch (e) {
    results.push(row(false, "str-aux run", e?.message));
  }

  // str-aux latest (DB-backed)
  try {
    const [baseC, quoteC] = pickPair(coinsEnv.includes("USDT") ? coinsEnv : [...coinsEnv, "USDT"]);
    const url = `${base}/api/str-aux/latest?base=${baseC}&quote=${quoteC}&window=30m&session=${encodeURIComponent(session)}`;
    const r = await getJson(url);
    const ok = r.ok && r.status === 200 && typeof r.data === "object";
    results.push(row(ok, "str-aux latest", `status ${r.status}`));
  } catch (e) {
    results.push(row(false, "str-aux latest", e?.message));
  }

  // mea-aux (id_pct grid), k optional
  try {
    const coinsParam = coinsEnv.slice(0, Math.max(2, Math.min(8, coinsEnv.length))).join(",");
    const url = `${base}/api/mea-aux?coins=${encodeURIComponent(coinsParam)}&k=5`;
    const r = await getJson(url);
    const ok = r.ok && r.status === 200 && r.data && (r.data.ok === true || r.data.grid != null);
    results.push(row(ok, "mea-aux", `status ${r.status}`));
  } catch (e) {
    results.push(row(false, "mea-aux", e?.message));
  }

  // cin-aux (wallet & cycle/session imprint/luggage)
  try {
    const coinsParam = coinsEnv.slice(0, Math.max(2, Math.min(10, coinsEnv.length))).join(",");
    const url = `${base}/api/cin-aux?coins=${encodeURIComponent(coinsParam)}`;
    // route uses NEXT_PUBLIC_APP_SESSION_ID internally; we also pass header for good measure
    const r = await getJson(url, { "x-app-session-id": session });
    const ok = r.ok && r.status === 200 && r.data && (r.data.ok === true || r.data.rows != null);
    results.push(row(ok, "cin-aux", `status ${r.status}`));
  } catch (e) {
    results.push(row(false, "cin-aux", e?.message));
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  const allOk = passed === total;

  console.log(allOk ? `✓ apis-current passed ${passed}/${total}` : `✖ apis-current failed ${passed}/${total}`);
  if (!allOk) process.exit(1);
})();
