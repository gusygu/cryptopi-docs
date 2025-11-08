"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type BinanceLinkCardProps = {
  sessionEmail: string;
};

type WalletResponse = {
  ok: boolean;
  email?: string | null;
  linked?: boolean;
  keyHint?: string | null;
  keyId?: string | null;
  linkedAt?: string | null;
  error?: string | null;
  warn?: string | null;
  status?: number;
};

type LinkState = {
  status: "idle" | "loading" | "linking" | "unlinking";
  linked: boolean;
  sessionEmail: string | null;
  keyHint: string | null;
  linkedAt: string | null;
  error: string | null;
  note: string | null;
};

const initialState: LinkState = {
  status: "loading",
  linked: false,
  sessionEmail: null,
  keyHint: null,
  linkedAt: null,
  error: null,
  note: null,
};

export default function BinanceLinkCard({ sessionEmail }: BinanceLinkCardProps) {
  const [state, setState] = useState<LinkState>({ ...initialState, sessionEmail });
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const loadWallet = useCallback(async () => {
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    try {
      const res = await fetch("/api/settings/wallet", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as WalletResponse | null;
      if (res.status === 401 || data?.error === "Not signed in") {
        setState({
          status: "idle",
          linked: false,
          sessionEmail: null,
          keyHint: null,
          linkedAt: null,
          error: "Sign in again to link your Binance account.",
          note: null,
        });
        return;
      }
      if (!data?.ok) {
        setState({
          status: "idle",
          linked: false,
          sessionEmail: data?.email ?? sessionEmail ?? null,
          keyHint: null,
          linkedAt: null,
          error: data?.error ?? "Unable to load wallet link.",
          note: null,
        });
        return;
      }

      if (data.linked) {
        setState({
          status: "idle",
          linked: true,
          sessionEmail: data.email ?? sessionEmail ?? null,
          keyHint: data.keyHint ?? data.keyId ?? null,
          linkedAt: data.linkedAt ?? null,
          error: null,
          note: data.warn ?? null,
        });
      } else {
        setState({
          status: "idle",
          linked: false,
          sessionEmail: data.email ?? sessionEmail ?? null,
          keyHint: null,
          linkedAt: null,
          error: null,
          note: data.warn ?? null,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Unable to load wallet link.");
      setState({
        status: "idle",
        linked: false,
        sessionEmail: sessionEmail ?? null,
        keyHint: null,
        linkedAt: null,
        error: message,
        note: null,
      });
    }
  }, [sessionEmail]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  const canLink = useMemo(() => {
    return apiKey.trim().length > 0 && apiSecret.trim().length > 0;
  }, [apiKey, apiSecret]);

  const handleLink = useCallback(async () => {
    if (!canLink) {
      setFlash("Provide both API key and secret.");
      return;
    }
    setFlash(null);
    setState((prev) => ({ ...prev, status: "linking", error: null }));
    try {
      const res = await fetch("/api/settings/wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }),
      });
      const data = (await res.json().catch(() => null)) as WalletResponse | null;
      if (!data?.ok) {
        const message = data?.error ?? `HTTP ${res.status}`;
        setState((prev) => ({ ...prev, status: "idle", error: message }));
        setFlash(message);
        return;
      }
      setFlash("Wallet linked.");
      setApiKey("");
      setApiSecret("");
      await loadWallet();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Link failed");
      setState((prev) => ({ ...prev, status: "idle", error: message }));
      setFlash(message);
    }
  }, [apiKey, apiSecret, canLink, loadWallet]);

  const handleUnlink = useCallback(async () => {
    setFlash(null);
    setState((prev) => ({ ...prev, status: "unlinking", error: null }));
    try {
      const res = await fetch("/api/settings/wallet", { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as WalletResponse | null;
      if (!data?.ok) {
        const message = data?.error ?? `HTTP ${res.status}`;
        setState((prev) => ({ ...prev, status: "idle", error: message }));
        setFlash(message);
        return;
      }
      setFlash("Wallet unlinked.");
      await loadWallet();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Unlink failed");
      setState((prev) => ({ ...prev, status: "idle", error: message }));
      setFlash(message);
    }
  }, [loadWallet]);

  const busy = state.status === "loading" || state.status === "linking" || state.status === "unlinking";
  const activeEmail = state.sessionEmail ?? sessionEmail;

  return (
    <section className="cp-card">
      <div className="mb-3 flex flex-col gap-1">
        <div className="text-sm font-semibold">Binance API Link</div>
        <div className="text-xs cp-subtle">
          Session email: <span className="font-mono">{activeEmail ?? "n/a"}</span>
        </div>
        <div className="text-xs cp-subtle">
          Provide a read-only API key pair to sync balances with your login profile.
        </div>
      </div>

      {state.error && (
        <div className="mb-3 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {state.error}
        </div>
      )}
      {flash && !state.error && (
        <div className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {flash}
        </div>
      )}

      {busy && state.status === "loading" ? (
        <div className="text-xs cp-subtle">Loading current link…</div>
      ) : null}

      {state.linked ? (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="cp-pill-emerald">
            Linked {state.keyHint ? `(${state.keyHint})` : ""}
          </span>
          {state.linkedAt ? (
            <span className="cp-subtle">Linked at {new Date(state.linkedAt).toLocaleString()}</span>
          ) : null}
          <button
            className="btn btn-silver text-xs"
            type="button"
            onClick={handleUnlink}
            disabled={state.status === "unlinking"}
          >
            {state.status === "unlinking" ? "Unlinking…" : "Unlink"}
          </button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs cp-subtle">API Key</span>
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="rounded-md bg-[#0f141a] border cp-border px-2 py-2 text-sm font-mono"
              placeholder="Paste your API key"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs cp-subtle">Secret</span>
            <input
              type="password"
              value={apiSecret}
              onChange={(event) => setApiSecret(event.target.value)}
              className="rounded-md bg-[#0f141a] border cp-border px-2 py-2 text-sm font-mono"
              placeholder="Paste your API secret"
            />
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button
              className="btn btn-emerald text-xs"
              type="button"
              onClick={handleLink}
              disabled={!canLink || state.status === "linking"}
            >
              {state.status === "linking" ? "Linking…" : "Link Wallet"}
            </button>
            <p className="text-[11px] cp-subtle">
              Keys are stored server-side and associated with your login email. Provide read-only access only.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
