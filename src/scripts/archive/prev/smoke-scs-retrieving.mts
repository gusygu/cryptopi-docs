// src/scripts/smokes/smoke-scs-retrieving.mts
import path from "node:path";
import url from "node:url";
import process from "node:process";

type Target = { file:string; exportName:string; spec:string; args?: any[] };

const DEFAULTS = [
  '@/core/features/matrices/matricesLatest.ts:buildLatestPayload:{"coins":["BTC","ETH","SOL"]}'
];

function ok(m:string){ console.log(`✔ ${m}`); }
function info(m:string){ console.log(`• ${m}`); }
function fail(m:string,e?:unknown){ console.error(`✖ ${m}${e?` — ${(e as any)?.message||e}`:""}`); }
function resolveAlias(p:string){
  const root = process.cwd();
  if (p.startsWith("@/")) return path.join(root,"src",p.slice(2));
  if (p.startsWith("src/")||p.startsWith("./src/")) return path.join(root,p.replace(/^\.\//,""));
  return path.isAbsolute(p)?p:path.join(root,p);
}
function parse(argv:string[]):Target[]{
  const specs = argv.filter(a=>a.startsWith("--target=")).map(a=>a.slice(9));
  const list = specs.length?specs:DEFAULTS;
  return list.map(spec=>{
    const i=spec.indexOf(":"); if(i<0) throw new Error(`bad spec: ${spec}`);
    const file=resolveAlias(spec.slice(0,i));
    const rest=spec.slice(i+1);
    const j=rest.indexOf(":");
    const exportName=(j>=0?rest.slice(0,j):rest)||"default";
    let args:any[]|undefined;
    if (j>=0){
      const raw=rest.slice(j+1);
      const parsed = JSON.parse(raw);
      args = parsed && typeof parsed==="object" && Array.isArray(parsed.__args__) ? parsed.__args__ : [parsed];
    }
    return { file, exportName, spec, args };
  });
}
async function runOne(t:Target){
  try{
    const mod = await import(url.pathToFileURL(t.file).href);
    const fn = t.exportName==="default"?mod?.default:mod?.[t.exportName];
    if (typeof fn!=="function"){ info(`skip ${t.spec} (export not a function)`); return { ok:true }; }
    const res = t.args? await fn(...t.args): await fn();
    ok(t.spec);
    const brief = typeof res==="object"?JSON.stringify(res).slice(0,300):String(res);
    info(`  ↳ ${brief}${brief.length>=300?"…":""}`);
    return { ok:true };
  }catch(e){ fail(t.spec,e); return { ok:false }; }
}
(async function main(){
  const targets = parse(process.argv.slice(2));
  let allOK = true;
  for (const t of targets){ const r = await runOne(t); allOK &&= r.ok; }
  process.exit(allOK?0:1);
})();
