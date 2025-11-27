// src/app/(auth)/auth/page.tsx
// Auth (Login + Register) — server actions return void and accept FormData.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

import { verifyPassword, createSession, clearSessionCookieAndRevoke, getCurrentUser } from "@/lib/auth/server";
import { isEmailSuspended } from "@/lib/auth/suspension";
import { query } from "@/core/db/pool_server";

// ----------------- server actions (must be (FormData) => Promise<void>) -----------------

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

  if (isEmailSuspended(email)) {
    redirect("/auth?err=account_suspended");
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
              <li>Authenticates against <span className="font-mono">auth.user</span> (hashed passwords).</li>
              <li>Creates server-side sessions in <span className="font-mono">auth.session</span>.</li>
              <li>Registration is invite-only — request one to join.</li>
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

          {/* Invite info */}
          <section className="cp-card space-y-3">
            <h2 className="cp-section-title">Invite-only access</h2>
            <p className="text-sm text-zinc-300">
              New accounts require an invite token. Start by requesting one — admins will review,
              approve, and you will receive a hashed link to finish registration.
            </p>
            <a
              href="/auth/request-invite"
              className="inline-flex items-center justify-center rounded-lg border border-emerald-600/60 bg-emerald-600/10 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-600/20"
            >
              Request invite
            </a>
            <p className="text-[11px] text-zinc-400">
              Already have a token? Use the invite link that was emailed to you to complete setup.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
