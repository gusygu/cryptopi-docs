// matrices client smoke (discovering page + API)
import process from "node:process";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").trim();
const OVERRIDE_PAGE = process.argv.find(x=>x.startsWith("--path="))?.split("=")[1];
const OVERRIDE_API  = process.argv.find(x=>x.startsWith("--api="))?.split("=")[1];

function ok(m){ console.log(`✔ ${m}`); }
function warn(m){ console.warn(`• ${m}`); }
function fail(m,e){ console.error(`✖ ${m} — ${e?.message||e}`); process.exit(1); }
function assert(c,m){ if(!c) throw new Error(m); }
async function getHTML(p){ const r = await fetch(`${BASE_URL}${p}`); return { ok:r.ok, status:r.status, text: await r.text().catch(()=>""), ctype:r.headers.get("content-type")||"" }; }
async function getJSON(p){ const r = await fetch(`${BASE_URL}${p}`); let j=null; try{ j=await r.json(); }catch{} return { ok:r.ok, status:r.status, json:j }; }

async function findPage(){
  const pages = [OVERRIDE_PAGE, "/matrices","/","/home"].filter(Boolean);
  for (const p of pages){ const r = await getHTML(p); if (r.ok && (r.ctype||"").includes("text/html")) return {p,r}; }
  return null;
}
async function findAPI(){
  const apis = [OVERRIDE_API, "/api/matrices/latest","/api/matrices","/api/matrices/server"].filter(Boolean);
  for (const a of apis){ const r = await getJSON(a); if (r.ok && r.json!=null) return {a,r}; }
  return null;
}

function looksItem(x){ return x && typeof x==="object" && typeof x.symbol==="string"; }

(async function main(){
  try{
    const page = await findPage();
    assert(page, "no matrices page available");
    ok(`PAGE ${page.p}`);

    const api = await findAPI();
    assert(api, "no matrices API available");
    const j = api.r.json;
    const valid = (Array.isArray(j) && j.length && looksItem(j[0])) || (j && typeof j==="object");
    assert(valid, "matrices payload invalid");
    ok(`API ${api.a}`);

    ok("Matrices client smoke ✓");
    process.exit(0);
  }catch(e){ fail("Matrices client smoke", e); }
})();
