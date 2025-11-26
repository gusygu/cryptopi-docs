import React, { useEffect, useState } from "react";
import type { CinStat } from "@/core/converters/provider.types";
import { formatNumber } from "@/components/features/dynamics/utils";

type Props = {
  clusterCoins?: string[];
  title?: string;
  dense?: boolean;
  className?: string;
  cin?: Record<string, CinStat>;
  wallets?: Record<string, number>;
};

export default function CinAuxTable({
  clusterCoins = [],
  title = "CIN-AUX",
  dense = false,
  className = "",
  cin = {},
  wallets = {},
}: Props) {
  const [coins, setCoins] = useState<string[]>(clusterCoins);

  useEffect(() => {
    setCoins(clusterCoins);
  }, [clusterCoins]);

  const rows = coins.map((coin) => ({
    coin,
    wallet: wallets[coin] ?? 0,
    session: cin[coin]?.session ?? { imprint: 0, luggage: 0 },
    cycle: cin[coin]?.cycle ?? { imprint: 0, luggage: 0 },
  }));

  return (
    <div
      className={[
        "rounded-2xl border border-slate-800 bg-slate-900/60",
        dense ? "text-[12px]" : "text-sm",
        "flex h-full flex-col",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-sm font-semibold text-slate-200">{title}</div>
        <div className="text-[11px] cp-subtle">{coins.length} symbols</div>
      </div>

      <div className="overflow-auto">
        <table className="w-full num num-tabular">
          <thead className="bg-white/5">
            <tr>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="px-3 py-2 text-right">Wallet (USDT)</th>
              <th className="px-3 py-2 text-right">Imprint (session)</th>
              <th className="px-3 py-2 text-right">Luggage (session)</th>
              <th className="px-3 py-2 text-right">Imprint (cycle)</th>
              <th className="px-3 py-2 text-right">Luggage (cycle)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-center cp-subtle" colSpan={6}>
                  No data yet.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.coin} className="border-t border-white/5">
                <td className="px-3 py-2">{row.coin}</td>
                <td className="px-3 py-2 text-right">{formatNumber(row.wallet, { precision: 4 })}</td>
                <td className="px-3 py-2 text-right">{formatNumber(row.session.imprint, { precision: 4 })}</td>
                <td className="px-3 py-2 text-right">{formatNumber(row.session.luggage, { precision: 4 })}</td>
                <td className="px-3 py-2 text-right">{formatNumber(row.cycle.imprint, { precision: 4 })}</td>
                <td className="px-3 py-2 text-right">{formatNumber(row.cycle.luggage, { precision: 4 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
