// src/core/cin-aux/wallet-sync.ts
import crypto from "crypto";
import { ENV } from "../env"; // adjust relative path if needed
import { seedBalance, type SessionId } from "./service";

const BINANCE_BASE_URL = process.env.BINANCE_BASE_URL || "https://api.binance.com";

function sign(query: string) {
  const secret = ENV.EXCHANGE_API_SECRET ?? "";
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

async function signedGET(path: string, params: Record<string, string | number> = {}) {
  const key = ENV.EXCHANGE_API_KEY;
  if (!key) throw new Error("Missing EXCHANGE_API_KEY");
  if (!ENV.EXCHANGE_API_SECRET) throw new Error("Missing EXCHANGE_API_SECRET");

  const timestamp = Date.now();
  const usp = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k,v]) => [k, String(v)])), timestamp: String(timestamp) });
  // Optional: widen recvWindow if you hit -1021 (invalid timestamp)
  // usp.set('recvWindow', '5000');

  const signature = sign(usp.toString());
  usp.set("signature", signature);

  const res = await fetch(`${BINANCE_BASE_URL}${path}?${usp.toString()}`, {
    method: "GET",
    headers: { "X-MBX-APIKEY": key },
    // keep-alive default is fine; no body for GET
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Binance error ${res.status}: ${t}`);
  }
  return res.json();
}

export type WalletIngestResult = {
  sessionId: SessionId;
  assetsIngested: number;
  skippedZeroes: number;
};

export async function ingestSpotWalletIntoCin(sessionId: SessionId): Promise<WalletIngestResult> {
  // Shape: { balances: [{ asset, free, locked }, ...], ... }
  const account = await signedGET("/api/v3/account");

  let ingested = 0, skipped = 0;
  for (const b of account?.balances ?? []) {
    const free = Number(b.free ?? "0");
    const locked = Number(b.locked ?? "0");
    const total = free + locked;

    if (!Number.isFinite(total)) continue;
    if (total === 0) { skipped++; continue; }

    // Your cin_balance tracks principal/profit in **USDT** terms.
    // For wallet-only ingest (no pricing here), treat holdings as principal and set profit=0.
    // Later we can price assets into USDT before seeding if you want.
    await seedBalance(sessionId, String(b.asset), total /* openingPrincipalUSDT */);
    ingested++;
  }

  return { sessionId, assetsIngested: ingested, skippedZeroes: skipped };
}
