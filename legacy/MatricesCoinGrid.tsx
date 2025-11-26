"use client";

import { useEffect, useState } from "react";

type Bal = {
  asset: string;
  opening_principal: string;
  opening_profit: string;
  closing_principal: string;
  closing_profit: string;
};

export default function MatricesCoinsGrid({ sessionId }: { sessionId: string }) {
  const [coins, setCoins] = useState<string[]>([]);
  const [balances, setBalances] = useState<Record<string, Bal>>({});
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const u = await fetch("/api/preview/universe").then(r => r.json());
      setCoins(Array.isArray(u?.coins) ? u.coins : []);
      const b = await fetch(`/api/cin-aux/session/${sessionId}/balances`).then(r => r.json());
      const byAsset: Record<string, Bal> = {};
      for (const row of b) byAsset[row.asset] = row;
      setBalances(byAsset);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (sessionId) refresh(); }, [sessionId]);
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener("cin:refresh", h);
    return () => window.removeEventListener("cin:refresh", h);
  }, [sessionId]);

  if (!sessionId) return null;

  return (
    <section className="p-4 rounded-2xl shadow space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Coin Universe</h3>
        <button className="rounded px-3 py-1 border" onClick={refresh} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              {coins.map(c => (
                <th key={c} className="p-2 text-left">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {coins.map(c => {
                const bal = balances[c];
                const available =
                  bal &&
                  (Number(bal.closing_principal || 0) > 0 ||
                   Number(bal.closing_profit || 0) > 0);
                return (
                  <td key={c} className={`p-2 ${available ? "font-medium" : "text-gray-500 opacity-60"}`}>
                    {available ? "available" : "—"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
