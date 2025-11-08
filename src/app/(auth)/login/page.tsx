"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** DEV-ONLY local store (swap for NextAuth/Prisma or Supabase later) */
type User = { email: string; password: string; sponsor?: string; createdAt: string };
const LS_USERS = "cp-users";
const LS_SESSION = "cp-session";

function loadUsers(): User[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_USERS);
    return raw ? (JSON.parse(raw) as User[]) : [];
  } catch {
    return [];
  }
}
function saveUsers(users: User[]) {
  localStorage.setItem(LS_USERS, JSON.stringify(users));
}
function setSession(email: string) {
  localStorage.setItem(LS_SESSION, JSON.stringify({ email, ts: Date.now() }));
}
function hasSession() {
  try {
    return !!localStorage.getItem(LS_SESSION);
  } catch {
    return false;
  }
}

export default function AuthPostcardPage() {
  const router = useRouter();

  // Login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginSponsor, setLoginSponsor] = useState("");
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);

  // Register state
  const [regEmail, setRegEmail] = useState("");
  const [regPass1, setRegPass1] = useState("");
  const [regPass2, setRegPass2] = useState("");
  const [regSponsor, setRegSponsor] = useState("");
  const [regMsg, setRegMsg] = useState<string | null>(null);
  const [regErr, setRegErr] = useState<string | null>(null);
  const [regBusy, setRegBusy] = useState(false);

  useEffect(() => {
    if (hasSession()) router.replace("/dynamics");
  }, [router]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr(null);
    setLoginMsg(null);
    setLoginBusy(true);
    try {
      const users = loadUsers();
      const u = users.find((x) => x.email.toLowerCase() === loginEmail.trim().toLowerCase());
      if (!u || u.password !== loginPassword) {
        setLoginErr("Invalid email or password.");
        return;
      }
      if (loginSponsor.trim()) {
        // In prod, POST a sponsor touchpoint to your API.
      }
      setSession(u.email);
      setLoginMsg("Welcome back!");
      setTimeout(() => router.replace("/dynamics"), 300);
    } finally {
      setLoginBusy(false);
    }
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegErr(null);
    setRegMsg(null);

    if (regPass1 !== regPass2) {
      setRegErr("Passwords do not match.");
      return;
    }
    if (regPass1.length < 6) {
      setRegErr("Password must be at least 6 characters.");
      return;
    }

    setRegBusy(true);
    try {
      const users = loadUsers();
      const exists = users.some((u) => u.email.toLowerCase() === regEmail.trim().toLowerCase());
      if (exists) {
        setRegErr("Email already registered.");
        return;
      }
      const now = new Date().toISOString();
      const next: User = {
        email: regEmail.trim(),
        password: regPass1,
        sponsor: regSponsor.trim() || undefined,
        createdAt: now,
      };
      saveUsers([...(users ?? []), next]);
      setSession(next.email);
      setRegMsg("Account created. Redirecting…");
      setTimeout(() => router.replace("/dynamics"), 500);
    } finally {
      setRegBusy(false);
    }
  }

  return (
    <div className="min-h-dvh p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="cp-h1">Access</h1>
          <p className="text-xs cp-subtle">Sign in or create an account to use CryptoPi Dynamics.</p>
        </header>

        {/* Postcard container */}
        <div className="rounded-2xl border cp-border bg-[#0f141a]/70 backdrop-blur shadow-sm">
          <div className="flex flex-col md:flex-row">
            {/* LOGIN */}
            <section className="flex-1 p-4 md:p-6">
              <h2 className="text-sm font-medium mb-3">Login</h2>
              <form onSubmit={onLogin} className="grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs cp-subtle">Email</span>
                  <input
                    className="rounded-md bg-[#0f141a] border cp-border px-3 py-2 text-sm"
                    type="email"
                    autoComplete="email"
                    placeholder="you@domain.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs cp-subtle">Password</span>
                  <input
                    className="rounded-md bg-[#0f141a] border cp-border px-3 py-2 text-sm"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                  />
                </label>

                {/* Sponsor / achats livre */}
                <label className="grid gap-1">
                  <span className="text-xs cp-subtle">Sponsor / Achats&nbsp;livre (optional)</span>
                  <input
                    className="rounded-md bg-[#0f141a] border cp-border px-3 py-2 text-sm"
                    type="text"
                    placeholder="Referral / note"
                    value={loginSponsor}
                    onChange={(e) => setLoginSponsor(e.target.value)}
                  />
                </label>

                {loginErr && <div className="text-rose-300 text-xs">{loginErr}</div>}
                {loginMsg && <div className="text-emerald-300 text-xs">{loginMsg}</div>}

                <button className="btn btn-emerald text-sm w-fit" disabled={loginBusy} type="submit">
                  {loginBusy ? "Signing in…" : "Sign in"}
                </button>
              </form>
            </section>

            {/* Divider: postcard fine line */}
            <div className="md:w-px md:self-stretch bg-[var(--cp-border-strong)] mx-2 hidden md:block" />
            <div className="h-px bg-[var(--cp-border-strong)] mx-4 md:hidden" />

            {/* REGISTER */}
            <section className="flex-1 p-4 md:p-6">
              <h2 className="text-sm font-medium mb-3">Register</h2>
              <form onSubmit={onRegister} className="grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs cp-subtle">Email</span>
                  <input
                    className="rounded-md bg-[#0f141a] border cp-border px-3 py-2 text-sm"
                    type="email"
                    autoComplete="email"
                    placeholder="you@domain.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    required
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs cp-subtle">Password</span>
                  <input
                    className="rounded-md bg-[#0f141a] border cp-border px-3 py-2 text-sm"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    value={regPass1}
                    onChange={(e) => setRegPass1(e.target.value)}
                    required
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs cp-subtle">Confirm password</span>
                  <input
                    className="rounded-md bg-[#0f141a] border cp-border px-3 py-2 text-sm"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat password"
                    value={regPass2}
                    onChange={(e) => setRegPass2(e.target.value)}
                    required
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs cp-subtle">Sponsor / Achats&nbsp;livre (optional)</span>
                  <input
                    className="rounded-md bg-[#0f141a] border cp-border px-3 py-2 text-sm"
                    type="text"
                    placeholder="Referral / note"
                    value={regSponsor}
                    onChange={(e) => setRegSponsor(e.target.value)}
                  />
                </label>

                {regErr && <div className="text-rose-300 text-xs">{regErr}</div>}
                {regMsg && <div className="text-emerald-300 text-xs">{regMsg}</div>}

                <button className="btn btn-silver text-sm w-fit" disabled={regBusy} type="submit">
                  {regBusy ? "Creating…" : "Create account"}
                </button>
              </form>
            </section>
          </div>

          {/* postcard footer line */}
          <div className="h-px bg-[var(--cp-border-strong)] mx-4 mt-2" />
          <div className="p-4">
            <p className="text-[11px] cp-subtle">
              Dev-only persistence (localStorage). Swap for NextAuth + Prisma (Postgres) or Supabase Auth to store emails and sessions securely.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
