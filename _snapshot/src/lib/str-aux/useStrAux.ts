"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal shape - extend safely if your API returns more
export type StrAuxData = {
  ok: boolean;
  pair: string;
  shift_stamp?: boolean;
  gfmDelta?: { vTendency?: number; vShift?: number; vInner?: number; vOuter?: number };
  fm?: { sigma?: number; nuclei?: { id: string; weight: number }[] };
  lastUpdateTs?: number; // graceful if API omits it
};

type UseStrAuxOpts = {
  pair: string;                        // e.g. "ETHUSDT" or "ETHBTC"
  auto?: boolean;                      // default true
  refreshMs?: number;                  // default 20_000
};

async function fetchStrAux(pair: string): Promise<StrAuxData> {
  const urls = [
    `/api/str-aux?pair=${encodeURIComponent(pair)}`,
    `/str-aux/api?pair=${encodeURIComponent(pair)}`,
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as StrAuxData;
        return payload;
      }
    } catch {
      // fall through and try next endpoint
    }
  }
  return { ok: false, pair };
}

export function useStrAux({ pair, auto = true, refreshMs }: UseStrAuxOpts) {
  const [data, setData] = useState<StrAuxData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<number | null>(null);

  const cadence = refreshMs ?? 20_000;

  const run = useCallback(async () => {
    if (!pair) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchStrAux(pair);
      if (!result.ok) throw new Error("str-aux not ok");
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "fetch failed");
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [pair]);

  useEffect(() => {
    run();
    if (!auto) return undefined;

    timerRef.current = window.setInterval(run, cadence);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [auto, cadence, run]);

  return { data, error, loading, refresh: run };
}
