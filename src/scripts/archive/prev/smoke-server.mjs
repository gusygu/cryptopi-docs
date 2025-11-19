// src/scripts/smokes/smoke-server.mjs
/**
 * Usage:
 *  node --env-file=.env src/scripts/smokes/smoke-server.mjs save
 *  node --env-file=.env src/scripts/smokes/smoke-server.mjs retrieve
 *  node --env-file=.env src/scripts/smokes/smoke-server.mjs pipeline
 *  node --env-file=.env src/scripts/smokes/smoke-server.mjs all
 */
import { env, banner, httpJSON, withPg, assert, logOK, logFAIL, logINFO, retry, summaryExit } from "./smoke-lib.mjs";

const { BASE_URL, APP_SESSION_ID } = env();

async function pipelineSuite() {
  banner("SERVER PIPELINE");
  const results = [];

  try {
    const h = await httpJSON("GET", `${BASE_URL}/api/vitals/health`);
    assert(h.ok, "/api/vitals/health should be 200");
    results.push({ name: "vitals/health", ok: true, ms: h.ms });

    const s = await httpJSON("GET", `${BASE_URL}/api/vitals/status`);
    assert(s.ok && s.json, "/api/vitals/status should be 200 with json");
    results.push({ name: "vitals/status", ok: true, ms: s.ms });

    const run = await httpJSON("POST", `${BASE_URL}/api/pipeline/run-once`);
    assert(run.ok && run.json, "pipeline/run-once should be 200 with json");
    results.push({ name: "pipeline/run-once POST", ok: true, ms: run.ms });

    const autoStart = await httpJSON("GET", `${BASE_URL}/api/pipeline/auto`);
    assert(autoStart.ok && autoStart?.json?.running === true, "pipeline/auto GET should start");
    results.push({ name: "pipeline/auto start", ok: true, ms: autoStart.ms });

    const autoStop = await httpJSON("DELETE", `${BASE_URL}/api/pipeline/auto`);
    assert(autoStop.ok && autoStop?.json?.running === false, "pipeline/auto DELETE should stop");
    results.push({ name: "pipeline/auto stop", ok: true, ms: autoStop.ms });

    logOK("Pipeline suite OK");
  } catch (e) {
    logFAIL("Pipeline suite", e);
    results.push({ name: "pipeline suite", ok: false, ms: 0 });
  }
  summaryExit(results);
}

async function saveSuite() {
  banner("SERVER DB PER PROJECT — SAVING");
  const results = [];

  try {
    // trigger a single build+persist cycle
    const run = await httpJSON("POST", `${BASE_URL}/api/pipeline/run-once`);
    assert(run.ok, "pipeline/run-once must succeed");
    results.push({ name: "trigger persist", ok: true, ms: run.ms });

    // give the server a breath to commit
    await new Promise(r => setTimeout(r, 500));

    // verify rows in each project scope
    await withPg(async (db) => {
      const checks = [
        // matrices
        ["dyn_matrix_values", `SELECT COUNT(*)::int AS c FROM dyn_matrix_values WHERE ts_ms > (EXTRACT(EPOCH FROM now())*1000 - 3600_000)`],
        // moo-aux
        ["mea_orientations", `SELECT COUNT(*)::int AS c FROM mea_orientations`],
        // cin-aux
        ["cin_aux_cycle", `SELECT COUNT(*)::int AS c FROM cin_aux_cycle`],
        ["cin_aux_session_acc", `SELECT COUNT(*)::int AS c FROM cin_aux_session_acc`],
        // str-aux (schema-qualified)
        ["strategy_aux.str_aux_session", `SELECT COUNT(*)::int AS c FROM strategy_aux.str_aux_session WHERE app_session_id = $1`, [APP_SESSION_ID]],
      ];

      for (const [name, sql, params] of checks) {
        const t0 = Date.now();
        const row = await retry(`query ${name}`, 3, async () => {
          const res = await db.query(sql, params || []);
          return res.rows?.[0];
        }, 400);
        const count = row?.c ?? 0;
        assert(count > 0, `${name} should have rows (>0), got ${count}`);
        results.push({ name: `db save: ${name}`, ok: true, ms: Date.now() - t0 });
        logOK(`DB save ok → ${name}`, `(count=${count})`);
      }
    });

    logOK("Server DB saving OK");
  } catch (e) {
    logFAIL("Server DB saving", e);
    results.push({ name: "server db saving", ok: false, ms: 0 });
  }
  summaryExit(results);
}

async function retrieveSuite() {
  banner("SERVER DB PER PROJECT — RETRIEVING (API SHAPES)");
  const results = [];
  const endpoints = [
    ["matrices/latest", `${BASE_URL}/api/matrices/latest`],
    ["matrices (server)", `${BASE_URL}/api/matrices/server`],
    ["cin-aux", `${BASE_URL}/api/cin-aux`],
    ["moo-aux", `${BASE_URL}/api/moo-aux`],
    ["str-aux/latest", `${BASE_URL}/api/str-aux/latest`],
    ["str-aux/matrix", `${BASE_URL}/api/str-aux/matrix`],
    ["market/pairs", `${BASE_URL}/api/preview/universe/symbols`],
    ["vitals/status", `${BASE_URL}/api/vitals/status`],
  ];

  try {
    for (const [name, url] of endpoints) {
      const t0 = Date.now();
      const res = await httpJSON("GET", url);
      assert(res.ok, `${name} should be 200`);
      assert(res.json, `${name} should return JSON`);
      results.push({ name: `api ${name}`, ok: true, ms: Date.now() - t0 });
      logOK(`API ok → ${name}`, `(status=${res.status})`);
    }
    logOK("Server DB retrieving OK");
  } catch (e) {
    logFAIL("Server DB retrieving", e);
    results.push({ name: "server db retrieving", ok: false, ms: 0 });
  }
  summaryExit(results);
}

const mode = (process.argv[2] || "all").toLowerCase();
if (mode === "save") await saveSuite();
else if (mode === "retrieve") await retrieveSuite();
else if (mode === "pipeline") await pipelineSuite();
else if (mode === "all") {
  // run all three in sequence but keep single exit code at end
  const combined = [];
  for (const fn of [saveSuite, retrieveSuite, pipelineSuite]) {
    try { await fn(); } catch { /* each suite handles exit */ }
  }
} else {
  console.error("Unknown mode. Use: save | retrieve | pipeline | all");
  process.exit(2);
}

