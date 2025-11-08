"use client";

import { useEffect, useState } from "react";

type Props = { sessionId: string };

export default function CinSessionPanel({ sessionId }: Props) {
  const [moves, setMoves] = useState<any[]>([]);
  const [tau, setTau] = useState<any[]>([]);
  const [rollup, setRollup] = useState<any | null>(null);

  async function refresh() {
    const [m, t, r] = await Promise.all([
      fetch(`/api/cin-aux/session/${sessionId}/moves`).then(r=>r.json()),
      fetch(`/api/cin-aux/session/${sessionId}/tau`).then(r=>r.json()),
      fetch(`/api/cin-aux/session/${sessionId}/rollup`).then(r=>r.json())
    ]);
    setMoves(m);
    setTau(t);
    setRollup(r);
  }

  useEffect(() => { refresh(); }, [sessionId]);

  return (
    <div className="grid gap-6">
      <section className="p-4 rounded-2xl shadow">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold">Session Rollup</h3>
          <button className="rounded px-3 py-1 border" onClick={refresh}>Refresh</button>
        </div>
        {rollup ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><div className="text-gray-500">Opening Principal</div><div>{rollup.openingPrincipalUsdt}</div></div>
            <div><div className="text-gray-500">Opening Profit</div><div>{rollup.openingProfitUsdt}</div></div>
            <div><div className="text-gray-500">Closing Principal</div><div>{rollup.closingPrincipalUsdt}</div></div>
            <div><div className="text-gray-500">Closing Profit</div><div>{rollup.closingProfitUsdt}</div></div>
          </div>
        ) : <div className="text-sm text-gray-500">No rollup yet.</div>}
      </section>

      <section className="p-4 rounded-2xl shadow">
        <h3 className="font-semibold mb-3">τ (Imprint − Luggage)</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr><th className="text-left p-2">ts</th><th className="text-right p-2">imprint</th><th className="text-right p-2">luggage</th><th className="text-right p-2">τ</th></tr></thead>
            <tbody>
              {tau.map((x:any) => (
                <tr key={x.moveId} className="border-t">
                  <td className="p-2">{new Date(x.ts).toLocaleString()}</td>
                  <td className="p-2 text-right">{x.tau.imprintUsdt}</td>
                  <td className="p-2 text-right">{x.tau.luggageUsdt}</td>
                  <td className="p-2 text-right font-medium">{x.tau.tauNetUsdt}</td>
                </tr>
              ))}
              {tau.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={4}>No moves yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="p-4 rounded-2xl shadow">
        <h3 className="font-semibold mb-3">Moves</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr>
              <th className="text-left p-2">ts</th><th className="text-left p-2">pair</th>
              <th className="text-right p-2">executed</th><th className="text-right p-2">fee</th>
              <th className="text-right p-2">slip</th><th className="text-right p-2">comp_principal</th>
              <th className="text-right p-2">comp_profit</th>
            </tr></thead>
            <tbody>
              {moves.map((m:any) => (
                <tr key={m.moveId} className="border-t">
                  <td className="p-2">{new Date(m.ts).toLocaleString()}</td>
                  <td className="p-2">{m.fromAsset} → {m.toAsset}</td>
                  <td className="p-2 text-right">{m.executedUsdt}</td>
                  <td className="p-2 text-right">{m.feeUsdt}</td>
                  <td className="p-2 text-right">{m.slippageUsdt}</td>
                  <td className="p-2 text-right">{m.compPrincipalUsdt}</td>
                  <td className="p-2 text-right">{m.compProfitUsdt}</td>
                </tr>
              ))}
              {moves.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={7}>No moves yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
