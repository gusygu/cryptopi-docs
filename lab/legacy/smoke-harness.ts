// src/scripts/smokes/smoke-harness.ts
/**
 * Universal smoke harness (NDJSON output).
 * - Run one or many modules/exports
 * - Per-target args via config or one-off envs
 * - Tries shaped args (session/snapshot) if none provided
 * - EXPECT_SIZE check (default 64)
 *
 * ENV (one-off mode):
 *   MODULE='@/core/features/str-aux/calc/executive'
 *   EXPORT='executeCalcAndUpdateSession'          // optional; lists all callable exports if omitted (MODE=list)
 *   ARGS_JSON='[ { ...firstArg }, { ...secondArg } ]'  // array = the argument list
 *   EXPECT_SIZE=64
 *   MODE=list   // lists exports only
 *
 * ENV (config mode):
 *   HARNESS_CONFIG='src/scripts/smokes/smoke.config.json'
 */

type ArgShape = 'snapshot64' | 'session64' | 'snapshot0' | 'session0' | 'none';
const SHAPES: readonly ArgShape[] = ['session64','snapshot64','session0','snapshot0','none'] as const;

function isArgShape(x: unknown): x is ArgShape {
  return typeof x === 'string' && (SHAPES as readonly string[]).includes(x);
}
function normalizeShape(x: unknown): ArgShape | undefined { return isArgShape(x) ? x : undefined; }
function normalizeShapes(xs: unknown): ArgShape[] {
  if (Array.isArray(xs)) return xs.map(normalizeShape).filter(Boolean) as ArgShape[];
  const one = normalizeShape(xs); return one ? [one] : [];
}

type Target = {
  module: string;
  exports?: string[];
  expect_size?: number;
  args_json?: any[];           // exact argument list (array)
  args_shape?: ArgShape | ArgShape[] | string | string[];  // loose in JSON; normalized here
};

type Config = {
  defaults?: {
    expect_size?: number;
    attempt_shapes?: ArgShape[] | string[];
  };
  targets: Target[];
};

const MODE = (process.env.MODE ?? '').trim().toLowerCase();  // '' | 'list'
const HARNESS_CONFIG = (process.env.HARNESS_CONFIG ?? '').trim();
const ONE_MODULE = (process.env.MODULE ?? '').trim();
const ONE_EXPORT = (process.env.EXPORT ?? '').trim();
const RAW_ARGS = process.env.ARGS_JSON;
const ONE_EXPECT = process.env.EXPECT_SIZE ? Number(process.env.EXPECT_SIZE) : undefined;

function nowMs() { return Date.now(); }
function sizeOf(x: any) { if (Array.isArray(x)) return x.length; if (x && typeof x === 'object') return Object.keys(x).length; return 0; }
function sampleOf(x: any, n = 8) { if (Array.isArray(x)) return x.slice(0, n); if (x && typeof x === 'object') return Object.keys(x).slice(0, n); return x; }
function J(v: any) { return JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? String(val) : val)); }

function synthSnapshot(len = 64) {
  const series = Array.from({ length: len }, (_, i) => ({ id: i }));
  return { t: nowMs(), series, coins: [], symbols: [] };
}
function makeArgs(shape?: ArgShape): any[] {
  switch (shape) {
    case 'snapshot64': return [ { snapshot: synthSnapshot(64) } ];
    case 'session64':  return [ { id: 'smoke', config: {}, meta: {}, snapshot: synthSnapshot(64) } ];
    case 'snapshot0':  return [ { snapshot: synthSnapshot(0) } ];
    case 'session0':   return [ { id: 'smoke', config: {}, meta: {}, snapshot: synthSnapshot(0) } ];
    case 'none':       return [];
    default:           return [ { snapshot: synthSnapshot(64) } ];
  }
}

async function withTimeout<T>(p: Promise<T>, ms = 20000): Promise<T> {
  let t: any; const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms); });
  try { return await Promise.race([p, timeout]) as T; } finally { clearTimeout(t); }
}
async function dynImport(spec: string) {
  try { return { mod: await import(spec), error: null as any }; }
  catch (e: any) { return { mod: null as any, error: e }; }
}

function readConfig(): Config | null {
  if (!HARNESS_CONFIG) return null;
  const fs = require('node:fs');
  const txt = fs.readFileSync(HARNESS_CONFIG, 'utf8');
  const cfg = JSON.parse(txt) as Config;
  if (!cfg.targets || !Array.isArray(cfg.targets)) throw new Error('config.targets must be an array');
  return cfg;
}
function oneOffConfig(): Config | null {
  if (!ONE_MODULE) return null;
  let argsList: any[] | undefined;
  if (RAW_ARGS && RAW_ARGS.trim()) {
    const parsed = JSON.parse(RAW_ARGS);
    if (!Array.isArray(parsed)) throw new Error('ARGS_JSON must be a JSON array (argument list).');
    argsList = parsed;
  }
  return {
    defaults: { expect_size: ONE_EXPECT ?? 64, attempt_shapes: [...SHAPES] },
    targets: [{ module: ONE_MODULE, exports: ONE_EXPORT ? [ONE_EXPORT] : undefined, expect_size: ONE_EXPECT, args_json: argsList }]
  };
}

async function listExports(spec: string) {
  const { mod, error } = await dynImport(spec);
  if (!mod) { console.log(J({ type:'list', module: spec, ok:false, error: String(error?.message || error) })); return; }
  console.log(J({ type:'list', module: spec, ok:true, exports: Object.keys(mod) }));
}

async function runTarget(spec: string, exp: string | undefined, expectSize: number, argsList?: any[], attemptShapes?: ArgShape[]) {
  const { mod, error } = await dynImport(spec);
  if (!mod) { console.log(J({ type:'import', module: spec, export: exp, ok:false, error: String(error?.message || error) })); return; }
  if (MODE === 'list') { console.log(J({ type:'list', module: spec, ok:true, exports: Object.keys(mod) })); return; }

  const names = exp ? [exp] : Object.keys(mod).filter(k => typeof (mod as any)[k] === 'function');
  if (!names.length) { console.log(J({ type:'run', module: spec, ok:false, error:'no callable exports' })); return; }

  for (const name of names) {
    const fn = (mod as any)[name];
    if (typeof fn !== 'function') { console.log(J({ type:'run', module: spec, export: name, ok:false, error:'not a function' })); continue; }

    const shapes = attemptShapes && attemptShapes.length ? attemptShapes : [...SHAPES];
    const attempts: any[][] = argsList ? [argsList] : shapes.map(s => makeArgs(s));

    let passed = false; let lastErr: any = null;
    for (let i = 0; i < attempts.length; i++) {
      const args = attempts[i];
      const label = argsList ? 'custom' : shapes[i] ?? 'custom';
      try {
        const res = await withTimeout(Promise.resolve(fn(...args)), 20000);
        const sz = sizeOf(res);
        console.log(J({ type:'run', module: spec, export: name, attempt: i+1, args_shape: label, size: sz, sample: sampleOf(res), ok: sz === expectSize, expect: expectSize }));
        if (sz === expectSize) { passed = true; break; }
      } catch (e: any) {
        lastErr = e;
        console.log(J({ type:'run', module: spec, export: name, attempt: i+1, args_shape: label, ok:false, error: String(e?.message || e) }));
      }
    }
    console.log(J({ type:'summary', module: spec, export: name, ok: passed, error: passed ? undefined : String(lastErr?.message || lastErr) }));
  }
}

(async () => {
  let cfg: Config | null = null;
  try { cfg = readConfig() ?? oneOffConfig(); }
  catch (e: any) { console.error('[harness] config error:', e?.message || e); process.exit(1); }
  if (!cfg) { console.error('[harness] Set HARNESS_CONFIG or MODULE/EXPORT envs.'); process.exit(1); }

  const defaults = {
    expect_size: cfg?.defaults?.expect_size ?? 64,
    attempt_shapes: (normalizeShapes(cfg?.defaults?.attempt_shapes) ?? [...SHAPES]) as ArgShape[]
  };

  for (const t of cfg.targets) {
    if (!t?.module) { console.log(J({ type:'config', ok:false, error:'target without module' })); continue; }
    const perTargetShapes = t.args_shape ? normalizeShapes(t.args_shape) : undefined;
    const expect = t.expect_size ?? defaults.expect_size!;
    const exps = t.exports && t.exports.length ? t.exports : [undefined];

    for (const exp of exps) {
      await runTarget(t.module, exp as any, expect, t.args_json, perTargetShapes ?? defaults.attempt_shapes);
    }
  }
})();
