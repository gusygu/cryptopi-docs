// src/app/(server)/auth/session.ts
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/server";

export type UserSessionStatus = "active" | "suspended" | "invited" | "unknown";

export type UserSession = {
  email: string;
  nickname: string | null;
  isAdmin: boolean;
  status: UserSessionStatus;
};

export async function readSessionEmail(): Promise<string | null> {
  const user = await getCurrentUser({ includeInactive: true });
  return user?.email?.toLowerCase() ?? null;
}

function mapUserToSession(user: Awaited<ReturnType<typeof getCurrentUser>>): UserSession | null {
  if (!user) return null;
  const status = (user.status as UserSessionStatus) ?? "unknown";
  const nickname =
    user.nickname ||
    (user.email.includes("@") ? user.email.split("@")[0] : user.email);

  return {
    email: user.email.toLowerCase(),
    nickname,
    isAdmin: !!user.is_admin,
    status,
  };
}

export async function getCurrentSession(): Promise<UserSession | null> {
  const user = await getCurrentUser({ includeInactive: true });
  return mapUserToSession(user);
}

export async function requireUserSession(): Promise<UserSession> {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/auth?err=login_required");
  }
  if (session.status === "suspended") {
    redirect("/auth?err=account_suspended");
  }
  return session;
}
