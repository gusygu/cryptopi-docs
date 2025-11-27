 
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Dynamics — White Paper",
  description:
    "Dynamics: a framework for observing motion within data ecosystems — equilibrium, inertia, drift.",
};

export default function InfoPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200">
      {/* Smooth scroll */}
      <style>{`
        html { scroll-behavior: smooth; }
        code, pre { font-feature-settings: "cv02","ss01"; }
      `}</style>

      {/* Header */}
      <header className="border-b border-neutral-800 sticky top-0 backdrop-blur supports-[backdrop-filter]:bg-neutral-950/70 z-40">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
            dynamics <span className="text-emerald-400">/ white-paper</span>
          </h1>
          <nav className="hidden md:flex gap-6 text-sm text-neutral-400">
            <a href="#abstract" className="hover:text-neutral-100">Abstract</a>
            <a href="#framework" className="hover:text-neutral-100">Framework</a>
            <a href="#grav" className="hover:text-neutral-100">Gravitational</a>
            <a href="#schema" className="hover:text-neutral-100">Schema</a>
            <a href="#method" className="hover:text-neutral-100">Method</a>
            <a href="#vision" className="hover:text-neutral-100">Vision</a>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4">
        <div className="grid grid-cols-1 md:grid-cols-[240px,1fr] gap-8 py-10">
          {/* TOC */}
          <aside className="md:sticky md:top-20 h-max">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
              <p className="text-sm font-medium text-neutral-300 mb-3">On this page</p>
              <TocItem href="#abstract" label="1. Abstract" />
              <TocItem href="#framework" label="2. Core Framework" />
              <TocItem href="#grav" label="3. Gravitational Model" />
              <TocItem href="#schema" label="4. Schema & Pipelines" />
              <TocItem href="#method" label="5. Methodology" />
              <TocItem href="#vision" label="6. Epilogue & Vision" />
            </div>
          </aside>

          {/* Content */}
          <article className="space-y-14 pb-24">
            <Section id="abstract" title="1. Abstract">
              <p className="leading-relaxed text-neutral-300">
                <em>Dynamics</em> is a framework for observing motion within data ecosystems.
                It models <span className="text-neutral-100">equilibrium</span>,{" "}
                <span className="text-neutral-100">inertia</span>, and{" "}
                <span className="text-neutral-100">drift</span> across market-like streams,
                deriving interpretable matrices and auxiliary signals that describe change as a first-class object.
              </p>
              <p className="leading-relaxed text-neutral-300 mt-4">
                The system organizes measurements into composable layers —{" "}
                <strong>matrices</strong> (state), <strong>strategy_aux</strong> (intent),
                and <strong>mea_aux</strong> (observation) — unified by a routing core and a disciplined data schema.
              </p>
              <Keyline>
                Tagline: <span className="text-emerald-400">“Measure motion, then design with it.”</span>
              </Keyline>
            </Section>

            <Section id="framework" title="2. Core Framework">
              <ul className="list-disc pl-6 space-y-2 text-neutral-300">
                <li>
                  <strong>Matrices:</strong> tabular fields of relations (benchmark, delta) over a selected coin universe,
                  exposed via <code className="px-1 rounded bg-neutral-800">/api/matrices/latest</code>.
                </li>
                <li>
                  <strong>strategy_aux:</strong> persistence of hypotheses, playbooks, tiers, flags, and shift stamps.
                </li>
                <li>
                  <strong>mea_aux:</strong> measurements and checkpoints, retrospective fetch, autosave hooks.
                </li>
                <li>
                  <strong>Routing “Golgi”:</strong> an index that maps features to locations and associates functional
                  enzymes (wires) to routes.
                </li>
              </ul>

              <div className="mt-6 grid md:grid-cols-2 gap-4">
                <Callout title="Endpoint Example">
                  <CodeBlock language="ts">{`// GET /api/matrices/latest
{
  "ok": true,
  "coins": ["BTC","ETH","BNB","SOL","ADA","USDT","XRP","XPL"],
  "symbols": ["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","ADAUSDT","USDTUSDT","XRPUSDT","XPLUSDT"],
  "window": "30m",
  "ts": 1759196895525,
  "matrices": {
    "benchmark": { "ts": 1759196895525, "values": { "BTC": {"BTC":1, "ETH":0.98, "...":"..." } } },
    "delta":     { "ts": 1759196895525, "values": { "BTC": {"BTC":0, "ETH":-0.012, "...":"..." } } }
  }
}`}</CodeBlock>
                </Callout>

                <Callout title="Client Hook Sketch">
                  <CodeBlock language="ts">{`// useLatestMatrices.ts
import { useEffect, useState } from "react";

export function useLatestMatrices(coinUniverse: string[]) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const params = new URLSearchParams({ coins: coinUniverse.join(",") });
    fetch("/api/matrices/latest?" + params.toString())
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [coinUniverse]);
  return { data, loading };
}`}</CodeBlock>
                </Callout>
              </div>
            </Section>

            <Section id="grav" title="3. Gravitational Model (IdHR)">
              <p className="leading-relaxed text-neutral-300">
                The <strong>gravitational mode</strong> projects price-action into an elliptic space built over segmented ranges
                (IdHR). Densities become potential wells; transitions become inertial vectors (vInner, vOuter).
              </p>

              <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
                <p className="text-sm text-neutral-400 mb-2">Elliptic density sketch</p>
                <GravDiagram />
              </div>

              <div className="grid md:grid-cols-2 gap-4 mt-6">
                <Callout title="Mathematical Note">
                  <CodeBlock language="tex">{`\\textbf{Inertia: } \\mathbf{I} = \\sum_{b \\in B} w_b\\, (\\mathbf{c}_b - \\bar{\\mathbf{c}}) \\\\
\\textbf{Delta: } \\Delta_{i,j} = \\frac{P_i}{P_j} - 1 \\\\
\\textbf{Benchmark: } \\beta_i = \\mathrm{median}_{j \\in U} \\left( \\frac{P_i}{P_j} \\right)`}</CodeBlock>
                </Callout>
                <Callout title="Interpretation">
                  <ul className="list-disc pl-6 text-neutral-300">
                    <li>Ellipses ≈ constant density levels across IdHR bins.</li>
                    <li>Vector tails start at current centroid; heads point to drift.</li>
                    <li>Neutral cells appear yellow in heatmaps; freeze flags in purple.</li>
                  </ul>
                </Callout>
              </div>
            </Section>

            <Section id="schema" title="4. System Schema & Pipelines">
              <p className="leading-relaxed text-neutral-300">
                Schemas separate concerns while staying query-friendly (PostgreSQL):{" "}
                <code className="px-1 rounded bg-neutral-800">public</code>,{" "}
                <code className="px-1 rounded bg-neutral-800">strategy_aux</code>,{" "}
                <code className="px-1 rounded bg-neutral-800">mea_aux</code>.
              </p>

              <div className="grid md:grid-cols-2 gap-4 mt-6">
                <Callout title="DDL Sketch">
                  <CodeBlock language="sql">{`-- schema: strategy_aux
create table if not exists strategy_aux.shift_flags (
  id bigserial primary key,
  symbol text not null,
  tier text not null,
  shift_ts timestamptz not null default now(),
  swap_tag text,
  meta jsonb default '{}'
);

-- schema: mea_aux
create table if not exists mea_aux.checkpoints (
  id bigserial primary key,
  scope text not null,        -- e.g. "matrices/latest"
  coins text[] not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);`}</CodeBlock>
                </Callout>

                <Callout title="Autosave & Retrospective">
                  <ul className="list-disc pl-6 text-neutral-300">
                    <li>Autosave on material changes in matrices window.</li>
                    <li>Retrospective fetch for backfills / regression runs.</li>
                    <li>Hooks: <code className="px-1 rounded bg-neutral-800">beforePersist</code>,{" "}
                      <code className="px-1 rounded bg-neutral-800">afterPersist</code>,{" "}
                      <code className="px-1 rounded bg-neutral-800">onShift</code>.
                    </li>
                  </ul>
                </Callout>
              </div>
            </Section>

            <Section id="method" title="5. Methodology & Experimentation">
              <ol className="list-decimal pl-6 space-y-2 text-neutral-300">
                <li><strong>Observation:</strong> capture states into matrices.</li>
                <li><strong>Calibration:</strong> tune tiers, thresholds, epsilon for shift detection.</li>
                <li><strong>Validation:</strong> backtest with retrospective fetch; store checkpoints.</li>
                <li><strong>Iteration:</strong> promote “lab” artifacts into main routes after scrutiny.</li>
              </ol>

              <div className="mt-6 grid md:grid-cols-2 gap-4">
                <Callout title="Shift Detection (pseudo)">
                  <CodeBlock language="ts">{`const SHIFT_EPS = 0.015; // 1.5%
function detectShift(prev: number, curr: number) {
  const d = (curr - prev) / Math.max(Math.abs(prev), 1e-9);
  return Math.abs(d) >= SHIFT_EPS ? { ok: true, delta: d } : { ok: false, delta: d };
}`}</CodeBlock>
                </Callout>
                <Callout title="Benchmark / Delta Notes">
                  <CodeBlock language="md">{`- Benchmark uses robust center (median) across the selected universe U.
- Delta is relational (pairwise), enabling heatmaps w/ neutral bands.
- Persistence ensures reproducibility of visual states.`}</CodeBlock>
                </Callout>
              </div>
            </Section>

            <Section id="vision" title="6. Epilogue & Vision">
              <p className="leading-relaxed text-neutral-300">
                Dynamics evolves toward a living atlas of motion — interfaces that don’t just display markets,
                but converse with them. Upcoming: interactive matrix, strategy notebooks, and cross-project
                bridges (Haus, Harues, Rep.Isl).
              </p>
              <Keyline>
                Roadmap seeds: <span className="text-neutral-100">interactive heatmaps</span>,{" "}
                <span className="text-neutral-100">autosave w/ diffs</span>,{" "}
                <span className="text-neutral-100">tier visualizers</span>.
              </Keyline>
            </Section>
          </article>
        </div>
      </div>
    </main>
  );
}

/* --------------- components --------------- */

function TocItem({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="block px-2 py-1.5 rounded text-sm text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/60"
    >
      {label}
    </a>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-lg md:text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Callout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <p className="text-sm font-medium text-neutral-300 mb-2">{title}</p>
      {children}
    </div>
  );
}

function Keyline({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 border-l-2 border-emerald-500/60 pl-3 text-neutral-200">
      {children}
    </div>
  );
}

function CodeBlock({
  children,
  language,
}: {
  children: string;
  language?: string;
}) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border border-neutral-800 bg-neutral-900/70 p-3 text-sm leading-relaxed">
      <div className="mb-2 text-xs uppercase tracking-wider text-neutral-400">
        {language || "code"}
      </div>
      <code>{children}</code>
    </pre>
  );
}

/** Simple elliptic density sketch + vector drift (no external deps) */
function GravDiagram() {
  return (
    <svg
      viewBox="0 0 400 220"
      className="w-full h-[220px] rounded-md border border-neutral-800 bg-neutral-950"
    >
      {/* ellipses */}
      <g fill="none" stroke="#3f3f46">
        <ellipse cx="160" cy="110" rx="120" ry="70" />
        <ellipse cx="160" cy="110" rx="90" ry="50" />
        <ellipse cx="160" cy="110" rx="60" ry="32" />
      </g>
      {/* centroid */}
      <circle cx="160" cy="110" r="4" fill="#34d399" />
      {/* drift vector */}
      <line x1="160" y1="110" x2="255" y2="85" stroke="#34d399" strokeWidth="2" />
      <polygon
        points="255,85 246,86 251,92"
        fill="#34d399"
        transform="rotate(-20 255 85)"
      />
      {/* legend */}
      <text x="12" y="20" fontSize="12" fill="#a3a3a3">
        density levels (IdHR ellipses)
      </text>
      <text x="12" y="36" fontSize="12" fill="#a3a3a3">
        vector drift (vInner -&gt; vOuter)
      </text>
    </svg>
  );
}

