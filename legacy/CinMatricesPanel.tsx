"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// adjust these paths to where your files actually are
import MatricesCoinsGrid from "@/components/features/cin-aux/MatricesCoinGrid";
import CinMoveForm from "@/components/features/cin-aux/CinMoveForm";
import CinSessionPanel from "@/components/features/cin-aux/CinSessionPanel";

type Props = { defaultSessionId?: string };

export default function CinMatricesPanel({ defaultSessionId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const qs = useSearchParams();

  const urlSession = qs.get("sessionId") ?? "";
  const [sessionId, setSessionId] = useState<string>(urlSession || defaultSessionId || "");

  // keep local state in sync if user changes the URL
  useEffect(() => {
    if (urlSession && urlSession !== sessionId) setSessionId(urlSession);
  }, [urlSession]);

  const setUrlParam = (id: string) => {
    const p = new URLSearchParams(Array.from(qs.entries()));
    if (id) p.set("sessionId", id); else p.delete("sessionId");
    router.replace(`${pathname}?${p.toString()}`);
  };

  const canSubmit = useMemo(() => sessionId.trim().length > 0, [sessionId]);

  return (
    <div className="space-y-8">
      {/* Session selector */}
      <section className="rounded-2xl p-4 border">
        <h2 className="text-xl font-semibold mb-3">Matrices · CIN-AUX</h2>
        <div className="grid gap-3 md:grid-cols-[1fr_auto] items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Session ID</label>
            <input
              className="border w-full p-2 rounded"
              placeholder="uuid or bigint (depending on your schema)"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </div>
          <button
            className="mt-2 md:mt-0 px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            onClick={() => setUrlParam(sessionId)}
            disabled={!canSubmit}
          >
            Set session
          </button>
        </div>
        {!canSubmit && <p className="text-sm text-gray-500 mt-2">Enter a session id to enable the controls below.</p>}
      </section>

      {/* CIN view */}
      {canSubmit && (
        <>
          {/* coin universe header + availability per coin */}
          <MatricesCoinsGrid sessionId={sessionId} />

          {/* move form */}
          <CinMoveForm
            sessionId={sessionId}
            onApplied={() => {
              // let other widgets refresh
              if (typeof window !== "undefined") window.dispatchEvent(new Event("cin:refresh"));
            }}
          />

          {/* moves, τ, rollup */}
          <CinSessionPanel sessionId={sessionId} />
        </>
      )}
    </div>
  );
}
