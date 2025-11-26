import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getValidInviteByToken, createUserFromInvite } from "@/app/(server)/auth/invites";

type Props = {
  searchParams?: {
    invite?: string;
    [key: string]: string | string[] | undefined;
  };
};

async function registerFromInvite(formData: FormData) {
  "use server";

  const token = (formData.get("invite_token") ?? "").toString().trim();
  const nickname =
    (formData.get("nickname") ?? "").toString().trim() || null;

  if (!token) {
    redirect("/auth?err=missing_invite");
  }

  const user = await createUserFromInvite(token, nickname);
  if (!user) {
    // invalid token, expired, or user already exists
    redirect("/auth?err=invalid_or_used_invite");
  }

  // Set session cookie (keep same format you already use: "email|timestamp")
  const jar = await cookies();
  const sessionVal = `${user.email}|${Date.now()}`;

  jar.set("session", sessionVal, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  redirect("/");
}

export default async function RegisterPage({ searchParams }: Props) {
  const token =
    typeof searchParams?.invite === "string"
      ? searchParams.invite.trim()
      : "";

  if (!token) {
    redirect("/auth?err=missing_invite");
  }

  const invite = await getValidInviteByToken(token);
  if (!invite) {
    redirect("/auth?err=invalid_or_used_invite");
  }

  const email = invite.email;
  const suggestedNickname =
    invite.requested_nickname ||
    (email.includes("@") ? email.split("@")[0] : email);

  return (
    <main className="flex min-h-[80vh] items-center justify-center bg-black">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950/80 px-6 py-6 shadow-lg">
        <h1 className="mb-2 text-lg font-semibold text-zinc-50">
          Complete your registration
        </h1>
        <p className="mb-4 text-sm text-zinc-400">
          You&apos;ve been invited to access{" "}
          <span className="font-semibold text-emerald-300">
            CryptoPi Dynamics
          </span>
          . Confirm your details below to finish.
        </p>

        <form action={registerFromInvite} className="space-y-4">
          <input type="hidden" name="invite_token" value={token} />

          <div>
            <label className="block text-xs font-medium text-zinc-300">
              Email
            </label>
            <input
              type="email"
              name="email"
              readOnly
              value={email}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 opacity-80"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              This email comes from the invite and can&apos;t be changed.
            </p>
          </div>

          <div>
            <label
              htmlFor="nickname"
              className="block text-xs font-medium text-zinc-300"
            >
              Nickname
            </label>
            <input
              id="nickname"
              name="nickname"
              type="text"
              defaultValue={suggestedNickname}
              placeholder="How should we display you?"
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-0"
            />
          </div>

          <button
            type="submit"
            className="mt-2 inline-flex w-full items-center justify-center rounded-md border border-emerald-500/70 bg-emerald-600/80 px-3 py-1.5 text-sm font-medium text-emerald-50 transition hover:bg-emerald-500"
          >
            Complete registration
          </button>
        </form>

        <p className="mt-4 text-xs text-zinc-500">
          Already registered?{" "}
          <a
            href="/auth"
            className="text-emerald-300 underline-offset-2 hover:underline"
          >
            Go to sign in
          </a>
          .
        </p>
      </div>
    </main>
  );
}
