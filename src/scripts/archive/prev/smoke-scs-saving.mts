// src/scripts/smokes/smoke-scs-saving.mts
import path from "node:path";
import url from "node:url";
import process from "node:process";

type Target = { file:string; exportName:string; spec:string; args?: any[] };

const DEFAULTS = [
  // args: (matrix_type, bases[], quote, grid[][], ts_ms)
  '@/core/pipelines/pipeline.db.ts:upsertMatrixGrid:{"__args__":["benchmark",["BTC","ETH"],"USDT",[[0,null],[null,0]],1234567890123]}',
  // args: (event)
  '@/core/db/ledger.ts:appendAppLedger:{"topic":"pipeline","event":"scissor-smoke","ts_epoch_ms":1234567890123}'
];

function ok(m:string){ console.log(`✔ ${m}`); }
function info(m:string){ console.log(`• ${m}`); }
function fail(m:string,e?:unknown){ console.error(`✖ ${m}${e?` — ${(e as any)?.message||e}`:""}`); }

function resolveAlias(pth:string){
  const root = process.cwd();
  if (pth.startsWith("@/")) return path.join(root,"src",pth.slice(2));
  if (pth.startsWith("src/")||pth.startsWith("./src/")) return path.join(root,pth.replace(/^\.\//,""));
  return path.isAbsolute(pth)?pth:path.join(root,pth);
}

function parse(argv:string[]):Target[]{
  const b64 = argv.find(a=>a.startsWith("--target-b64="))?.slice(13);
  const manual = b64
    ? [Buffer.from(b64, "base64").toString("utf8")]
    : argv.filter(a=>a.startsWith("--target=")).map(a=>a.slice(9));

  const specs = manual.length ? manual : DEFAULTS;
  return specs.map(spec=>{
    const i=spec.indexOf(":"); if(i<0) throw new Error(`bad spec: ${spec}`);
    const filePart=spec.slice(0,i); const rest=spec.slice(i+1);
    const j=rest.indexOf(":");
    const exportName=(j>=0?rest.slice(0,j):rest)||"default";
    let args:any[]|undefined;
    if (j>=0){
      const raw=rest.slice(j+1);
      const parsed = JSON.parse(raw);
      args = parsed && typeof parsed==="object" && Array.isArray(parsed.__args__) ? parsed.__args__ : [parsed];
    }
    return { file: resolveAlias(filePart), exportName, spec, args };
  });
}


async function runOne(t:Target){
  try{
    const mod = await import(url.pathToFileURL(t.file).href);
    const fn = t.exportName==="default"?mod?.default:mod?.[t.exportName];
    if (typeof fn!=="function"){ info(`skip ${t.spec} (export not a function)`); return { ok:true }; }
    const res = t.args? await fn(...t.args): await fn();
    ok(t.spec);
    if (res!==undefined){
      const brief = typeof res==="object"?JSON.stringify(res).slice(0,300):String(res);
      info(`  ↳ ${brief}${brief.length>=300?"…":""}`);
    }
    return { ok:true };
  }catch(e){ fail(t.spec,e); return { ok:false }; }
}

(async function main(){
  const targets = parse(process.argv.slice(2));
  let allOK = true;
  for (const t of targets){ const r = await runOne(t); allOK &&= r.ok; }
  process.exit(allOK?0:1);
})();
