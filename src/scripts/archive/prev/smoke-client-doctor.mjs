// Client Doctor v2 (route discovery)
import process from "node:process";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").trim();

function ok(m){ console.log(`✔ ${m}`); }
function warn(m){ console.warn(`• ${m}`); }
function fail(m,e){ console.error(`✖ ${m} — ${e?.message||e}`); process.exit(1); }
function assert(c,m){ if(!c) throw new Error(m); }

async function getHTML(path){
  const url = `${BASE_URL}${path}`;
  const t0 = Date.now();
  const r = await fetch(url, { cache:"no-store" });
  const text = await r.text().catch(()=> "");
  const ctype = r.headers.get("content-type") || "";
  return { ok:r.ok, status:r.status, text, ms:Date.now()-t0, ctype, url };
}
async function getJSON(path){
  const url = `${BASE_URL}${path}`;
  const t0 = Date.now();
  const r = await fetch(url, { cache:"no-store" });
  let json=null; try{ json=await r.json(); }catch{}
  return { ok:r.ok, status:r.status, json, ms:Date.now()-t0, url };
}

async function checkAnyPage(){
  const pages = ["/","/home","/matrices","/str-aux","/dynamics","/settings","/info"];
  for (const p of pages) {
    const r = await getHTML(p);
    if (r.ok && (r.ctype||"").includes("text/html") && (r.text||"").length>50){
      ok(`PAGE ${p} (${r.ms}ms)`); return true;
    } else {
      warn(`PAGE ${p} not OK (status=${r.status})`);
    }
  }
  return false;
}

async function checkSomeAPIs(){
  const apis = ["/api/vitals/health","/api/vitals/status","/api/matrices/latest","/api/preview/universe/symbols","/api/moo-aux","/api/cin-aux","/api/str-aux/latest","/api/str-aux/matrix"];
  let any=false;
  for (const a of apis) {
    const r = await getJSON(a);
    if (r.ok && r.json!=null){ ok(`API ${a} (${r.ms}ms)`); any=true; }
    else warn(`API ${a} not OK (status=${r.status})`);
  }
  return any;
}

(async function main(){
  try{
    const pageOK = await checkAnyPage();
    assert(pageOK, "no client page responded 200 HTML");
    const apiOK = await checkSomeAPIs();
    assert(apiOK, "no API returned JSON 200");
    ok("Client Doctor ✓");
    process.exit(0);
  }catch(e){ fail("Client Doctor", e); }
})();

