// src/app/(auth)/auth/page.tsx
// Auth (Login + Register) — server actions return void and accept FormData.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

import { hashPassword, verifyPassword, createSession, clearSessionCookieAndRevoke, getCurrentUser } from "@/lib/auth/server";
import { query } from "@/core/db/pool_server";

// ----------------- server actions (must be (FormData) => Promise<void>) -----------------
export async function registerAction(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const nickname = String(formData.get("nickname") || "").trim();
  const pass = String(formData.get("password") || "");
  const pass2 = String(formData.get("password2") || "");

  if (!email || !pass) redirect("/auth?err=Email+and+password+are+required");
  if (pass !== pass2) redirect("/auth?err=Passwords+do+not+match");

  // Check if email already registered
  const existing = await query<{ user_id: string }>(
    `select user_id from auth."user" where email = $1`,
    [email],
  );
  if (existing.rows.length) {
    redirect("/auth?err=Email+already+registered");
  }

  const passwordHash = await hashPassword(pass);

  const result = await query<{ user_id: string }>(
    `insert into auth."user" (email, nickname, password_hash, status)
     values ($1, $2, $3, 'active')
     returning user_id`,
    [email, nickname || null, passwordHash],
  );

  const userId = result.rows[0]?.user_id;
  if (!userId) {
    redirect("/auth?err=Registration+failed");
  }

  await createSession(userId);
  redirect("/auth?ok=registered");
}

export async function loginAction(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const pass = String(formData.get("password") || "");
  const sponsor = String(formData.get("sponsor") || "").trim();

  const result = await query<{ user_id: string; password_hash: string; status: string }>(
    `select user_id, password_hash, status
       from auth."user"
      where email = $1`,
    [email],
  );
  const row = result.rows[0];

  if (!row || row.status !== "active") {
    redirect("/auth?err=Invalid+email+or+password");
  }

  const ok = await verifyPassword(pass, row.password_hash);
  if (!ok) {
    redirect("/auth?err=Invalid+email+or+password");
  }

  if (sponsor) {
    const jar = await cookies();
    jar.set("sponsor", sponsor, { path: "/", httpOnly: false });
  }

  await createSession(row.user_id);
  redirect("/auth?ok=login");
}

export async function logoutAction(_formData: FormData): Promise<void> {
  "use server";
  await clearSessionCookieAndRevoke();
  redirect("/auth?ok=logout");
}

// ----------------- page -----------------
export default async function AuthPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const jar = await cookies();
  const sponsorVal = jar.get("sponsor")?.value || "";

  const user = await getCurrentUser();
  const sessionEmail = user?.email ?? null;

  const getParam = (k: string) => {
    const v = searchParams?.[k];
    return Array.isArray(v) ? v[0] : v || "";
  };
  const ok = getParam("ok");
  const err = getParam("err");

  const badge = ok
    ? { kind: "ok" as const, message: ok }
    : err
    ? { kind: "err" as const, message: err }
    : null;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#020617_0,_#020617_40%,_#000_100%)] text-zinc-50">
      <div className="max-w-5xl mx-auto px-4 py-10 md:py-16">
        <header className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="cp-page-title">Access & invitations</h1>
            <p className="cp-subtle max-w-xl">
              Minimal auth shell: email + password, server-side sessions, and a place to plug
              invite / admin flows later.
            </p>
          </div>

          <form action={logoutAction}>
            <button
              type="submit"
              disabled={!sessionEmail}
              className="px-3 py-1.5 rounded-lg border border-zinc-700/70 text-xs text-zinc-200 disabled:opacity-50 disabled:cursor-default hover:bg-zinc-800/70"
            >
              Logout
            </button>
          </form>
        </header>

        {/* Status + badge */}
        <div className="grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)] gap-4 mb-8">
          <div className="cp-card space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-zinc-400">Session</div>
              {badge && (
                <span
                  className={
                    badge.kind === "ok"
                      ? "inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-400/40 px-2 py-0.5 text-[11px] text-emerald-100"
                      : "inline-flex items-center rounded-full bg-rose-500/10 border border-rose-400/40 px-2 py-0.5 text-[11px] text-rose-100"
                  }
                >
                  {badge.kind === "ok" ? "OK" : "Error"} · {badge.message}
                </span>
              )}
            </div>

            {sessionEmail ? (
              <div className="mt-2 text-sm text-zinc-200 space-y-1">
                <div>
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

          <div className="cp-card text-xs text-zinc-400 space-y-2">
            <div className="font-medium text-zinc-300">What this does</div>
            <ul className="list-disc list-inside space-y-1">
              <li>Registers users into <span className="font-mono">auth.user</span> with hashed passwords.</li>
              <li>Creates server-side sessions in <span className="font-mono">auth.session</span>.</li>
              <li>Exposes a simple login/register surface for future invite wiring.</li>
            </ul>
          </div>
        </div>

        {/* Two-column forms */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Login */}
          <section className="cp-card">
            <h2 className="cp-section-title mb-3">Login</h2>
            <form action={loginAction} className="grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-zinc-400">Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-zinc-400">Password</span>
                <input
                  name="password"
                  type="password"
                  required
                  className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-zinc-400">Sponsor (optional)</span>
                <input
                  name="sponsor"
                  placeholder="referral / sponsor code"
                  className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm"
                />
              </label>

              <button
                type="submit"
                className="rounded-lg border border-zinc-700/80 text-zinc-100 px-3 py-2 text-sm hover:bg-zinc-800/80"
              >
                Login
              </button>
            </form>
          </section>

          {/* Register */}
          <section className="cp-card">
            <h2 className="cp-section-title mb-3">Register</h2>
            <form action={registerAction} className="grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-zinc-400">Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-zinc-400">Nickname (optional)</span>
                <input
                  name="nickname"
                  placeholder="your display name"
                  className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs text-zinc-400">Password</span>
                  <input
                    name="password"
                    type="password"
                    required
                    className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-zinc-400">Confirm</span>
                  <input
                    name="password2"
                    type="password"
                    required
                    className="rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <button
                type="submit"
                className="rounded-lg border border-emerald-700/60 text-emerald-100 px-3 py-2 text-sm hover:bg-emerald-600/30"
              >
                Create account
              </button>
            </form>

            <p className="mt-3 text-[11px] text-zinc-400">
              Note: passwords are hashed and stored in Postgres via the auth schema; adjust RLS and
              hash strategy before shipping.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
