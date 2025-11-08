"use client";

import React from "react";
import Link from "next/link";

/**
 * Minimal landing page
 * - No legacy diagnostics/widgets
 * - Quick links to core areas
 */
export default function Page() {
  return (
    <div className="min-h-dvh p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center gap-3">
          <h1 className="cp-h1">CryptoPi • Dynamics</h1>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/matrices" className="cp-card hover:brightness-110 transition">
            <div className="text-sm font-medium">Matrices</div>
            <div className="text-xs cp-subtle">
              Benchmark · id_pct · %24h · drv%
            </div>
          </Link>

          <Link href="/settings" className="cp-card hover:brightness-110 transition">
            <div className="text-sm font-medium">Settings</div>
            <div className="text-xs cp-subtle">
              Universe · timing · clusters · params
            </div>
          </Link>
        </div>

        <p className="text-xs cp-subtle">
          Tip: you can wire the poller & autosave directly on the Matrices page;
          the root landing intentionally stays minimal while we refactor the server routes.
        </p>
      </div>
    </div>
  );
}
