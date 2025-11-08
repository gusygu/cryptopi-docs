// src/scripts/smokes/xray.mjs
/* eslint-disable no-console */
import "../../src/scripts/env/load-env.cjs";
import { spawn } from "node:child_process";
import { Client } from "pg";

const base = process.env.BASE_URL || "http://localhost:3000";
const dburl = process.env.DATABASE_URL;
const schema = (process.env.DB_SCHEMA || "public").replace(/"/g, "");
const allowStrLatestSkip = process.env.SMOKE_ALLOW_STR_LATEST_FAIL === "1";

function run(script) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script], { stdio: "inherit" });
    p.on("close", (code) => resolve(code === 0));
  });
}
function row(ok, name, info = "") {
  const mark = ok ? "✓" : "✖";
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  console.log(`${mark} ${pad(name, 28)} ${info}`);
  return !!ok;
}

async function pingDb() {
  if (!dburl) return row(false, "db ping", "DATABASE_URL missing");
  const c = new Client({ connectionString: dburl });
  try {
    const t0 = Date.now();
    await c.connect();
    await c.query(`set search_path to "${schema}", public;`);
    await c.query("select 1");
    return row(true, "db ping", `${Date.now() - t0}ms`);
  } catch (e) {
    return row(false, "db ping", e?.message || e);
  } finally {
    try { await c.end(); } catch {}
  }
}

async function latency() {
  try {
    const t0 = Date.now();
    const r = await fetch(`${base}/api/vitals/health`);
    await r.text();
    return row(r.ok && (Date.now() - t0) < 1000, "health latency", `${Date.now() - t0}ms`);
  } catch (e) {
    return row(false, "health latency", e?.message);
  }
}

(async () => {
  console.log(`[xray] base=${base} schema=${schema} allowStrLatestSkip=${allowStrLatestSkip ? "1" : "0"}`);

  const r1 = await pingDb();
  const r2 = await latency();

  const r3 = await run("src/scripts/smokes/smoke-ui.mjs");
  const r4 = await run("src/scripts/smokes/smoke-features.mjs");

  const ok = r1 && r2 && r3 && r4;
  console.log(ok ? "✓ XRAY: all green" : "✖ XRAY: issues detected");
  if (!ok) process.exit(1);
})();
