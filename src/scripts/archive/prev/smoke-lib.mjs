// src/scripts/smokes/smoke-lib.mjs
/* Lightweight helper lib for smoke scripts */
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

let pg;
try { pg = await import("pg"); } 
catch { try { pg = require("pg"); } catch { pg = null; } }

const emoji = {
  ok: "✔",
  fail: "✖",
  skip: "⟲",
  info: "•",
};

export function env() {
  const BASE_URL = process.env.BASE_URL?.trim() || "http://localhost:3000";
  const DATABASE_URL = process.env.DATABASE_URL?.trim();
  const APP_SESSION_ID = process.env.APP_SESSION_ID?.trim() || "local-dev";
  return { BASE_URL, DATABASE_URL, APP_SESSION_ID };
}

export function banner(title) {
  console.log(`\n${"=".repeat(80)}\n${title}\n${"=".repeat(80)}`);
}

export async function httpJSON(method, url, body = undefined, headers = {}) {
  const started = Date.now();
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const elapsed = Date.now() - started;
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { ok: res.ok, status: res.status, json, ms: elapsed, url };
}

export async function httpHTML(url) {
  const started = Date.now();
  const res = await fetch(url, { cache: "no-store" });
  const elapsed = Date.now() - started;
  const text = await res.text();
  const ctype = res.headers.get("content-type") || "";
  return { ok: res.ok, status: res.status, text, ctype, ms: elapsed, url };
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function logOK(label, extra = "") {
  console.log(`${emoji.ok} ${label}${extra ? " " + extra : ""}`);
}
export function logFAIL(label, error) {
  console.error(`${emoji.fail} ${label} — ${error?.message || error}`);
}
export function logINFO(label, extra = "") {
  console.log(`${emoji.info} ${label}${extra ? " " + extra : ""}`);
}

export async function withPg(fn) {
  const { DATABASE_URL } = env();
  if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
  if (!pg) throw new Error("pg module not found. Install with: pnpm add -D pg");
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try { return await fn(client); }
  finally { await client.end(); }
}

export async function retry(label, maxTries, fn, waitMs = 600) {
  let lastErr;
  for (let i = 1; i <= maxTries; i++) {
    try { const out = await fn(i); logINFO(`${label} (try ${i}/${maxTries})`); return out; }
    catch (e) { lastErr = e; await delay(waitMs); }
  }
  throw lastErr;
}

export function summaryExit(summary) {
  const failed = summary.filter(s => !s.ok);
  if (failed.length) {
    console.log("\nResults:");
    summary.forEach(s => console.log(`${s.ok ? emoji.ok : emoji.fail} ${s.name} (${s.ms}ms)`));
    process.exit(1);
  } else {
    console.log("\nResults:");
    summary.forEach(s => console.log(`${emoji.ok} ${s.name} (${s.ms}ms)`));
    process.exit(0);
  }
}
