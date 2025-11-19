// src/lib/settings/server.ts
"use server";

import { cookies } from "next/headers";
import {
  fetchCoinUniverseBases,
  normalizeCoinList,
  recordSettingsCookieSnapshot,
  syncCoinUniverseFromBases,
} from "@/lib/settings/coin-universe";
import { DEFAULT_SETTINGS, migrateSettings, type AppSettings } from "./schema";

const COOKIE_KEY = "appSettings";
const LEGACY_COOKIE_KEYS = ["cp_settings_v1"];
const ONE_YEAR = 60 * 60 * 24 * 365;

function safeParseJSON(value: string | undefined | null): any | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function getAll(): Promise<AppSettings> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_KEY)?.value;
  const parsed = safeParseJSON(raw);
  const settings = migrateSettings(parsed ?? DEFAULT_SETTINGS);
  const dbCoins = await fetchCoinUniverseBases({ onlyEnabled: true });
  settings.coinUniverse = dbCoins.length ? dbCoins : normalizeCoinList(settings.coinUniverse);
  return settings;
}

export async function serializeSettingsCookie(nextValue: unknown): Promise<{
  settings: AppSettings;
  cookie: { name: string; value: string; options: Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2] };
}> {
  const current = await getAll();
  const merged = migrateSettings({ ...current, ...(nextValue as any) });

  const normalizedCoins = normalizeCoinList(merged.coinUniverse);
  await syncCoinUniverseFromBases(normalizedCoins);

  const normalized: AppSettings = {
    ...merged,
    coinUniverse: normalizedCoins,
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

  await recordSettingsCookieSnapshot(value);

  return { settings: normalized, cookie };
}

export async function setAll(nextValue: unknown): Promise<AppSettings> {
  const jar = await cookies();
  const { settings, cookie } = await serializeSettingsCookie(nextValue);
  jar.set(cookie.name, cookie.value, cookie.options);

  const mutable = jar as unknown as { delete?: (name: string) => void };
  if (mutable.delete) {
    for (const legacy of LEGACY_COOKIE_KEYS) {
      if (legacy !== cookie.name) mutable.delete(legacy);
    }
  }
  return settings;
}

export async function resolveCoinsFromSettings(): Promise<string[]> {
  const dbCoins = await fetchCoinUniverseBases({ onlyEnabled: true });
  if (dbCoins.length) return dbCoins;
  return normalizeCoinList(DEFAULT_SETTINGS.coinUniverse);
}
