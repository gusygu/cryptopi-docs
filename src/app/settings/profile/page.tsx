import { requireUserSession } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";
import { revalidatePath } from "next/cache";

async function updateProfile(formData: FormData) {
  "use server";

  const session = await requireUserSession();
  const nickname = (formData.get("nickname") ?? "").toString().trim();

  await sql`
    UPDATE auth.user_account
    SET nickname = ${nickname}, updated_at = now()
    WHERE lower(email) = ${session.email.toLowerCase()}
  `;

  revalidatePath("/settings/profile");
}

export default async function ProfilePage() {
  const session = await requireUserSession();

  const rows = await sql`
    SELECT email, nickname, created_at, last_login_at
    FROM auth.user_account
    WHERE lower(email) = ${session.email.toLowerCase()}
    LIMIT 1
  `;

  const user = rows[0];

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-lg font-semibold text-zinc-50">Profile</h1>
      <p className="text-sm text-zinc-400 mb-6">
        Manage your public information.
      </p>

      <form action={updateProfile} className="space-y-4">
        <div>
          <label className="block text-xs text-zinc-400">Email</label>
          <input
            type="email"
            readOnly
            value={user.email}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-400 opacity-70"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400">Nickname</label>
          <input
            type="text"
            name="nickname"
            defaultValue={user.nickname ?? ""}
            placeholder="Your display name"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          className="rounded-md border border-emerald-500/50 bg-emerald-600/60 px-4 py-2 text-sm font-medium text-emerald-50 hover:bg-emerald-500"
        >
          Save changes
        </button>
      </form>

      <div className="mt-8 text-xs text-zinc-500 space-y-1">
        <p>Member since: {new Date(user.created_at).toLocaleString()}</p>
        <p>
          Last login:{" "}
          {user.last_login_at
            ? new Date(user.last_login_at).toLocaleString()
            : "—"}
        </p>
      </div>
    </main>
  );
}
