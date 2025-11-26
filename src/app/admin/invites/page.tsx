import { redirect } from "next/navigation";
import { requireUserSession } from "@/app/(server)/auth/session";
import InvitesAdminClient from "./InvitesAdminClient";

export default async function InvitesAdminPage() {
  const session = await requireUserSession();

  if (!session.isAdmin) {
    // you can change this to a 404 or something more subtle if you prefer
    redirect("/auth?err=forbidden");
  }

  return <InvitesAdminClient />;
}
