"use client";

import { useState } from "react";

type Props = { sessionId: string; onApplied?: (payload: any) => void };

export default function CinMoveForm({ sessionId, onApplied }: Props) {
  const [form, setForm] = useState({
    fromAsset: "BTC",
    toAsset: "USDT",
    units: "0.001",
    priceUsdt: "68000",
    feeUsdt: "0",
    slippageUsdt: "0",
    bridgeInUsdt: "0",
    bridgeOutUsdt: "0",
    devRefUsdt: "0",
    refTargetUsdt: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function up<K extends keyof typeof form>(k: K, v: string) { setForm({ ...form, [k]: v }); }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/cin-aux/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      onApplied?.(data);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-2 p-4 rounded-2xl shadow">
      <div className="text-lg font-semibold">New Move</div>
      <div className="grid grid-cols-2 gap-3">
        <input className="border p-2 rounded" value={form.fromAsset} onChange={e=>up("fromAsset",e.target.value)} placeholder="From Asset"/>
        <input className="border p-2 rounded" value={form.toAsset} onChange={e=>up("toAsset",e.target.value)} placeholder="To Asset"/>
        <input className="border p-2 rounded" value={form.units} onChange={e=>up("units",e.target.value)} placeholder="Units"/>
        <input className="border p-2 rounded" value={form.priceUsdt} onChange={e=>up("priceUsdt",e.target.value)} placeholder="Price (USDT)"/>
        <input className="border p-2 rounded" value={form.feeUsdt} onChange={e=>up("feeUsdt",e.target.value)} placeholder="Fee (USDT)"/>
        <input className="border p-2 rounded" value={form.slippageUsdt} onChange={e=>up("slippageUsdt",e.target.value)} placeholder="Slippage (USDT)"/>
        <input className="border p-2 rounded" value={form.bridgeInUsdt} onChange={e=>up("bridgeInUsdt",e.target.value)} placeholder="Bridge In (USDT)"/>
        <input className="border p-2 rounded" value={form.bridgeOutUsdt} onChange={e=>up("bridgeOutUsdt",e.target.value)} placeholder="Bridge Out (USDT)"/>
        <input className="border p-2 rounded" value={form.devRefUsdt} onChange={e=>up("devRefUsdt",e.target.value)} placeholder="Dev Ref (USDT)"/>
        <input className="border p-2 rounded col-span-2" value={form.refTargetUsdt} onChange={e=>up("refTargetUsdt",e.target.value)} placeholder="Ref Target (USDT, optional)"/>
        <input className="border p-2 rounded col-span-2" value={form.note} onChange={e=>up("note",e.target.value)} placeholder="Note"/>
      </div>
      <button className="rounded-2xl px-4 py-2 bg-black text-white disabled:opacity-50" onClick={submit} disabled={busy}>
        {busy ? "Submitting…" : "Apply Move"}
      </button>
      {err && <div className="text-red-600 text-sm">{err}</div>}
    </div>
  );
}
