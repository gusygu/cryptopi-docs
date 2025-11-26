import type { ReactNode } from "react";
import Link from "next/link";
import { requireUserSession } from "@/app/(server)/auth/session";

type Props = {
  children: ReactNode;
};

const NAV_ITEMS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/invites", label: "Invites" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/system", label: "System" },
  { href: "/admin/ingest", label: "Ingest" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/actions", label: "Actions" },
] as const;


export default async function AdminLayout({ children }: Props) {
  const session = await requireUserSession();

  if (!session.isAdmin) {
    // You can redirect instead if you prefer:
    // redirect("/auth?err=forbidden");
    return (
      <main className="flex min-h-[60vh] items-center justify-center bg-black">
        <div className="rounded-xl border border-rose-800 bg-rose-950/70 px-6 py-5 text-sm text-rose-100">
          <p className="font-semibold">Admin only</p>
          <p className="mt-1 text-xs text-rose-200/80">
            You need admin privileges to access this area.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-zinc-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-50">
            Admin &mdash; CryptoPi Dynamics
          </h1>
          <p className="text-xs text-zinc-400">
            Signed in as{" "}
            <span className="font-mono text-emerald-300">
              {session.nickname || session.email}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link
            href="/"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200 hover:border-emerald-500/60 hover:text-emerald-200"
          >
            Back to app
          </Link>
        </div>
      </header>

      <nav className="flex flex-wrap items-center gap-2 text-xs">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-200 hover:border-emerald-500/60 hover:text-emerald-200"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <section className="mt-2 flex-1">{children}</section>
    </main>
  );
}
