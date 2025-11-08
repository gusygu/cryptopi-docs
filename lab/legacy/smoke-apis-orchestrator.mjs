// src/scripts/smokes/smoke-apis-orchestrator.mjs
/**
 * API smoke: warmup health → probe orchestrator endpoints → expect 64 results.
 * Usage:
 *   node --env-file=.env src/scripts/smokes/smoke-apis-orchestrator.mjs
 */
const BASE = (process.env.BASE_URL || 'http://localhost:3000').trim();

const endpoints = [
  // canonical endpoint — point your route here:
  '/api/strategy-aux/orchestrator',

  // fallbacks if you still have them
  '/api/str-aux/orchestrator',
  '/api/strategy-aux/compose',
  '/api/str-aux/compose',
  '/api/strategy-aux/run',
  '/api/str-aux/run',
];

function sizeOf(x) {
  if (Array.isArray(x)) return x.length;
  if (x && typeof x === 'object') return Object.keys(x).length;
  return 0;
}
function sampleKeys(x, n = 8) {
  if (Array.isArray(x)) return x.slice(0, n);
  if (x && typeof x === 'object') return Object.keys(x).slice(0, n);
  return [];
}

async function fetchWithTimeout(url, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await res.json() : await res.text();
    return { status: res.status, body, ct };
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  console.log(`[smoke:api] base: ${BASE}`);

  // 1) Warmup health (optional route but recommended)
  try {
    const warm = await fetchWithTimeout(`${BASE}/api/vitals/health`, 3000);
    console.log(`- /api/vitals/health -> ${warm.status}`, warm.body);
    if (warm.status !== 200) {
      console.error('[smoke:api] ❌ server reachable but health not 200. aborting.');
      process.exit(1);
    }
  } catch (e) {
    console.error('[smoke:api] ❌ cannot reach server or health timed out:', e?.message || e);
    console.error('> Start dev server with: pnpm dev  (and check BASE_URL in .env)');
    process.exit(1);
  }

  // 2) Orchestrator probes
  let passed = false;
  for (const ep of endpoints) {
    const url = `${BASE}${ep}`;
    try {
      const { status, body, ct } = await fetchWithTimeout(url, 7000);
      if (status !== 200) {
        console.log(`- ${ep} -> ${status} (ct=${ct}) body=`, body);
        continue;
      }
      const data = typeof body === 'string' ? (() => { try { return JSON.parse(body); } catch { return body; } })() : body;
      const sz = sizeOf(data);
      console.log(`- ${ep} -> 200 size=${sz} ct=${ct} sample=`, sampleKeys(data));
      if (sz === 64) {
        console.log('[smoke:api] ✅ orchestrator returned 64 results');
        passed = true;
        break;
      } else {
        console.log(`[smoke:api] ⚠️ expected 64, got ${sz}`);
      }
    } catch (e) {
      console.log(`- ${ep} -> error: ${e?.name || ''} ${e?.message || e}`);
    }
  }

  if (!passed) {
    console.error('[smoke:api] ❌ no endpoint returned 64 results.');
    process.exit(1);
  }
})();
