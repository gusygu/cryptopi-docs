// src/scripts/smokes/smoke-ui.mjs
/* eslint-disable no-console */
import "../../src/scripts/env/load-env.cjs";

const base = process.env.BASE_URL || "http://localhost:3000";
const session =
  process.env.NEXT_PUBLIC_APP_SESSION_ID ||
  process.env.APP_SESSION_ID ||
  "dev-session";

function row(ok, name, info = "") {
  const mark = ok ? "✓" : "✖";
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  console.log(`${mark} ${pad(name, 24)} ${info}`);
  return !!ok;
}

async function getText(url, headers = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { headers, redirect: "manual" });
  const txt = await res.text();
  const ms = Date.now() - t0;
  return { ok: res.ok, status: res.status, txt, ms };
}

(async () => {
  console.log(`[ui] base=${base}  session=${session}`);

  const out = [];

  // 1) Root HTML
  try {
    const r = await getText(`${base}/`, { "x-app-session-id": session });
    const ok = r.ok && /<!doctype html/i.test(r.txt) && /<html/i.test(r.txt);
    out.push(row(ok, "root html /", `status ${r.status} ${r.ms}ms`));
  } catch (e) { out.push(row(false, "root html /", e?.message)); }

  // 2) Vital endpoints as “SSR proxy”
  try {
    const r = await getText(`${base}/api/vitals/health`, { "x-app-session-id": session });
    out.push(row(r.ok, "vitals health", `status ${r.status} ${r.ms}ms`));
  } catch (e) { out.push(row(false, "vitals health", e?.message)); }

  try {
    const r = await getText(`${base}/api/vitals/status`, { "x-app-session-id": session });
    out.push(row(r.ok, "vitals status", `status ${r.status} ${r.ms}ms`));
  } catch (e) { out.push(row(false, "vitals status", e?.message)); }

  // 3) First paint latency budget (soft goal <1200ms)
  try {
    const r = await getText(`${base}/`, { "x-app-session-id": session });
    const ok = r.ms < 1200;
    out.push(row(ok, "first-paint budget", `${r.ms}ms`));
  } catch (e) { out.push(row(false, "first-paint budget", e?.message)); }

  const pass = out.filter(Boolean).length === out.length;
  console.log(pass ? "✓ smoke-ui passed" : "✖ smoke-ui failed");
  if (!pass) process.exit(1);
})();
