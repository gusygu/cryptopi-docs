// src/lib/settings/server.ts
"use server";

import { cookies } from "next/headers";
import { DEFAULT_SETTINGS, migrateSettings, type AppSettings } from "./schema";
import { normalizeCoin } from "../markets/pairs";

const COOKIE_KEY = "appSettings";
const LEGACY_COOKIE_KEYS = ["cp_settings_v1"];
const ONE_YEAR = 60 * 60 * 24 * 365;

// normalize list and guarantee USDT
function normCoins(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const coin = normalizeCoin(raw as string);
    if (!coin || seen.has(coin)) continue;
    seen.add(coin);
    out.push(coin);
  }
  if (!seen.has("USDT")) {
    seen.add("USDT");
    out.push("USDT");
  }
  return out;
}

function safeParseJSON(v: string | undefined | null): any | null {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

export async function getAll(): Promise<AppSettings> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_KEY)?.value;
  const parsed = safeParseJSON(raw);
  const s = migrateSettings(parsed ?? DEFAULT_SETTINGS);
  s.coinUniverse = normCoins(s.coinUniverse);
  return s;
}

export async function serializeSettingsCookie(nextValue: unknown): Promise<{
  settings: AppSettings;
  cookie: { name: string; value: string; options: Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2] };
}> {
  // Merge against current cookie so partial/stale payloads cannot wipe fields
  const current = await getAll();
  const merged = migrateSettings({ ...current, ...(nextValue as any) });

  const normalized: AppSettings = {
    ...merged,
    coinUniverse: normCoins(merged.coinUniverse),
  };

  const value = JSON.stringify(normalized);
  const cookie = {
    name: COOKIE_KEY,
    value,
    options: {
      httpOnly: false,
      sameSite: "lax" as const,
      path: "/",
      maxAge: ONE_YEAR,
    },
  };
  return { settings: normalized, cookie };
}

export async function setAll(nextValue: unknown): Promise<AppSettings> {
  const jar = await cookies();
  const { settings, cookie } = await serializeSettingsCookie(nextValue);
  jar.set(cookie.name, cookie.value, cookie.options);

  // cleanup legacy names
  const mutable = jar as unknown as { delete?: (name: string) => void };
  if (mutable.delete) {
    for (const legacy of LEGACY_COOKIE_KEYS) {
      if (legacy !== cookie.name) mutable.delete(legacy);
    }
  }
  return settings;
}

/** Convenience: normalized coin universe from the cookie. */
export async function resolveCoinsFromSettings(): Promise<string[]> {
  const s = await getAll();
  return s.coinUniverse.length ? s.coinUniverse : normCoins(DEFAULT_SETTINGS.coinUniverse);
}
