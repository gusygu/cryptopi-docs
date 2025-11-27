import { requireUserSession } from "@/app/(server)/auth/session";
import AdminAuditClient from "@/components/audit/AdminAuditClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminAuditPage() {
  const session = await requireUserSession();
  if (!session.isAdmin) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center bg-black">
        <div className="rounded-xl border border-rose-800 bg-rose-950/70 px-6 py-5 text-sm text-rose-100">
          <p className="font-semibold">Access denied</p>
          <p className="mt-1 text-xs text-rose-200/80">
            You need admin privileges to access this audit dashboard.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 text-sm text-zinc-100">
      <AdminAuditClient />
    </main>
  );
}
