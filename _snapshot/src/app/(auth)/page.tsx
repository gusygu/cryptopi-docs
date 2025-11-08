// src/app/(auth)/auth/page.tsx
// Dev auth (Login + Register) — server actions return void and accept FormData.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";
import crypto from "crypto";

type User = { email: string; nickname?: string; passwordHash: string; createdAt: number };
const USERS = new Map<string, User>(); // DEV-ONLY (process memory)

function hashPassword(raw: string) {
  // DEV: SHA-256 demo. In prod: Argon2/scrypt/bcrypt + per-user salt.
  return crypto.createHash("sha256").update(raw).digest("hex");
}
async function setSession(email: string) {
  const jar = await cookies();
  jar.set("session", `${email}|${Date.now()}`, { path: "/", httpOnly: true });
}
async function clearSession() {
  const jar = await cookies();
  jar.delete("session");
}

// ----------------- server actions (must be (FormData) => Promise<void>) -----------------
export async function registerAction(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const nickname = String(formData.get("nickname") || "").trim();
  const pass = String(formData.get("password") || "");
  const pass2 = String(formData.get("password2") || "");

  if (!email || !pass) redirect("/auth?err=Email+and+password+are+required");
  if (pass !== pass2) redirect("/auth?err=Passwords+do+not+match");
  if (USERS.has(email)) redirect("/auth?err=Email+already+registered");

  USERS.set(email, {
    email,
    nickname: nickname || undefined,
    passwordHash: hashPassword(pass),
    createdAt: Date.now(),
  });

  await setSession(email);
  redirect("/auth?ok=registered");
}

export async function loginAction(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const pass = String(formData.get("password") || "");
  const sponsor = String(formData.get("sponsor") || "").trim();

  const u = USERS.get(email);
  if (!u || u.passwordHash !== hashPassword(pass)) {
    redirect("/auth?err=Invalid+email+or+password");
  }

  if (sponsor) {
    const jar = await cookies();
    jar.set("sponsor", sponsor, { path: "/", httpOnly: false });
  }

  await setSession(email);
  redirect("/auth?ok=login");
}

export async function logoutAction(_formData: FormData): Promise<void> {
  "use server";
  await clearSession();
  redirect("/auth?ok=logout");
}

// ----------------- page -----------------
export default async function AuthPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const jar = await cookies();
  const sessionVal = jar.get("session")?.value || "";
  const sponsorVal = jar.get("sponsor")?.value || "";
  const sessionEmail = sessionVal.split("|")[0] || null;

  const getParam = (k: string) => {
    const v = searchParams?.[k];
    return Array.isArray(v) ? v[0] : v || "";
  };
  const ok = getParam("ok");
  const err = getParam("err");

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[840px] p-6">
        <header className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Access • Login / Register</h1>
            <p className="text-sm text-zinc-400">Dev auth for sprint testing — emerald &amp; silver palette.</p>
          </div>

          {sessionEmail ? (
            <form action={logoutAction}>
              <button
                className="rounded-lg border border-emerald-700/50 bg-emerald-600/20 text-emerald-100 px-3 py-2 text-sm hover:bg-emerald-600/30"
                type="submit"
              >
                Logout
              </button>
            </form>
          ) : null}
        </header>

        {/* Banners */}
        {ok && (
          <div className="cp-card mb-4 text-xs text-emerald-300">
            {ok === "login" && "Logged in successfully."}
            {ok === "registered" && "Account created. You are now logged in."}
            {ok === "logout" && "Logged out."}
          </div>
        )}
        {err && <div className="cp-card mb-4 text-xs text-rose-300">Error: {decodeURIComponent(err)}</div>}

        {/* Session badge */}
        <div className="mb-6">
          {sessionEmail ? (
            <div className="cp-card flex items-center justify-between">
              <div className="text-sm">
                Signed in as <span className="font-mono">{sessionEmail}</span>
              </div>
              <div className="text-xs text-zinc-400">
                Cookies: <span className="font-mono">session</span>
                {sponsorVal ? " · sponsor" : ""}
              </div>
            </div>
          ) : (
            <div className="cp-card text-sm text-zinc-300">Not signed in.</div>
          )}
        </div>

        {/* Two-column forms */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Login */}
          <section className="cp-card">
            <h2 className="cp-section-title mb-3">Login</h2>
            <form action={loginAction} className="grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-zinc-400">Email</span>
                <input name="email" type="email" required
                  className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm" />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-zinc-400">Password</span>
                <input name="password" type="password" required
                  className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm" />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-zinc-400">Sponsor / achats livre (optional)</span>
                <input name="sponsor" placeholder="ref-code or tag"
                  className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm" />
              </label>

              <button type="submit"
                className="rounded-lg border border-emerald-700/50 bg-emerald-600/20 text-emerald-100 px-3 py-2 text-sm hover:bg-emerald-600/30">
                Sign in
              </button>
            </form>
            <p className="mt-3 text-[11px] text-zinc-400">
              We drop a <span className="font-mono">session</span> cookie (dev); sponsor saved to <span className="font-mono">sponsor</span> cookie if provided.
            </p>
          </section>

          {/* Register */}
          <section className="cp-card">
            <h2 className="cp-section-title mb-3">Register</h2>
            <form action={registerAction} className="grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-zinc-400">Email</span>
                <input name="email" type="email" required
                  className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm" />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-zinc-400">Nickname (optional)</span>
                <input name="nickname" placeholder="your display name"
                  className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm" />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs text-zinc-400">Password</span>
                  <input name="password" type="password" required
                    className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-zinc-400">Confirm</span>
                  <input name="password2" type="password" required
                    className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm" />
                </label>
              </div>

              <button type="submit"
                className="rounded-lg border border-emerald-700/50 bg-emerald-600/20 text-emerald-100 px-3 py-2 text-sm hover:bg-emerald-600/30">
                Create account
              </button>
            </form>

            <p className="mt-3 text-[11px] text-zinc-400">
              Dev note: stored in process memory with a demo hash; swap to DB + Argon2 before shipping.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
