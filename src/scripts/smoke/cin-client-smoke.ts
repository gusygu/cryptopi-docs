import "dotenv/config";

const baseUrl = process.env.CIN_SMOKE_BASE_URL ?? "http://localhost:3000";
const sessionId = Number(
  process.env.CIN_SMOKE_SESSION_ID ??
    process.env.CIN_RUNTIME_SESSION_ID ??
    "",
);
if (!Number.isFinite(sessionId) || sessionId <= 0) {
  throw new Error("Set CIN_SMOKE_SESSION_ID (or CIN_RUNTIME_SESSION_ID) to test client endpoints.");
}

async function fetchJson(path: string) {
  const res = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${path} HTTP ${res.status}`);
  }
  return res.json();
}

async function run() {
  console.log(`[cin-client-smoke] Fetching runtime balances for session ${sessionId}…`);
  const balances = await fetchJson(
    `/api/cin-aux/runtime/sessions/${sessionId}/balances`,
  );
  console.log("[cin-client-smoke] assets returned:", balances?.assets?.length ?? 0);

  console.log("[cin-client-smoke] Fetching runtime moves…");
  const moves = await fetchJson(
    `/api/cin-aux/runtime/sessions/${sessionId}/moves`,
  );
  console.log("[cin-client-smoke] moves returned:", Array.isArray(moves) ? moves.length : 0);
}

void run();
