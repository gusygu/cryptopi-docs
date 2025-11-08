// src/scripts/smokes/smoke-scs-orchestrator.mts
import path from "node:path";
import url from "node:url";
import os from "node:os";
import fs from "node:fs/promises";
import process from "node:process";

type Target = { file:string; exportName:string; spec:string; args?: any[] };

const DEFAULT = '@/core/pipelines/pipeline.ts:runOrchestrator';

function ok(m:string){ console.log(`✔ ${m}`); }
function info(m:string){ console.log(`• ${m}`); }
function fail(m:string,e?:unknown){ console.error(`✖ ${m}${e?` — ${(e as any)?.message||e}`:""}`); }

function resolveAlias(p:string){
  const root = process.cwd();
  if (p.startsWith("@/")) return path.join(root,"src",p.slice(2));
  if (p.startsWith("src/")||p.startsWith("./src/")) return path.join(root,p.replace(/^\.\//,""));
  return path.isAbsolute(p)?p:path.join(root,p);
}
function parse(argv:string[]):Target{
  const b64 = argv.find(a=>a.startsWith("--target-b64="))?.slice(13);
  const specArg = b64
    ? Buffer.from(b64, "base64").toString("utf8")
    : (argv.find(a=>a.startsWith("--target="))?.slice(9) || DEFAULT);

  const spec = specArg;
  const i=spec.indexOf(":"); if(i<0) throw new Error(`bad spec: ${spec}`);
  const file=resolveAlias(spec.slice(0,i));
  const rest=spec.slice(i+1);
  const j=rest.indexOf(":");
  const exportName=(j>=0?rest.slice(0,j):rest)||"default";
  let args:any[]|undefined;
  if (j>=0){
    const raw=rest.slice(j+1);
    const parsed=JSON.parse(raw);
    args = parsed && typeof parsed==="object" && Array.isArray(parsed.__args__) ? parsed.__args__ : [parsed];
  }
  return { file, exportName, spec, args };
}

async function tryDirectImport(file:string){
  try { return await import(url.pathToFileURL(file).href); }
  catch (e) { return { __err: e }; }
}

async function importWithEsbuild(file:string){
  const { build } = await import('esbuild');
  const outdir = path.join(os.tmpdir(), 'scissor-orch');
  await fs.mkdir(outdir, { recursive: true });
  const outfile = path.join(outdir, 'pipeline.compiled.mjs');

  await build({
    entryPoints: [file],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    sourcemap: false,
    target: ['node22'],
    logLevel: 'silent',
    jsx: 'automatic',
    tsconfig: path.join(process.cwd(), 'tsconfig.json'),
    // be permissive with TS features
    supported: { 'const-enum': true },
  });

  return await import(url.pathToFileURL(outfile).href);
}

/** Fake fetch satisfying Binance adapter (24h + depth). */
function installMockFetch(){
  const json = (x:any)=>({ ok:true, status:200, json: async()=>x, text: async()=>JSON.stringify(x) }) as any;

  globalThis.fetch = (async (input: any) => {
    const u = typeof input==="string"? input : String(input?.url ?? "");
    if (u.includes("/api/v3/ticker/24hr")) {
      const m = u.match(/symbols=([^&]+)/);
      const syms = m ? JSON.parse(decodeURIComponent(m[1])) : ["BTCUSDT","ETHUSDT"];
      return json(syms.map((s:string)=>({ symbol:s, lastPrice:"100.0", priceChangePercent:"0.0", weightedAvgPrice:"100.0" })));
    }
    if (u.includes("/api/v3/depth")) return json({ lastUpdateId:1, bids:[["100","1"]], asks:[["101","1"]] });
    return json({ ok:true });
  }) as any;
}

async function runDefault(fn:Function, args?: any[]){
  installMockFetch();

  if (args && args.length) { await fn(...args); ok("runOrchestrator (custom args)"); return; }

  const now = Date.now();
  const settings = {
    matrices: { source:"binance", period:60000, persist:false, quote:"USDT", bases:["BTC","ETH","SOL"] },
    scales: { cycle: { period:60000 } }
  };
  const ctx = {
    settings,
    logger: {
      debug: (...a:any[]) => console.log("[debug]", ...a),
      info:  (...a:any[]) => console.log("[info]", ...a),
      warn:  (...a:any[]) => console.warn("[warn]", ...a),
      error: (...a:any[]) => console.error("[error]", ...a),
    }
  };
  async function* oneTick(){ yield { cycleTs: now - (now % 60000), periodMs:60000, reason:"manual" } as any; }
  const hooks = { subscribe: () => oneTick(), onCycleDone: ()=>{} };

  await fn(ctx, hooks);
  ok("runOrchestrator (mocked) ✓");
}

(async function main(){
  const t = parse(process.argv.slice(2));
  try{
    // 1) try direct import via tsx loader
    let mod: any = await tryDirectImport(t.file);
    if (mod?.__err) {
      info("direct import failed — compiling with esbuild…");
      mod = await importWithEsbuild(t.file);
    }
    const fn = t.exportName==="default"?mod?.default:mod?.[t.exportName];
    if (typeof fn!=="function") throw new Error(`export not a function: ${t.exportName}`);

    await runDefault(fn, t.args);
    process.exit(0);
  }catch(e){ fail(t.spec,e); process.exit(1); }
})();
