"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type MooGrid = Record<string, Record<string, number | null>>;
export type MooResp = {
  ok: boolean;
  coins: string[];
  k: number;
  grid: MooGrid;
  meta?: { warnings?: string[] };
};

export type UseMooAuxOpts = {
  coins?: string[];
  k?: number;
  refreshMs?: number;          // interval for auto refresh
};

function parseCoinsEnv(): string[] | undefined {
  const raw = process.env.NEXT_PUBLIC_COINS ?? "";
  const arr = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

export function useMooAux(opts: UseMooAuxOpts = {}) {
  const defaultCoins = useMemo(() => opts.coins ?? parseCoinsEnv(), [opts.coins]);

  const [coins, setCoins] = useState<string[] | undefined>(defaultCoins);
  const [k, setK] = useState<number | undefined>(opts.k);

  const [data, setData] = useState<MooResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errorObj, setErrorObj] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef<boolean>(false);
  const fetchRef = useRef<() => void>(() => {});

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (coins && coins.length) sp.set("coins", coins.join(","));
    if (k && k > 0) sp.set("k", String(Math.floor(k)));
    return sp.toString();
  }, [coins, k]);

  const fetchNow = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setErrorObj(null);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
      const url = `/api/moo-aux${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`${res.status} ${body}`);
      }
      const j = (await res.json()) as MooResp;
      setData(j);
      setErrorObj(null);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      setErrorObj(e instanceof Error ? e : new Error(msg));
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    fetchRef.current = () => {
      void fetchNow();
    };
  }, [fetchNow]);

  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    fetchRef.current();
    const ms = opts.refreshMs && opts.refreshMs > 0 ? opts.refreshMs : 0;
    if (ms > 0) {
      intervalRef.current = setInterval(() => {
        fetchRef.current();
      }, ms);
    }
  }, [opts.refreshMs]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    started.current = false;
  }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  useEffect(() => {
    if (started.current) {
      fetchRef.current();
    }
  }, [fetchNow]);

  return {
    coins,
    setCoins,
    k,
    setK,
    data,
    err,
    error: errorObj,
    loading,
    refresh: fetchNow,
    start,
    stop,
  };
}
