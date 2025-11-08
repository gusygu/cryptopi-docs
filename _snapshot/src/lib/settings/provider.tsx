// src/lib/settings/provider.tsx
"use client";

import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings } from "./schema";
import {
  DEFAULT_SETTINGS,
  AppSettings as makeAppSettings,   // <-- factory (from schema.ts)
  mergeAppSettings,                 // <-- deep-partial merge + migrate
  normalizeCoinUniverse,            // <-- uppercase + dedupe + ensure USDT
} from "./schema";
import { fetchClientSettings } from "./client";

const STORAGE_KEY = "appSettings";

type ProviderCtx = {
  settings: AppSettings;

  /** Replace all settings (persists to cookie and localStorage). */
  setAll(next: AppSettings): Promise<void>;

  /** Patch some settings keys (persists). */
  update(patch: Partial<AppSettings>): Promise<void>;

  /** Re-pull from cookie + localStorage. */
  reload(): void;

  // Focused helpers (mirror schema.ts shape):
  setCoinUniverse(coins: string[]): Promise<void>;
  addCoins(coins: string[] | string): Promise<void>;
  removeCoins(coins: string[] | string): Promise<void>;

  setProfile(patch: Partial<AppSettings["profile"]>): Promise<void>;
  setTiming(patch: Partial<AppSettings["timing"]>): Promise<void>;
  setClusters(clusters: AppSettings["clustering"]["clusters"]): Promise<void>;
  setParamValues(values: Partial<AppSettings["params"]["values"]>): Promise<void>;

  /** Reset to DEFAULT_SETTINGS (keeping current profile.email if present). */
  resetDefaults(): Promise<void>;
};

const SettingsCtx = createContext<ProviderCtx>({
  settings: DEFAULT_SETTINGS,
  async setAll() {},
  async update() {},
  reload() {},
  async setCoinUniverse() {},
  async addCoins() {},
  async removeCoins() {},
  async setProfile() {},
  async setTiming() {},
  async setClusters() {},
  async setParamValues() {},
  async resetDefaults() {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // Initial hydration (localStorage → cookie fetch), plus cross-tab sync
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings(makeAppSettings(JSON.parse(raw)));
    } catch {}
    (async () => {
      try {
        const remote = await fetchClientSettings();
        setSettings(remote);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
      } catch {}
    })();

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setSettings(makeAppSettings(JSON.parse(e.newValue)));
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persistRoundTrip = useCallback(async (clean: AppSettings) => {
    // local copy first
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    setSettings(clean);

    // server cookie
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: clean }),
        cache: "no-store",
      });
      // If server normalized anything, re-pull to match SSR cookie exactly
      if (res.ok) {
        const refreshed = await fetchClientSettings();
        setSettings(refreshed);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
      }
    } catch {}

    // Broadcast legacy custom events used elsewhere in the app
    window.dispatchEvent(new CustomEvent("app-settings:updated", { detail: clean }));
    window.dispatchEvent(new CustomEvent("app-settings:coins-changed", { detail: { coins: clean.coinUniverse } }));
    window.dispatchEvent(new CustomEvent("app-settings:clusters-changed", { detail: clean.clustering }));
    window.dispatchEvent(new CustomEvent("app-settings:timing-changed", { detail: clean.timing }));
    window.dispatchEvent(new CustomEvent("app-settings:params-changed", { detail: clean.params }));
  }, []);

  const setAll = useCallback(async (next: AppSettings) => {
    const clean = makeAppSettings(next);
    await persistRoundTrip(clean);
  }, [persistRoundTrip]);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    // merge & migrate via schema helper
    const clean = mergeAppSettings(settings, patch);
    await persistRoundTrip(clean);
  }, [settings, persistRoundTrip]);

  const reload = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings(makeAppSettings(JSON.parse(raw)));
    } catch {}
    (async () => {
      try {
        const remote = await fetchClientSettings();
        setSettings(remote);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
      } catch {}
    })();
  }, []);

  // ---- Focused helpers (map cleanly to schema.ts areas) ----
  const setCoinUniverse = useCallback(async (coins: string[]) => {
    await update({ coinUniverse: normalizeCoinUniverse(coins) });
  }, [update]);

  const addCoins = useCallback(async (coins: string[] | string) => {
    const add = Array.isArray(coins) ? coins : [coins];
    const merged = normalizeCoinUniverse([...(settings.coinUniverse || []), ...add]);
    await update({ coinUniverse: merged });
  }, [settings.coinUniverse, update]);

  const removeCoins = useCallback(async (coins: string[] | string) => {
    const rm = new Set(Array.isArray(coins) ? coins.map(c => String(c).toUpperCase()) : [String(coins).toUpperCase()]);
    const kept = (settings.coinUniverse || []).filter(c => !rm.has(String(c).toUpperCase()));
    await update({ coinUniverse: normalizeCoinUniverse(kept) });
  }, [settings.coinUniverse, update]);

  const setProfile = useCallback(async (patch: Partial<AppSettings["profile"]>) => {
    await update({ profile: { ...settings.profile, ...patch } });
  }, [settings.profile, update]);

  const setTiming = useCallback(async (patch: Partial<AppSettings["timing"]>) => {
    await update({ timing: { ...settings.timing, ...patch } });
  }, [settings.timing, update]);

  const setClusters = useCallback(async (clusters: AppSettings["clustering"]["clusters"]) => {
    await update({ clustering: { clusters } });
  }, [update]);

  const setParamValues = useCallback(async (values: Partial<AppSettings["params"]["values"]>) => {
    const merged = { ...settings.params.values, ...values };
    const filtered: Record<string, number> = Object.fromEntries(
      Object.entries(merged).filter(([_, v]) => v !== undefined)
    ) as Record<string, number>;
    await update({ params: { values: filtered } });
  }, [settings.params.values, update]);

  const resetDefaults = useCallback(async () => {
    // keep current email if present, then rebuild via factory
    const base = makeAppSettings({
      ...DEFAULT_SETTINGS,
      profile: { ...DEFAULT_SETTINGS.profile, email: settings.profile.email || "" },
    });
    await setAll(base);
  }, [settings.profile.email, setAll]);

  const value = useMemo<ProviderCtx>(() => ({
    settings,
    setAll,
    update,
    reload,
    setCoinUniverse,
    addCoins,
    removeCoins,
    setProfile,
    setTiming,
    setClusters,
    setParamValues,
    resetDefaults,
  }), [
    settings, setAll, update, reload,
    setCoinUniverse, addCoins, removeCoins,
    setProfile, setTiming, setClusters, setParamValues, resetDefaults
  ]);

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  return React.useContext(SettingsCtx);
}
