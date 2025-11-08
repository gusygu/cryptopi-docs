// src/scripts/smokes/smoke-suite.mjs
/**
 * Suite runner: health → direct → API. Fails fast with clear codes.
 * Usage:
 *   node --env-file=.env src/scripts/smokes/smoke-suite.mjs
 */
import { spawn } from 'node:child_process';
const BASE = (process.env.BASE_URL || 'http://localhost:3000').trim();

function runNode(file) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--env-file=.env', file], { stdio: 'inherit' });
    p.on('close', (code) => resolve(code ?? 1));
  });
}

async function checkHealth() {
  const url = `${BASE}/api/vitals/health`;
  console.log(`[suite] health -> ${url}`);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.status !== 200) return 2;
    const j = await res.json().catch(() => ({}));
    console.log('[suite] health ok:', j);
    return 0;
  } catch (e) {
    console.error('[suite] ❌ health error:', e?.message || e);
    return 2;
  }
}

(async () => {
  // 1) health
  let code = await checkHealth();
  if (code !== 0) process.exit(code);

  // 2) direct
  console.log('\n[suite] running direct code smoke…');
  code = await runNode('src/scripts/smokes/smoke-orchestrator.mjs');
  if (code !== 0) process.exit(code);

  // 3) api
  console.log('\n[suite] running api smoke…');
  code = await runNode('src/scripts/smokes/smoke-apis-orchestrator.mjs');
  process.exit(code);
})();
