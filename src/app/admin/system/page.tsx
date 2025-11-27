import { requireUserSession } from "@/app/(server)/auth/session";
import { buildInternalUrl } from "@/lib/server/url";
import { getSuspendedEmails, getExcludedEmails } from "@/lib/auth/suspension";

type HealthPayload = {
  ok?: boolean;
  db?: string;
  status?: string;
  ts?: number;
  [key: string]: unknown;
};

type StatusCounts = {
  ok?: number;
  warn?: number;
  err?: number;
  total?: number;
};

type StatusPayload = {
  summary?: {
    level?: "ok" | "warn" | "err";
    counts?: StatusCounts;
  };
  ts?: number;
  [key: string]: unknown;
};

function formatSince(ts?: number) {
  if (!ts) return "—";
  const delta = Date.now() - ts;
  if (delta < 0) return "now";
  if (delta < 10_000) return "just now";
  if (delta < 60_000) return `${Math.round(delta / 1_000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
}

function badgeTone(level: "ok" | "warn" | "err" | "unknown") {
  if (level === "ok")
    return "border-emerald-500/40 bg-emerald-600/20 text-emerald-100";
  if (level === "warn")
    return "border-amber-500/40 bg-amber-500/15 text-amber-100";
  if (level === "err")
    return "border-rose-500/40 bg-rose-600/20 text-rose-100";
  return "border-zinc-600/40 bg-zinc-800/60 text-zinc-200";
}

export default async function AdminSystemPage() {
  const session = await requireUserSession();
  if (!session.isAdmin) {
    // layout already guards, this is extra safety
    return null;
  }

  let health: HealthPayload | null = null;
  let status: StatusPayload | null = null;
  let healthError: string | null = null;
  let statusError: string | null = null;

  try {
    const [healthRes, statusRes] = await Promise.all([
      fetch(buildInternalUrl("/api/vitals/health"), {
        cache: "no-store",
      }).catch(() => null),
      fetch(buildInternalUrl("/api/vitals/status"), {
        cache: "no-store",
      }).catch(() => null),
    ]);

    if (healthRes && healthRes.ok) {
      health = (await healthRes.json().catch(() => null)) ?? null;
    } else {
      healthError = "health_request_failed";
    }

    if (statusRes && statusRes.ok) {
      status = (await statusRes.json().catch(() => null)) ?? null;
    } else {
      statusError = "status_request_failed";
    }
  } catch (err) {
    healthError = healthError ?? "fetch_error";
    statusError = statusError ?? "fetch_error";
  }

  const healthOk = health?.ok ?? (health?.db === "up");
  const healthDb =
    (health?.db as string | undefined) ??
    (health?.status as string | undefined) ??
    null;
  const healthTs = typeof health?.ts === "number" ? health.ts : undefined;

  const level = status?.summary?.level ?? "unknown";
  const counts: StatusCounts = status?.summary?.counts ?? {};
  const statusTs = typeof status?.ts === "number" ? status.ts : undefined;
  const suspendedEmails = getSuspendedEmails();
  const excludedEmails = getExcludedEmails();

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold text-zinc-100">System health</h2>
        <p className="text-xs text-zinc-400">
          Direct view of vitals endpoints used by the app (health &amp; status).
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {/* DB Health */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
          <p className="text-xs text-zinc-400">Database</p>
          <div className="mt-2 inline-flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px] font-medium ${badgeTone(
                healthOk ? "ok" : "err"
              )}`}
            >
              <span>{healthDb ?? (healthOk ? "up" : "down")}</span>
            </span>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Updated {formatSince(healthTs)}
          </p>
          {healthError && (
            <p className="mt-2 text-[11px] text-rose-300">
              Error: <span className="font-mono">{healthError}</span>
            </p>
          )}
        </div>

        {/* Status summary */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
          <p className="text-xs text-zinc-400">Status</p>
          <div className="mt-2 inline-flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px] font-medium ${badgeTone(
                level === "ok" || level === "warn" || level === "err"
                  ? level
                  : "unknown"
              )}`}
            >
              <span>
                {level === "ok"
                  ? "all green"
                  : level === "warn"
                  ? "warnings"
                  : level === "err"
                  ? "attention"
                  : "unknown"}
              </span>
            </span>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            ok {counts.ok ?? 0} · warn {counts.warn ?? 0} · err{" "}
            {counts.err ?? 0} · total {counts.total ?? 0}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Updated {formatSince(statusTs)}
          </p>
          {statusError && (
            <p className="mt-2 text-[11px] text-rose-300">
              Error: <span className="font-mono">{statusError}</span>
            </p>
          )}
        </div>

        {/* Raw debug card */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
          <p className="text-xs text-zinc-400">Raw debug</p>
          <p className="mt-2 text-[11px] text-zinc-500">
            Minimal JSON snapshots from the vitals endpoints, for debugging.
          </p>
          <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-black/60 p-2 text-[10px] text-zinc-300">
            {JSON.stringify(
              {
                health,
                statusSummary: status?.summary,
              },
              null,
              2
            )}
          </pre>
        </div>

        {/* Suspension guard */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
          <p className="text-xs text-zinc-400">Suspension guard</p>
          <p className="mt-2 text-[11px] text-zinc-500">
            Emails listed here get hard-blocked unless explicitly excluded.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold text-rose-200">
                Suspended
              </p>
              {suspendedEmails.length === 0 ? (
                <p className="text-[11px] text-zinc-500">—</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[11px] text-zinc-300">
                  {suspendedEmails.map((email) => (
                    <li key={email} className="font-mono">
                      {email}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-emerald-200">
                Excluded
              </p>
              {excludedEmails.length === 0 ? (
                <p className="text-[11px] text-zinc-500">—</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[11px] text-zinc-300">
                  {excludedEmails.map((email) => (
                    <li key={email} className="font-mono">
                      {email}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
