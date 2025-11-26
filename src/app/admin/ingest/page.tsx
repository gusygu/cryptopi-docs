import { requireUserSession } from "@/app/(server)/auth/session";

async function fetchJson(path: string) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}${path}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function AdminIngestPage() {
  const session = await requireUserSession();
  if (!session.isAdmin) return null;

  const [strAuxStats, matricesLatest, mooAux] = await Promise.all([
    fetchJson("/api/str-aux/stats"),
    fetchJson("/api/matrices/latest"),
    fetchJson("/api/moo-aux"),
  ]);

  const matricesTs = (matricesLatest as any)?.ts ?? (matricesLatest as any)?.timestamp;
  const mooTs = (mooAux as any)?.ts ?? (mooAux as any)?.timestamp;

  const now = Date.now();

  const matricesAge =
    typeof matricesTs === "number" ? now - matricesTs : null;
  const mooAge = typeof mooTs === "number" ? now - mooTs : null;

  const minutes = (ms: number | null) =>
    ms == null ? "—" : `${Math.round(ms / 60000)} min ago`;

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold text-zinc-100">
          Ingest & jobs status
        </h2>
        <p className="text-xs text-zinc-400">
          Snapshot of STR-aux, matrices and moo-aux data freshness and stats.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {/* STR-aux */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs">
          <p className="text-xs font-semibold text-zinc-300">STR-aux</p>
          <p className="mt-1 text-[11px] text-zinc-400">
            Raw stats from <span className="font-mono">/api/str-aux/stats</span>
          </p>
          <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-black/60 p-2 text-[10px] text-zinc-300">
            {JSON.stringify(strAuxStats ?? { error: "no-data" }, null, 2)}
          </pre>
        </div>

        {/* Matrices freshness */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs">
          <p className="text-xs font-semibold text-zinc-300">Matrices</p>
          <p className="mt-1 text-[11px] text-zinc-400">
            Latest payload from{" "}
            <span className="font-mono">/api/matrices/latest</span>
          </p>
          <p className="mt-2 text-[11px] text-zinc-400">
            Time since latest:{" "}
            <span className="font-mono text-emerald-200">
              {minutes(matricesAge)}
            </span>
          </p>
          <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-black/60 p-2 text-[10px] text-zinc-300">
            {JSON.stringify(matricesLatest ?? { error: "no-data" }, null, 2)}
          </pre>
        </div>

        {/* Moo-aux */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs">
          <p className="text-xs font-semibold text-zinc-300">MOO-aux</p>
          <p className="mt-1 text-[11px] text-zinc-400">
            Latest payload from <span className="font-mono">/api/moo-aux</span>
          </p>
          <p className="mt-2 text-[11px] text-zinc-400">
            Time since latest:{" "}
            <span className="font-mono text-emerald-200">
              {minutes(mooAge)}
            </span>
          </p>
          <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-black/60 p-2 text-[10px] text-zinc-300">
            {JSON.stringify(mooAux ?? { error: "no-data" }, null, 2)}
          </pre>
        </div>
      </section>
    </div>
  );
}
