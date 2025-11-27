"use client";

import { useEffect, useState } from "react";

type InviteRequest = {
  request_id: string;
  email: string;
  nickname: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  requested_from_ip: string | null;
  requested_user_agent: string | null;
  approved_by_user_id: string | null;
  rejected_by_user_id: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
};

type StatusFilter = "pending" | "approved" | "rejected" | "all";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded" }
  | { status: "error"; error: string };

type ActionState =
  | { status: "idle" }
  | { status: "working"; requestId: string }
  | { status: "error"; error: string };

export default function InvitesAdminClient() {
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [items, setItems] = useState<InviteRequest[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [actionState, setActionState] = useState<ActionState>({
    status: "idle",
  });

  async function loadInvites(currentFilter: StatusFilter) {
    setLoadState({ status: "loading" });
    try {
      const params = new URLSearchParams();
      params.set("status", currentFilter);
      params.set("limit", "200");

      const res = await fetch(`/api/invite/list?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setLoadState({
          status: "error",
          error: data?.error ?? "load_failed",
        });
        return;
      }

      setItems(data.items ?? []);
      setLoadState({ status: "loaded" });
    } catch (err) {
      setLoadState({ status: "error", error: "network_error" });
    }
  }

  useEffect(() => {
    loadInvites(filter);
     
  }, [filter]);

  async function handleApprove(requestId: string) {
    setActionState({ status: "working", requestId });
    try {
      const res = await fetch("/api/invite/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId, expires_in_hours: 48 }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setActionState({
          status: "error",
          error: data?.error ?? "approve_failed",
        });
        return;
      }

      // reload list after approve
      await loadInvites(filter);
      setActionState({ status: "idle" });
      // token is returned as data.issued_token - you can later show it / copy it if you want
    } catch (err) {
      setActionState({ status: "error", error: "network_error" });
    }
  }

  async function handleReject(requestId: string) {
    setActionState({ status: "working", requestId });
    try {
      const res = await fetch("/api/invite/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setActionState({
          status: "error",
          error: data?.error ?? "reject_failed",
        });
        return;
      }

      await loadInvites(filter);
      setActionState({ status: "idle" });
    } catch (err) {
      setActionState({ status: "error", error: "network_error" });
    }
  }

  const workingId =
    actionState.status === "working" ? actionState.requestId : null;

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-5xl flex-col gap-4 px-4 py-6 text-sm text-zinc-100">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-50">
            Invite requests
          </h1>
          <p className="text-xs text-zinc-400">
            Review, approve and reject incoming invite requests.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-400">Status:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusFilter)}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-0"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>
      </header>

      {loadState.status === "loading" && (
        <p className="text-xs text-zinc-400">Loading requests…</p>
      )}

      {loadState.status === "error" && (
        <p className="text-xs text-rose-300">
          Failed to load requests:{" "}
          <span className="font-mono">{loadState.error}</span>
        </p>
      )}

      {actionState.status === "error" && (
        <p className="text-xs text-rose-300">
          Last action failed:{" "}
          <span className="font-mono">{actionState.error}</span>
        </p>
      )}

      <section className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/80">
        <table className="min-w-full text-xs">
          <thead className="bg-zinc-900/80 text-zinc-300">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Email</th>
              <th className="px-3 py-2 text-left font-medium">Nickname</th>
              <th className="px-3 py-2 text-left font-medium">Note</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Created</th>
              <th className="px-3 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && loadState.status === "loaded" && (
              <tr>
                <td
                  className="px-3 py-4 text-center text-zinc-500"
                  colSpan={6}
                >
                  No requests found.
                </td>
              </tr>
            )}

            {items.map((item) => {
              const isPending = item.status === "pending";
              const createdAt = new Date(item.created_at);

              return (
                <tr key={item.request_id} className="border-t border-zinc-800">
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {item.email}
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    {item.nickname || <span className="text-zinc-500">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-zinc-300">
                    {item.note ? (
                      <span className="line-clamp-2">{item.note}</span>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    <span
                      className={`inline-flex rounded-full px-2 py-[1px] text-[10px] font-medium ${
                        item.status === "pending"
                          ? "bg-amber-500/15 text-amber-200"
                          : item.status === "approved"
                          ? "bg-emerald-500/15 text-emerald-200"
                          : "bg-rose-500/15 text-rose-200"
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-zinc-400">
                    {createdAt.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    {isPending ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleApprove(item.request_id)}
                          disabled={workingId === item.request_id}
                          className="rounded-md border border-emerald-500/60 bg-emerald-600/20 px-2 py-[2px] text-[10px] text-emerald-100 hover:bg-emerald-600/30 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {workingId === item.request_id
                            ? "Working…"
                            : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(item.request_id)}
                          disabled={workingId === item.request_id}
                          className="rounded-md border border-rose-500/60 bg-rose-600/15 px-2 py-[2px] text-[10px] text-rose-100 hover:bg-rose-600/25 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
