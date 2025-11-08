// src/scripts/smokes/smoke-features.mjs
/* eslint-disable no-console */
import "../../src/scripts/env/load-env.cjs";

const base = process.env.BASE_URL || "http://localhost:3000";
const coins =
  (process.env.COINS || process.env.NEXT_PUBLIC_COINS || "BTC,ETH,USDT")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const session =
  process.env.NEXT_PUBLIC_APP_SESSION_ID ||
  process.env.APP_SESSION_ID ||
  "dev-session";
const allowStrLatestSkip = process.env.SMOKE_ALLOW_STR_LATEST_FAIL === "1";

function row(ok, name, info = "") {
  const mark = ok ? "✓" : "✖";
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  console.log(`${mark} ${pad(name, 28)} ${info}`);
  return !!ok;
}
function skip(name, info = "") {
  console.log(`• ${name.padEnd(28)} ${info}`);
  return true; // not counted as failure
}
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const txt = await res.text();
  let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  return { ok: res.ok, status: res.status, data };
}
function pickPair(list) {
  const s = new Set(list);
  if (s.has("BTC") && s.has("USDT")) return ["BTC", "USDT"];
  if (list.length >= 2) return [list[0], list[1]];
  return ["BTC", "USDT"];
}

(async () => {
  console.log(`[features] base=${base} coins=${coins.join(",")} session=${session}`);

  const checks = [];

  // matrices
  try {
    const r = await getJson(`${base}/api/matrices`);
    checks.push(row(r.ok, "matrices", `status ${r.status}`));
  } catch (e) { checks.push(row(false, "matrices", e?.message)); }
  try {
    const r = await getJson(`${base}/api/matrices/latest`);
    checks.push(row(r.ok, "matrices latest", `status ${r.status}`));
  } catch (e) { checks.push(row(false, "matrices latest", e?.message)); }

  // str-aux (run)
  try {
    const r = await getJson(`${base}/api/str-aux`, { "x-app-session-id": session });
    checks.push(row(r.ok, "str-aux run", `status ${r.status}`));
  } catch (e) { checks.push(row(false, "str-aux run", e?.message)); }

  // str-aux latest (DB-backed) — known WIP
  try {
    const [b, q] = pickPair(coins.includes("USDT") ? coins : [...coins, "USDT"]);
    const u = `${base}/api/str-aux/latest?base=${b}&quote=${q}&window=30m&session=${encodeURIComponent(session)}`;
    const r = await getJson(u, { "x-app-session-id": session });
    if (r.status === 404 && allowStrLatestSkip) {
      checks.push(skip("str-aux latest", "api 404 (SKIP by SMOKE_ALLOW_STR_LATEST_FAIL=1)"));
    } else {
      checks.push(row(r.ok, "str-aux latest", `status ${r.status}`));
    }
  } catch (e) { checks.push(row(false, "str-aux latest", e?.message)); }

  // mea-aux
  try {
    const coinsParam = coins.slice(0, Math.max(2, Math.min(8, coins.length))).join(",");
    const u = `${base}/api/mea-aux?coins=${encodeURIComponent(coinsParam)}&k=5`;
    const r = await getJson(u, { "x-app-session-id": session });
    checks.push(row(r.ok, "mea-aux", `status ${r.status}`));
  } catch (e) { checks.push(row(false, "mea-aux", e?.message)); }

  // cin-aux
  try {
    const coinsParam = coins.slice(0, Math.max(2, Math.min(10, coins.length))).join(",");
    const u = `${base}/api/cin-aux?coins=${encodeURIComponent(coinsParam)}`;
    const r = await getJson(u, { "x-app-session-id": session });
    checks.push(row(r.ok, "cin-aux", `status ${r.status}`));
  } catch (e) { checks.push(row(false, "cin-aux", e?.message)); }

  // (optional) dynamics — enable if you have a route (kept tolerant)
  try {
    const r = await getJson(`${base}/api/dynamics`, { "x-app-session-id": session });
    if (r.status === 404) checks.push(skip("dynamics", "api 404 (skip)"));
    else checks.push(row(r.ok, "dynamics", `status ${r.status}`));
  } catch (e) { checks.push(skip("dynamics", e?.message)); }

  const passed = checks.filter(Boolean).length;
  const total = checks.length;
  const allOk = passed === total;
  console.log(allOk ? `✓ smoke-features passed ${passed}/${total}` : `✖ smoke-features failed ${passed}/${total}`);
  if (!allOk) process.exit(1);
})();
