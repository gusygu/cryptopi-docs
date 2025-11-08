// src/app/api/str-aux/request.ts
import { parseBins, parseWindow, type WindowKey } from "./utils";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const TOKEN_KEYS = ["pairs", "symbols", "coins"] as const;

export type StrAuxQuery = {
  tokens: string[];
  window: WindowKey;
  bins: number;
  allowUnverified: boolean;
  hideNoData: boolean;
  appSessionId: string;
};

export type SessionOptions = {
  defaultSessionId?: string;
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

function normalizeToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

function dedupePreserve(tokens: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens) {
    const token = normalizeToken(raw);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function parseFlag(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return TRUE_VALUES.has(raw.trim().toLowerCase());
}

export function collectTokens(url: URL): string[] {
  const collected: string[] = [];
  for (const key of TOKEN_KEYS) {
    const values = url.searchParams.getAll(key);
    if (!values.length) continue;
    for (const value of values) {
      const parts = value.split(/[,\s]+/);
      for (const part of parts) {
        if (!part) continue;
        collected.push(part);
      }
    }
  }
  return dedupePreserve(collected);
}

export function resolveSessionId(url: URL, { defaultSessionId }: SessionOptions = {}): string {
  const fallback = (defaultSessionId ?? process.env.APP_SESSION_ID ?? "ui").slice(0, 64);
  const raw = url.searchParams.get("sessionId") ?? url.searchParams.get("appSessionId");
  if (!raw) return fallback;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 64) : fallback;
}

export function parseStrAuxQuery(url: URL, options?: SessionOptions): StrAuxQuery {
  const tokens = collectTokens(url);
  const window = parseWindow(url.searchParams.get("window"));
  const bins = parseBins(url.searchParams.get("bins"), 128);
  const allowUnverified = parseFlag(url.searchParams.get("allowUnverified"));
  const hideNoData = parseFlag(url.searchParams.get("hideNoData"));
  const appSessionId = resolveSessionId(url, options);

  return {
    tokens,
    window,
    bins,
    allowUnverified,
    hideNoData,
    appSessionId,
  };
}

export function parseBaseQuote(url: URL, defaultQuote = "USDT") {
  const base = normalizeToken(url.searchParams.get("base"));
  const quote = normalizeToken(url.searchParams.get("quote")) ?? defaultQuote.toUpperCase();
  const pair = base ? `${base}${quote}` : null;
  return { base, quote, pair };
}

export function prependToken(tokens: string[], primary: string | null | undefined): string[] {
  const normalized = normalizeToken(primary);
  if (!normalized) return dedupePreserve(tokens);
  return dedupePreserve([normalized, ...tokens]);
}

export { NO_STORE };
