// src/scripts/smokes/smoke-settings-doctor.mts
import "dotenv/config";
const origin = process.env.ORIGIN || "http://localhost:3000";
const doctorCookie = process.env.DOCTOR_COOKIE || null;

async function j(url: string, cookie?: string) {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (cookie) headers.Cookie = `appSettings=${encodeURIComponent(cookie)}`;
  const res = await fetch(url, { headers });
  const txt = await res.text();
  try { return { ok: res.ok, status: res.status, json: JSON.parse(txt) }; }
  catch { return { ok: res.ok, status: res.status, text: txt }; }
}

(async () => {
  console.log(`[doctor] origin=${origin}`);
  const a = await j(`${origin}/api/settings?debug=1`);
  const rawCookie = a?.json?.__debug?.rawCookie ?? doctorCookie ?? null;
  console.log("[doctor] /api/settings?debug=1", a.status, a.ok ? "OK" : "ERR");
  console.log(rawCookie ? "  cookie captured." : "  !! No cookie found.");

  const b = await j(`${origin}/api/settings`, rawCookie || undefined);
  console.log("[doctor] /api/settings (with cookie)", b.status, b.ok ? "OK" : "ERR");
  console.log("  coinUniverse:", b?.json?.settings?.coinUniverse);

  const m = await j(`${origin}/api/matrices/latest?debug=1`, rawCookie || undefined);
  console.log("[doctor] /api/matrices/latest?debug=1", m.status, m.ok ? "OK" : "ERR");
  console.log("  __debug:", m?.json?.__debug ?? m?.json ?? m?.text);
})();
