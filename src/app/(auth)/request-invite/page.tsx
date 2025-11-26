"use client";

import { useState } from "react";

type RequestState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; email: string }
  | { status: "error"; error: string };

export default function RequestInvitePage() {
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<RequestState>({ status: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setState({ status: "submitting" });

    try {
      const res = await fetch("/api/invite/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          nickname: nickname || undefined,
          note: note || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = data?.error ?? "request_failed";
        setState({ status: "error", error: err });
        return;
      }

      setState({ status: "success", email });
      setNote("");
      setNickname("");
    } catch (err) {
      setState({ status: "error", error: "network_error" });
    }
  }

  const disabled = state.status === "submitting";

  function renderMessage() {
    if (state.status === "success") {
      return (
        <div className="mt-3 rounded-md border border-emerald-600/60 bg-emerald-600/15 px-3 py-2 text-xs text-emerald-100">
          Request received for <span className="font-mono">{state.email}</span>.
          If approved, you&apos;ll receive an invite link.
        </div>
      );
    }
    if (state.status === "error") {
      return (
        <div className="mt-3 rounded-md border border-rose-600/60 bg-rose-600/10 px-3 py-2 text-xs text-rose-100">
          Something went wrong:{" "}
          <span className="font-mono">{state.error}</span>
        </div>
      );
    }
    return null;
  }

  return (
    <main className="flex min-h-[80vh] items-center justify-center bg-black">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950/80 px-6 py-6 shadow-lg">
        <h1 className="mb-2 text-lg font-semibold text-zinc-50">
          Request an invite
        </h1>
        <p className="mb-4 text-sm text-zinc-400">
          CryptoPi Dynamics is currently invite-only. Leave your details below
          and an admin will review your request.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-medium text-zinc-300"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-0"
              placeholder="you@example.com"
              disabled={disabled}
            />
          </div>

          <div>
            <label
              htmlFor="nickname"
              className="block text-xs font-medium text-zinc-300"
            >
              Nickname (optional)
            </label>
            <input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-0"
              placeholder="How should we display you?"
              disabled={disabled}
            />
          </div>

          <div>
            <label
              htmlFor="note"
              className="block text-xs font-medium text-zinc-300"
            >
              Note (optional)
            </label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-0"
              placeholder="Anything you want to add for the admin?"
              disabled={disabled}
            />
          </div>

          <button
            type="submit"
            disabled={disabled}
            className="mt-2 inline-flex w-full items-center justify-center rounded-md border border-emerald-500/70 bg-emerald-600/80 px-3 py-1.5 text-sm font-medium text-emerald-50 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {state.status === "submitting"
              ? "Sending request..."
              : "Send request"}
          </button>
        </form>

        {renderMessage()}

        <p className="mt-4 text-xs text-zinc-500">
          Already have an invite link?{" "}
          <a
            href="/auth"
            className="text-emerald-300 underline-offset-2 hover:underline"
          >
            Go to sign in
          </a>
          .
        </p>
      </div>
    </main>
  );
}
