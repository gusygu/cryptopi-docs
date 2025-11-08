#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const appSessionId = process.env.APP_SESSION_ID || process.env.SESSION_ID || '';
const withSession = hdrs => (appSessionId ? { ...hdrs, 'x-session-id': appSessionId } : hdrs);

const LOG = (...a) => console.log('[smoke]', ...a);

const checks = [
  { name: 'health', path: '/api/health', expect: r => r.ok },
  { name: 'cin-aux index', path: '/api/aux/cin', expect: r => r.ok },
  { name: 'strategy-aux summary', path: '/api/aux/strategy/summary', expect: r => r.ok },
  { name: 'matrices list', path: '/api/matrices', expect: r => r.ok }
];

async function ping(name, url, opts = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { ...opts, headers: withSession(opts.headers || {}) });
  const dt = Math.round(performance.now() - t0);

  // Read once, then attempt JSON parse
  const raw = await res.text();
  let body = raw;
  try { body = JSON.parse(raw); } catch {}

  return { name, status: res.status, ok: res.ok, ms: dt, body };
}

(async () => {
  LOG(`base: ${baseUrl}  session: ${appSessionId ? 'set' : 'not set'}`);
  const results = [];
  for (const c of checks) {
    const url = `${baseUrl}${c.path}`;
    try {
      const r = await ping(c.name, url);
      const ok = c.expect(r) === true;
      results.push({ ...r, pass: ok });
      console.log(`${ok ? '✓' : '✖'} ${c.name}  ${r.status}  ${r.ms}ms`);
      if (!ok) {
        const preview = typeof r.body === 'string' ? r.body.slice(0, 400) : JSON.stringify(r.body)?.slice(0, 400);
        console.log('   → body:', preview);
      }
    } catch (e) {
      console.log(`✖ ${c.name}  error`, e?.message || e);
      results.push({ name: c.name, status: 0, ok: false, pass: false, ms: 0, body: String(e) });
    }
  }

  const fail = results.filter(r => !r.pass);
  if (fail.length) {
    console.log('\nSummary: some checks failed.');
    process.exit(1);
  } else {
    console.log('\nSummary: all checks passed.');
    process.exit(0);
  }
})();
