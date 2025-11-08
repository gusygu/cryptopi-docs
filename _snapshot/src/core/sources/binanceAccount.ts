/**
 * Signed-account adapter (no separate binanceClient.ts needed).
 * - GET /api/v3/account (SIGNED)
 * - Response hardening
 * - 40s result cache to align with project cycles
 */

import crypto from "crypto";
import { getWallet } from "@/lib/wallet/registry";

export type BalancesMap = Record<string, number>;

type QueryRecord = Record<string, string | number | undefined>;

type BinanceError = { code?: number; msg?: string };

type Credentials = { apiKey: string; apiSecret: string };

export type AccountOptions = {
  email?: string;
};

const BASE = process.env.BINANCE_BASE ?? "https://api.binance.com";
const ENV_API_KEY =
  process.env.BINANCE_API_KEY ??
  process.env.BINANCE_KEY ??
  "";
const ENV_API_SECRET =
  process.env.BINANCE_API_SECRET ??
  process.env.BINANCE_SECRET ??
  "";

const envCredentials: Credentials | null =
  ENV_API_KEY && ENV_API_SECRET ? { apiKey: ENV_API_KEY, apiSecret: ENV_API_SECRET } : null;

// ---- signed client (inlined) ------------------------------------------------

let timeSkewMs = 0; // serverTime - localTime; maintained automatically

function qs(params: QueryRecord): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, typeof v === "string" ? v : String(v)] as [string, string]);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const body: unknown = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const { msg, code } = (typeof body === "object" && body !== null ? (body as BinanceError) : {});
    const message = msg ?? (typeof body === "string" ? body : res.statusText);
    const err = new Error(`HTTP ${res.status}${code != null ? ` (${code})` : ""}: ${message}`);
    if (code != null) (err as Error & { code?: number }).code = code;
    throw err;
  }
  return body as T;
}

async function fetchServerTime(): Promise<number> {
  const url = new URL("/api/v3/time", BASE).toString();
  const j = await getJson<{ serverTime: number }>(url, { cache: "no-store" });
  return Number(j?.serverTime ?? Date.now());
}

function resolveCredentials(email?: string | null): Credentials | null {
  if (email) {
    const wallet = getWallet(email);
    if (wallet) return { apiKey: wallet.apiKey, apiSecret: wallet.apiSecret };
  }
  return envCredentials;
}

/**
 * Signed GET with automatic time-skew recovery (-1021).
 * Throws if API credentials are missing.
 */
async function signedGET<T>(path: string, query: QueryRecord = {}, creds: Credentials): Promise<T> {
  const recvWindow = Number(query.recvWindow ?? 5000);
  const timestamp = Date.now() + timeSkewMs;

  const baseParams = { ...query, recvWindow, timestamp };
  const payload = qs(baseParams);
  const sig = sign(payload, creds.apiSecret);

  const url = new URL(path, BASE);
  url.search = `${payload}&signature=${sig}`;

  const headers = { "X-MBX-APIKEY": creds.apiKey };

  try {
    return await getJson<T>(url.toString(), { headers, cache: "no-store" });
  } catch (error) {
    const err = error as Error & { code?: number };
    if (err.code === -1021 || /-1021/.test(String(err.message))) {
      try {
        const serverTime = await fetchServerTime();
        timeSkewMs = serverTime - Date.now();
      } catch {
        // ignore skew update errors; will rethrow original
      }
      const ts2 = Date.now() + timeSkewMs;
      const payload2 = qs({ ...query, recvWindow, timestamp: ts2 });
      const sig2 = sign(payload2, creds.apiSecret);
      const url2 = new URL(path, BASE);
      url2.search = `${payload2}&signature=${sig2}`;
      return await getJson<T>(url2.toString(), { headers, cache: "no-store" });
    }
    throw err;
  }
}

// ---- wallet facade (per-email cache) ---------------------------------------

const WALLET_TTL_MS = 40_000;
const cache = new Map<string, { at: number; data: BalancesMap }>();

function cacheKey(email?: string | null) {
  return email?.toLowerCase() ?? "__env__";
}

/** Clear wallet cache (optional: for tests/manual refresh) */
export function clearWalletCache(email?: string) {
  if (email) {
    cache.delete(cacheKey(email));
    return;
  }
  cache.clear();
}

/**
 * Returns a map: { ASSET -> free balance }, e.g. { BTC: 0.01, USDT: 123.45 }
 * Soft-fails to {} when credentials are missing or request fails.
 */
export async function getAccountBalances(options: AccountOptions = {}): Promise<BalancesMap> {
  const email = options.email?.toLowerCase() ?? null;
  const key = cacheKey(email);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < WALLET_TTL_MS) {
    return cached.data;
  }

  type AccountResp = {
    balances?: Array<{ asset?: string; free?: string; locked?: string }>;
  };

  const creds = resolveCredentials(email);
  if (!creds) {
    const scope = email ? `for ${email}` : "(env)";
    console.warn(`getAccountBalances: missing credentials ${scope}`);
    const empty: BalancesMap = {};
    cache.set(key, { at: now, data: empty });
    return empty;
  }

  try {
    const data = await signedGET<AccountResp>("/api/v3/account", {}, creds);
    const out: BalancesMap = {};
    const arr = Array.isArray(data?.balances) ? data.balances : [];
    for (const balance of arr) {
      const asset = String(balance.asset ?? "").trim();
      if (!asset) continue;
      const free = Number(balance.free);
      if (Number.isFinite(free)) out[asset] = free;
    }
    cache.set(key, { at: now, data: out });
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "wallet fetch failed");
    console.warn(`getAccountBalances: ${message}`);
    const empty: BalancesMap = {};
    cache.set(key, { at: now, data: empty });
    return empty;
  }
}

// Optional: export the signed helper if other modules need it in the future.
export const _internal = { signedGET, fetchServerTime, resolveCredentials };
