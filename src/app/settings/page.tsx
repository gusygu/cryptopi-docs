// src/app/settings/page.tsx
// Settings: Universe & Engine • Timing • Profile • Binance Link • Wallets

import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import BinanceLinkCard from "@/components/settings/BinanceLinkCard";
import { getAll as getAppSettings, setAll as setAppSettings } from "@/lib/settings/server";
import { DEFAULT_SETTINGS, normalizeCoinUniverse } from "@/lib/settings/schema";
import { syncCoinUniverseFromBinance } from "@/core/features/markets/coin-universe";
import {
  getUserSettings,
  setUserSettings,
  upsertWallet,
  removeWallet,
  type UserSettings,
  type Wallet,
} from "@/lib/settings/store";
import { requireUserSession } from "@/app/(server)/auth/session";
// ---------- helpers ----------
const DEV_SESSION_EMAIL =
  process.env.NEXT_PUBLIC_DEV_SESSION_EMAIL ||
  process.env.DEV_SESSION_EMAIL ||
  (process.env.NODE_ENV !== "production" ? "demo@local.dev" : "");

function ensureLoginEmail(sessionVal: string | undefined | null): string {
  const raw = sessionVal || "";
  const email = raw.split("|")[0]?.trim();
  if (email) return email.toLowerCase();
  if (DEV_SESSION_EMAIL) return String(DEV_SESSION_EMAIL).toLowerCase();
  redirect("/auth?err=login+required");
}

function safeNum(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function safeBool(v: unknown, def: boolean): boolean {
  if (v === "on" || v === true || v === "true") return true;
  if (v === "off" || v === false || v === "false") return false;
  return def;
}

function validateWallet(w: Wallet): string | null {
  if (!w.symbol || !/^[A-Z0-9]{2,10}$/.test(w.symbol)) return "Invalid symbol.";
  if (!w.address || w.address.length < 8 || w.address.length > 128) return "Address length seems invalid.";
  if (w.network && !/^[A-Za-z0-9\-]{2,16}$/.test(w.network)) return "Invalid network tag.";
  return null;
}

// ---------- server actions ----------
export async function saveProfileAction(form: FormData): Promise<void> {
  "use server";
  const jar = await cookies();
  const email = ensureLoginEmail(jar.get("session")?.value);

  const nickname = String(form.get("nickname") || "").trim();
  const timezone = String(form.get("timezone") || "").trim();
  const language = String(form.get("language") || "").trim();

  setUserSettings(email, { profile: { nickname, timezone, language } });
  redirect("/settings?ok=profile");
}

export async function addWalletAction(form: FormData): Promise<void> {
  "use server";
  const jar = await cookies();
  const email = ensureLoginEmail(jar.get("session")?.value);

  const wallet: Wallet = {
    id: crypto.randomUUID(),
    label: String(form.get("label") || "").trim(),
    symbol: String(form.get("symbol") || "").trim().toUpperCase(),
    network: String(form.get("network") || "").trim(),
    address: String(form.get("address") || "").trim(),
  };

  const err = validateWallet(wallet);
  if (err) redirect(`/settings?err=${encodeURIComponent(err)}`);

  upsertWallet(email, wallet);
  redirect("/settings?ok=wallet_added");
}

export async function deleteWalletAction(form: FormData): Promise<void> {
  "use server";
  const jar = await cookies();
  const email = ensureLoginEmail(jar.get("session")?.value);

  const id = String(form.get("walletId") || "");
  removeWallet(email, id);
  redirect("/settings?ok=wallet_removed");
}

/** Save Universe (cookie-backed AppSettings) + lightweight engine knobs that belong to AppSettings */
export async function saveUniverseAction(form: FormData): Promise<void> {
  "use server";
  const jar = await cookies();
  ensureLoginEmail(jar.get("session")?.value);

  const app = await getAppSettings(); // ✅ define app

  const numOr = (oldVal: number, raw: FormDataEntryValue | null | undefined) => {
    const v = Number(raw);
    return Number.isFinite(v) ? v : oldVal;
  };

  // coins
  const rawCoins = form.get("appCoinUniverse");
  const parsedCoins = normalizeCoinUniverse(
    typeof rawCoins === "string"
      ? rawCoins
      : Array.isArray(rawCoins)
      ? rawCoins
      : String(rawCoins ?? "")
  );
  const nextCoins = parsedCoins.length ? parsedCoins : app.coinUniverse;

  // stats
  const histogramLen  = numOr(app.stats.histogramLen,  form.get("histogramLen"));
  const bmDecimals    = numOr(app.stats.bmDecimals,    form.get("bmDecimals"));
  const idPctDecimals = numOr(app.stats.idPctDecimals, form.get("idPctDecimals"));

  // params (ε, η, ι) — keep old if empty
  const epsilon = numOr(app.params.values.epsilon ?? 1e-6, form.get("epsilon"));
  const eta     = numOr(app.params.values.eta     ?? 0.02, form.get("eta"));
  const iota    = numOr(app.params.values.iota    ?? 0.5,  form.get("iota"));

  const next = {
    ...app,
    coinUniverse: nextCoins,
    stats: { ...app.stats, histogramLen, bmDecimals, idPctDecimals },
    params: { values: { ...app.params.values, epsilon, eta, iota } },
  };

  await setAppSettings(next);

  try {
    await syncCoinUniverseFromBinance({
      explicitCoins: nextCoins,
      spotOnly: true,
      disableMissing: true,
    });
  } catch (error) {
    console.error("[settings] sync coin universe failed", error);
  }

  redirect("/settings?ok=universe");
}

// little helper to keep the server-action signature ergonomics
async function setAll(
  setter: typeof setAppSettings,
  next: Awaited<ReturnType<typeof getAppSettings>>
) {
  await setter(next);
  redirect("/settings?ok=universe");
}

export async function saveTimingAction(form: FormData): Promise<void> {
  "use server";
  const jar = await cookies();
  ensureLoginEmail(jar.get("session")?.value);

  const app = await getAppSettings();

  const autoRefresh = safeBool(form.get("autoRefresh"), app.timing.autoRefresh);
  const autoRefreshMs = Math.max(500, safeNum(form.get("autoRefreshMs"), app.timing.autoRefreshMs));
  const secondaryEnabled = safeBool(form.get("secondaryEnabled"), app.timing.secondaryEnabled);
  const secondaryCycles = Math.min(10, Math.max(1, safeNum(form.get("secondaryCycles"), app.timing.secondaryCycles)));
  const strCycleM30 = Math.max(1, safeNum(form.get("strCycleM30"), app.timing.strCycles.m30));
  const strCycleH1 = Math.max(1, safeNum(form.get("strCycleH1"), app.timing.strCycles.h1));
  const strCycleH3 = Math.max(1, safeNum(form.get("strCycleH3"), app.timing.strCycles.h3));
  const pollCycle40 = Math.max(5, safeNum(form.get("pollCycle40"), app.poll?.cycle40 ?? DEFAULT_SETTINGS.poll.cycle40));
  const pollCycle120 = Math.max(5, safeNum(form.get("pollCycle120"), app.poll?.cycle120 ?? DEFAULT_SETTINGS.poll.cycle120));
  const pollRefreshUrl =
    String(form.get("pollRefreshUrl") ?? app.poll?.refreshUrl ?? DEFAULT_SETTINGS.poll.refreshUrl).trim() ||
    DEFAULT_SETTINGS.poll.refreshUrl;

  const next = {
    ...app,
    timing: {
      ...app.timing,
      autoRefresh,
      autoRefreshMs,
      secondaryEnabled,
      secondaryCycles,
      strCycles: { m30: strCycleM30, h1: strCycleH1, h3: strCycleH3 },
    },
    poll: {
      ...app.poll,
      cycle40: pollCycle40,
      cycle120: pollCycle120,
      refreshUrl: pollRefreshUrl,
    },
  };

  await setAll(setAppSettings, next);
}

export async function saveParamsAction(form: FormData): Promise<void> {
  "use server";
  const jar = await cookies();
  const email = ensureLoginEmail(jar.get("session")?.value);

  // NOTE: coinUniverse REMOVED here to avoid duplication — it lives under Universe card now
  const cadenceSec = safeNum(form.get("cadenceSec"), 40);
  const kSize = safeNum(form.get("kSize"), 9);
  const idPctAmber = safeNum(form.get("idPctAmber"), 0.00002);
  const idPctHighlight = safeNum(form.get("idPctHighlight"), 0.0002);
  const drvSensitivity = safeNum(form.get("drvSensitivity"), 1.0);
  const flipRings = safeBool(form.get("flipRings"), true);
  const previewRings = safeBool(form.get("previewRings"), true);

  setUserSettings(email, {
    params: {
      coinUniverse: (await getAppSettings()).coinUniverse,
      cadenceSec,
      kSize,
      idPctAmber,
      idPctHighlight,
      drvSensitivity,
      flipRings,
      previewRings,
    },
  });

  redirect("/settings?ok=params");
}

// ---------- page ----------
export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireUserSession();
  const email = session.email;

  const s: UserSettings = getUserSettings(email);
  const app = await getAppSettings();

  const pick = (k: string) => {
    const v = searchParams?.[k];
    return Array.isArray(v) ? v[0] : v || "";
  };
  const ok = pick("ok");
  const err = pick("err");

  return (
    <div className="relative min-h-dvh">
      {/* heat-fade background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 size-[520px] rounded-full blur-3xl opacity-20"
             style={{ background: "radial-gradient(60% 60% at 50% 50%, rgba(16,185,129,0.55) 0%, rgba(16,185,129,0.0) 70%)" }} />
        <div className="absolute -bottom-24 -right-24 size-[520px] rounded-full blur-3xl opacity-20"
             style={{ background: "radial-gradient(60% 60% at 50% 50%, rgba(59,130,246,0.45) 0%, rgba(59,130,246,0.0) 70%)" }} />
        <div className="absolute top-1/2 left-1/3 size-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl opacity-20"
             style={{ background: "radial-gradient(60% 60% at 50% 50%, rgba(244,63,94,0.36) 0%, rgba(244,63,94,0.0) 70%)" }} />
      </div>

      <div className="relative z-10 p-6">
        <div className="mx-auto max-w-[1100px] space-y-6">
          <header className="flex items-center justify-between">
            <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
            <div className="text-xs text-slate-400">
              Signed in as <span className="font-mono">{email}</span>
            </div>
          </header>

          {/* feedback toasts */}
          {ok ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 backdrop-blur px-3 py-2 text-xs text-emerald-300">
              {ok === "profile" && "Profile saved."}
              {ok === "wallet_added" && "Wallet added."}
              {ok === "wallet_removed" && "Wallet removed."}
              {ok === "params" && "Parameters saved."}
              {ok === "universe" && "Universe & engine settings saved."}
              {ok === "timing" && "Timing settings saved."}
            </div>
          ) : null}
          {err ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 backdrop-blur px-3 py-2 text-xs text-rose-300">
              Error: {decodeURIComponent(err)}
            </div>
          ) : null}

          {/* UNIVERSE & ENGINE (AppSettings: coins + stats) */}
          <section className="rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-4 shadow-sm">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">Universe & Engine</h2>
                <p className="text-xs text-slate-400">Global coin universe and core stats applied to SSR/CSR consumers.</p>
              </div>
              <div className="hidden sm:flex flex-wrap gap-2">
                {app.coinUniverse.slice(0, 12).map((c) => (
                  <span key={c} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-mono">{c}</span>
                ))}
                {app.coinUniverse.length > 12 && (
                  <span className="text-[11px] text-slate-400">+{app.coinUniverse.length - 12} more</span>
                )}
              </div>
            </div>
            <form action={saveUniverseAction} className="grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-slate-400">Coin Universe (comma or space separated)</span>
                <textarea
                  name="appCoinUniverse"
                  rows={2}
                  defaultValue={app.coinUniverse.join(", ")}
                  className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm font-mono"
                />
              </label>
              <p className="text-[11px] text-slate-400">USDT is always kept automatically.</p>

              <div className="grid sm:grid-cols-3 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs text-slate-400">Histogram length</span>
                  <input name="histogramLen" type="number" min={16} step={1} defaultValue={app.stats.histogramLen}
                         className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-slate-400">Benchmark decimals</span>
                  <input name="bmDecimals" type="number" min={0} max={6} step={1} defaultValue={app.stats.bmDecimals}
                         className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-slate-400">id_pct decimals</span>
                  <input name="idPctDecimals" type="number" min={0} max={8} step={1} defaultValue={app.stats.idPctDecimals}
                         className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs text-slate-400">epsilon (ε)</span>
                  <input name="epsilon" type="number" step="any"
                        defaultValue={app.params.values.epsilon ?? 0.02}
                        className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-slate-400">eta (η)</span>
                  <input name="eta" type="number" step="any"
                        defaultValue={app.params.values.eta ?? 0.02}
                        className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-slate-400">iota (ι)</span>
                  <input name="iota" type="number" step="any"
                        defaultValue={app.params.values.iota ?? 0.5}
                        className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
              </div>

              <div>
                <button className="inline-flex items-center gap-2 rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-400">
                  Save Universe
                </button>
              </div>
            </form>
          </section>

          {/* TIMING */}
          <section className="rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">Timing Management</h2>
              <p className="text-xs text-slate-400">Control auto-refresh cadence and auxiliary sampling windows.</p>
            </div>
            <form action={saveTimingAction} className="grid gap-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-2 rounded-md border border-dashed border-white/15 p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input name="autoRefresh" type="checkbox" defaultChecked={app.timing.autoRefresh} />
                    <span>Primary auto refresh</span>
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-slate-400">Interval (ms)</span>
                    <input
                      name="autoRefreshMs"
                      type="number"
                      min={500}
                      step={100}
                      defaultValue={app.timing.autoRefreshMs}
                      className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm"
                    />
                  </label>
                </div>
                <div className="grid gap-2 rounded-md border border-dashed border-white/15 p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input name="secondaryEnabled" type="checkbox" defaultChecked={app.timing.secondaryEnabled} />
                    <span>Secondary cadence enabled</span>
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-slate-400">Secondary cycles</span>
                    <input
                      name="secondaryCycles"
                      type="number"
                      min={1}
                      max={10}
                      step={1}
                      defaultValue={app.timing.secondaryCycles}
                      className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm"
                    />
                  </label>
                </div>
                <div className="grid gap-2 rounded-md border border-dashed border-white/15 p-3">
                  <div className="text-sm font-medium">System refresh poller</div>
                  <label className="grid gap-1 text-xs">
                    <span className="text-slate-400">Cycle 40 (seconds)</span>
                    <input
                      name="pollCycle40"
                      type="number"
                      min={5}
                      max={600}
                      defaultValue={app.poll?.cycle40 ?? DEFAULT_SETTINGS.poll.cycle40}
                      className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-slate-400">Cycle 120 (seconds)</span>
                    <input
                      name="pollCycle120"
                      type="number"
                      min={5}
                      max={900}
                      defaultValue={app.poll?.cycle120 ?? DEFAULT_SETTINGS.poll.cycle120}
                      className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-slate-400">Refresh endpoint</span>
                    <input
                      name="pollRefreshUrl"
                      type="text"
                      defaultValue={app.poll?.refreshUrl ?? DEFAULT_SETTINGS.poll.refreshUrl}
                      className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm font-mono"
                    />
                  </label>
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="grid gap-1 text-xs">
                  <span className="text-slate-400">STR cycles (m30)</span>
                  <input
                    name="strCycleM30"
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={app.timing.strCycles.m30}
                    className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-slate-400">STR cycles (h1)</span>
                  <input
                    name="strCycleH1"
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={app.timing.strCycles.h1}
                    className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-slate-400">STR cycles (h3)</span>
                  <input
                    name="strCycleH3"
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={app.timing.strCycles.h3}
                    className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm"
                  />
                </label>
              </div>
              <div>
                <button className="inline-flex items-center gap-2 rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-400">
                  Save Timing
                </button>
              </div>
            </form>
          </section>

          {/* PROFILE */}
          <section className="rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">Profile</h2>
              <p className="text-xs text-slate-400">Nickname and preferences (no PII beyond email).</p>
            </div>
            <form action={saveProfileAction} className="grid sm:grid-cols-3 gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-slate-400">Nickname</span>
                <input name="nickname" defaultValue={s.profile.nickname || ""} className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-slate-400">Timezone</span>
                <input name="timezone" defaultValue={s.profile.timezone || ""} placeholder="America/Sao_Paulo" className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-slate-400">Language</span>
                <input name="language" defaultValue={s.profile.language || "en"} placeholder="en" className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
              </label>
              <div className="sm:col-span-3">
                <button className="inline-flex items-center gap-2 rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-400">
                  Save Profile
                </button>
              </div>
            </form>
          </section>

          {/* Binance API Link card (unchanged) */}
          <BinanceLinkCard sessionEmail={email} />

          {/* WALLETS */}
          <section className="rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">Wallet Linking</h2>
              <p className="text-xs text-slate-400">Public addresses only. Never paste private keys or secret phrases.</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="text-left px-3 py-2">Label</th>
                    <th className="text-left px-3 py-2">Symbol</th>
                    <th className="text-left px-3 py-2">Network</th>
                    <th className="text-left px-3 py-2">Address</th>
                    <th className="text-right px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {s.wallets.map((w) => (
                    <tr key={w.id} className="border-t border-white/10">
                      <td className="px-3 py-2">{w.label || "—"}</td>
                      <td className="px-3 py-2 font-mono">{w.symbol}</td>
                      <td className="px-3 py-2">{w.network || "—"}</td>
                      <td className="px-3 py-2 font-mono">{w.address}</td>
                      <td className="px-3 py-2 text-right">
                        <form action={deleteWalletAction}>
                          <input type="hidden" name="walletId" value={w.id} />
                          <button className="inline-flex items-center rounded-md bg-white/10 hover:bg-white/20 px-2 py-1 text-xs">
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {!s.wallets.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">No wallets linked yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-lg border border-white/10 p-3 bg-black/20">
              <form action={addWalletAction} className="grid md:grid-cols-4 gap-3">
                <label className="grid gap-1 md:col-span-1">
                  <span className="text-xs text-slate-400">Label</span>
                  <input name="label" placeholder="e.g., Main Binance" className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
                <label className="grid gap-1 md:col-span-1">
                  <span className="text-xs text-slate-400">Symbol</span>
                  <input name="symbol" placeholder="BTC" className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
                <label className="grid gap-1 md:col-span-1">
                  <span className="text-xs text-slate-400">Network</span>
                  <input name="network" placeholder="ERC20 / TRC20 / BEP20 / SOL / BTC" className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
                <label className="grid gap-1 md:col-span-1">
                  <span className="text-xs text-slate-400">Address</span>
                  <input name="address" placeholder="public address" className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm font-mono" />
                </label>
                <div className="md:col-span-4">
                  <button className="inline-flex items-center gap-2 rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-400">
                    Add Wallet
                  </button>
                </div>
              </form>
            </div>
          </section>

          {/* PARAMETERS (no coin textarea here anymore) */}
          <section className="rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Parameters</h2>
                <p className="text-xs text-slate-400">Engine tuning used across matrices and dynamics.</p>
              </div>
              {/* quick view of coin count to reinforce single-source universe */}
              <span className="text-[11px] text-slate-400">Universe: {app.coinUniverse.length} coins</span>
            </div>
            <form action={saveParamsAction} className="grid gap-3">
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs text-slate-400">Cadence (sec)</span>
                  <input name="cadenceSec" type="number" step="1" min="5" defaultValue={s.params.cadenceSec}
                         className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-slate-400">K Size</span>
                  <input name="kSize" type="number" step="1" min="1" defaultValue={s.params.kSize}
                         className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-slate-400">drv% Sensitivity</span>
                  <input name="drvSensitivity" type="number" step="0.1" defaultValue={s.params.drvSensitivity}
                         className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs text-slate-400">id_pct Amber (abs)</span>
                  <input name="idPctAmber" type="number" step="0.000001" defaultValue={s.params.idPctAmber}
                         className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-slate-400">id_pct Highlight (abs)</span>
                  <input name="idPctHighlight" type="number" step="0.000001" defaultValue={s.params.idPctHighlight}
                         className="rounded-md bg-[#0f141a]/70 border border-white/10 px-2 py-2 text-sm" />
                </label>
                <div className="grid grid-cols-[auto,1fr] items-center gap-2 pt-5">
                  <input id="flipRings" name="flipRings" type="checkbox" defaultChecked={s.params.flipRings} />
                  <label htmlFor="flipRings" className="text-sm">Flip rings</label>
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div className="grid grid-cols-[auto,1fr] items-center gap-2">
                  <input id="previewRings" name="previewRings" type="checkbox" defaultChecked={s.params.previewRings} />
                  <label htmlFor="previewRings" className="text-sm">Preview rings</label>
                </div>
              </div>

              <div>
                <button className="inline-flex items-center gap-2 rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-400">
                  Save Parameters
                </button>
              </div>
            </form>
          </section>

          <p className="text-[11px] text-slate-400">
            Dev note: cookie-backed AppSettings are the source for SSR/CSR via /api/settings; provider reconciles with cookie post-save.
          </p>
        </div>
      </div>
    </div>
  );
}


