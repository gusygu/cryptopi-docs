import { requireUserSession } from "@/app/(server)/auth/session";
import UserAuditClient from "@/components/audit/UserAuditClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AuditPage() {
  await requireUserSession();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-zinc-100">
      <UserAuditClient />
    </main>
  );
}
