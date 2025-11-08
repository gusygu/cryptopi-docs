// src/scripts/smokes/smoke-orchestrator.ts
/**
 * Robust single-function smoke for executeCalcAndUpdateSession (orchestratorRun).
 * - Uses ORCH_PATH/ORCH_EXPORT/EXPECT_SIZE env vars
 * - Tries realistic argument shapes containing a minimal `snapshot`
 * - Optional ORCH_ARGS_JSON to pass your exact object (overrides attempts)
 * - Per-attempt timeout and clear diagnostics
 *
 * Run:
 *   pnpm run smoke:orchestrator
 *
 * Env (PowerShell examples):
 *   $env:ORCH_PATH='@/core/features/str-aux/calc/executive'
 *   $env:ORCH_EXPORT='executeCalcAndUpdateSession'
 *   $env:EXPECT_SIZE='64'
 *   # optional precise args:
 *   # $env:ORCH_ARGS_JSON='[{"snapshot":{"series":[]}}]'
 */

const EXPECT_SIZE = Number(process.env.EXPECT_SIZE ?? 64);
const ORCH_EXPORT = (process.env.ORCH_EXPORT ?? 'executeCalcAndUpdateSession').trim();
const ORCH_PATH = (process.env.ORCH_PATH ?? '').trim();

function sizeOf(x: any): number {
  if (Array.isArray(x)) return x.length;
  if (x && typeof x === 'object') return Object.keys(x).length;
  return 0;
}
function sampleOf(x: any, n = 8) {
  if (Array.isArray(x)) return x.slice(0, n);
  if (x && typeof x === 'object') return Object.keys(x).slice(0, n);
  return x;
}

async function withTimeout<T>(p: Promise<T>, ms = 10000): Promise<T> {
  let t: any;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms);
  });
  try {
    // race promise with timeout
    return (await Promise.race([p, timeout])) as T;
  } finally {
    clearTimeout(t);
  }
}

async function tryImport(modPath: string) {
  try {
    const mod = await import(modPath);
    return { mod, error: null as any };
  } catch (e: any) {
    return { mod: null as any, error: e };
  }
}

async function locateExport(): Promise<{ fn: Function; where: string } | null> {
  const queue = [ORCH_PATH].filter(Boolean);
  if (queue.length === 0) {
    console.error('[smoke] ORCH_PATH not set — please set it to your module path.');
    return null;
  }
  for (const modPath of queue) {
    const { mod, error } = await tryImport(modPath);
    if (!mod) {
      console.log(`[smoke] import failed for "${modPath}": ${error?.message || error}`);
      continue;
    }
    const fn = (mod as any)[ORCH_EXPORT];
    if (typeof fn === 'function') {
      return { fn, where: `${modPath}#${ORCH_EXPORT}` };
    }
    console.log(`[smoke] "${modPath}" imported but export "${ORCH_EXPORT}" not found. keys=`, Object.keys(mod));
  }
  return null;
}

function parseArgsFromEnv(): null | any[] {
  const raw = process.env.ORCH_ARGS_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Treat JSON as the FIRST arg only; supply as-is
    return [parsed];
  } catch (e: any) {
    console.error('[smoke] ORCH_ARGS_JSON is not valid JSON:', e?.message || e);
    process.exit(1);
  }
}

/** Minimal shapes that include a `snapshot` to avoid undefined access */
function buildAttempts(fn: Function): Array<() => any> {
  const now = Date.now();

  // Extremely minimal snapshot
  const snap0 = { t: now, series: [] as any[], coins: [], symbols: [] };

  // slightly richer: 64 placeholders (ids 0..63)
  const series64 = Array.from({ length: 64 }, (_, i) => ({ id: i }));
  const snap64 = { t: now, series: series64, coins: [], symbols: [] };

  // minimal "session-like" containers some codebases use
  const session0 = { snapshot: snap0, id: 'smoke', config: {}, meta: {} };
  const session64 = { snapshot: snap64, id: 'smoke', config: {}, meta: {} };

  // some functions are called with (session), some with ({snapshot}), some with ({session}), others with (session, opts)
  const shapes: Array<() => any> = [
    () => fn(session64),
    () => fn(session0),
    () => fn({ snapshot: snap64 }),
    () => fn({ snapshot: snap0 }),
    () => fn({ session: session64 }),
    () => fn({ session: session0 }),
    () => fn(session64, { dryRun: true }),
    () => fn(session0, { dryRun: true }),
  ];

  return shapes;
}

(async () => {
  console.log(`[smoke] target export: ${ORCH_EXPORT}, expected size: ${EXPECT_SIZE}`);
  if (ORCH_PATH) console.log(`[smoke] hint path via ORCH_PATH: ${ORCH_PATH}`);

  const found = await locateExport();
  if (!found) {
    console.error('[smoke] ❌ could not import target function. Check ORCH_PATH/EXPORT and alias resolution.');
    console.error('       If aliases fail, run script with: tsx --tsconfig-paths ...');
    process.exit(1);
  }
  console.log(`[smoke] using ${found.where}`);

  const envArgs = parseArgsFromEnv();
  const attempts = envArgs ? [() => found.fn(...envArgs)] : buildAttempts(found.fn);

  let ok = false;
  let lastErr: any = null;

  for (let i = 0; i < attempts.length; i++) {
    try {
      const maybe = attempts[i]();
      const out = await withTimeout(
        (maybe && typeof (maybe as any).then === 'function') ? (maybe as Promise<any>) : Promise.resolve(maybe),
        12000
      );
      const sz = sizeOf(out);
      console.log(`[smoke] attempt ${i + 1}/${attempts.length} → size=${sz}; sample=`, sampleOf(out));
      if (sz === EXPECT_SIZE) { console.log('[smoke] ✅ success'); ok = true; break; }
      console.log(`[smoke] ⚠️ expected ${EXPECT_SIZE}, got ${sz}`);
    } catch (e: any) {
      lastErr = e;
      console.log(`[smoke] attempt ${i + 1} error: ${e?.message || e}`);
    }
  }

  if (!ok) {
    if (lastErr) console.error('[smoke] last error:', lastErr);
    console.error('[smoke] ❌ did not reach expected size.');
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('[smoke] ❌ unhandled:', e);
  process.exit(1);
});
