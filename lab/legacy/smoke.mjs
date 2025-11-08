const base = process.env.SMOKE_BASE || "http://localhost:3000";

async function ping(path) {
  const url = base + path;
  const r = await fetch(url, { cache: "no-store" });
  const ok = r.ok;
  const txt = await r.text();
  console.log(`${ok ? "✓" : "✗"} GET ${path} -> ${r.status}`);
  if (!ok) {
    console.log(txt.slice(0, 240));
    process.exitCode = 1;
  }
}

const mode = (process.argv[2] || "").toLowerCase();

const pageJobs = ["/", "/dynamics", "/matrices", "/str-aux"];
const apiJobs = [
  "/api/matrices/latest",
  "/api/str-aux/bins?pairs=BTCUSDT,ETHUSDT&window=30m&bins=64&sessionId=smoke",
  "/api/cin-aux",
];

const jobs = mode === "pages" ? pageJobs : mode === "apis" ? apiJobs : [...pageJobs, ...apiJobs];
for (const p of jobs) await ping(p);
