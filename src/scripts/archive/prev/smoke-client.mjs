// src/scripts/smokes/smoke-client.mjs
/**
 * Usage:
 *  node --env-file=.env src/scripts/smokes/smoke-client.mjs
 */
import { env, banner, httpHTML, httpJSON, assert, logOK, logFAIL, logINFO, summaryExit } from "./smoke-lib.mjs";
const { BASE_URL } = env();

function looksHTML(ctype) {
  return (ctype || "").toLowerCase().includes("text/html");
}

async function run() {
  banner("CLIENT ENDPOINT EXPOSURE (pages + basic APIs)");

  const results = [];
  const pages = [
    // overall
    ["home /", `${BASE_URL}/`],
    ["info", `${BASE_URL}/info`],
    ["settings", `${BASE_URL}/settings`],
    // per project
    ["matrices", `${BASE_URL}/matrices`],
    ["str-aux", `${BASE_URL}/str-aux`],
    ["dynamics", `${BASE_URL}/dynamics`],
    // auth (optional render)
    ["auth root", `${BASE_URL}/(auth)`],
    ["auth login", `${BASE_URL}/(auth)/login`],
  ];

  try {
    for (const [name, url] of pages) {
      const t0 = Date.now();
      const res = await httpHTML(url);
      assert(res.ok, `page ${name} should be 200`);
      assert(looksHTML(res.ctype), `page ${name} should be HTML (got ${res.ctype})`);
      assert(res.text && res.text.length > 100, `page ${name} should have content`);
      results.push({ name: `page ${name}`, ok: true, ms: Date.now() - t0 });
      logOK(`Page ok → ${name}`, `(status=${res.status})`);
    }

    // quick API exposure check (200 + JSON parseable)
    const apis = [
      ["vitals/health", `${BASE_URL}/api/vitals/health`],
      ["matrices", `${BASE_URL}/api/matrices`],
      ["market/pairs", `${BASE_URL}/api/preview/universe/symbols`],
      ["cin-aux", `${BASE_URL}/api/cin-aux`],
      ["moo-aux", `${BASE_URL}/api/moo-aux`],
      ["str-aux/latest", `${BASE_URL}/api/str-aux/latest`],
    ];
    for (const [name, url] of apis) {
      const t0 = Date.now();
      const res = await httpJSON("GET", url);
      assert(res.ok && res.json, `${name} should be 200 + JSON`);
      results.push({ name: `api ${name}`, ok: true, ms: Date.now() - t0 });
      logOK(`API ok → ${name}`, `(status=${res.status})`);
    }

    logOK("Client exposure OK");
    summaryExit(results);
  } catch (e) {
    logFAIL("Client exposure", e);
    results.push({ name: "client exposure", ok: false, ms: 0 });
    summaryExit(results);
  }
}

run();

