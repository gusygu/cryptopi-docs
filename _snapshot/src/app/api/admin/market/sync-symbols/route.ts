import { NextResponse } from "next/server";

import {
  resolveCoinUniverseSnapshot,
  syncCoinUniverseFromBinance,
} from "@/core/features/markets/coin-universe";

type SyncRequestPayload = {
  quote?: string;
  spotOnly?: boolean;
  coins?: string[];
  disableMissing?: boolean;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const toUpper = (value: string | null | undefined) =>
  String(value ?? "").trim().toUpperCase();

const parseBoolean = (value: string | null | undefined): boolean | undefined => {
  if (value == null) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
};

const sanitizeQuote = (value: string | null | undefined): string | undefined => {
  const upper = toUpper(value).replace(/[^A-Z0-9]/g, "");
  if (!upper) return undefined;
  return upper;
};

const sanitizeCoins = (values: string[] | undefined | null): string[] | undefined => {
  if (!values?.length) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const upper = toUpper(raw).replace(/[^A-Z0-9]/g, "");
    if (!upper || seen.has(upper)) continue;
    seen.add(upper);
    out.push(upper);
  }
  return out.length ? out : undefined;
};

const parseCoinsCSV = (value: string | null | undefined): string[] | undefined => {
  if (!value) return undefined;
  const tokens = value
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return sanitizeCoins(tokens);
};

function normalizePayload(value: unknown): SyncRequestPayload {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  return {
    quote: typeof raw.quote === "string" ? toUpper(raw.quote) : undefined,
    spotOnly: typeof raw.spotOnly === "boolean" ? raw.spotOnly : undefined,
    disableMissing:
      typeof raw.disableMissing === "boolean" ? raw.disableMissing : undefined,
    coins:
      Array.isArray(raw.coins) && raw.coins.every((item) => typeof item === "string")
        ? sanitizeCoins(raw.coins as string[])
        : undefined,
  };
}

function mergeQueryParams(url: URL, payload: SyncRequestPayload): SyncRequestPayload {
  const merged: SyncRequestPayload = { ...payload };

  const queryQuote = sanitizeQuote(url.searchParams.get("quote"));
  if (queryQuote !== undefined) merged.quote = queryQuote;

  const queryCoins = parseCoinsCSV(url.searchParams.get("coins"));
  if (queryCoins) merged.coins = queryCoins;

  const spotParam =
    parseBoolean(url.searchParams.get("spotOnly")) ??
    parseBoolean(url.searchParams.get("spot"));
  if (spotParam !== undefined) merged.spotOnly = spotParam;

  const disableParam = parseBoolean(url.searchParams.get("disableMissing"));
  if (disableParam !== undefined) merged.disableMissing = disableParam;

  const keepParam = parseBoolean(url.searchParams.get("keep"));
  if (keepParam !== undefined) merged.disableMissing = !keepParam;

  return merged;
}

const jsonHeaders = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const snapshot = await resolveCoinUniverseSnapshot();
    const summaryQuote = sanitizeQuote(url.searchParams.get("quote"));
    const summary = {
      coins: snapshot.coins.length,
      symbols: snapshot.symbols.length,
      rows: snapshot.rows.length,
      quote: summaryQuote,
    };
    return NextResponse.json(
      { ok: true, summary, data: snapshot },
      { status: 200, headers: jsonHeaders }
    );
  } catch (error) {
    console.error("[admin/market/sync-symbols] GET failed", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: jsonHeaders }
    );
  }
}

export async function POST(req: Request) {
  let payload: SyncRequestPayload = {};
  try {
    const body = await req.json();
    payload = normalizePayload(body);
  } catch {
    payload = {};
  }

  const merged = mergeQueryParams(new URL(req.url), payload);
  const options = {
    explicitCoins: merged.coins,
    quote: merged.quote,
    spotOnly: merged.spotOnly ?? true,
    disableMissing: merged.disableMissing ?? true,
  };

  try {
    const startedAt = Date.now();
    const result = await syncCoinUniverseFromBinance({
      explicitCoins: options.explicitCoins,
      quote: options.quote,
      spotOnly: options.spotOnly,
      disableMissing: options.disableMissing,
    });
    const durationMs = Date.now() - startedAt;
    const summary = {
      coins: result.coins.length,
      symbols: result.symbols.length,
      rows: result.rows.length,
      inserted: result.inserted,
      updated: result.updated,
      disabled: result.disabled,
      elapsedMs: durationMs,
      quote: options.quote ?? "AUTO",
      spotOnly: options.spotOnly ?? true,
      disableMissing: options.disableMissing ?? true,
      explicitCoins: options.explicitCoins ?? null,
    };
    return NextResponse.json(
      { ok: true, summary, data: result },
      { status: 200, headers: jsonHeaders }
    );
  } catch (error) {
    console.error("[admin/market/sync-symbols] POST failed", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: jsonHeaders }
    );
  }
}
