// src/app/(server)/auth/session.ts
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/server";
import {
  ensureProfileEmailRow,
  backfillAccountTradesEmail,
} from "@/core/features/cin-aux/accountScope";
import { isEmailSuspended } from "@/lib/auth/suspension";
import { adoptSessionRequestContext } from "@/lib/server/request-context";

export type UserSessionStatus = "active" | "suspended" | "invited" | "unknown";

export type UserSession = {
  userId: string;
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
    userId: user.user_id,
    email: user.email.toLowerCase(),
    nickname,
    isAdmin: !!user.is_admin,
    status,
  };
}

export async function getCurrentSession(): Promise<UserSession | null> {
  const user = await getCurrentUser({ includeInactive: true });
  const session = mapUserToSession(user);
  adoptSessionRequestContext(session);
  return session;
}

export async function requireUserSession(): Promise<UserSession> {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/auth?err=login_required");
  }
  if (session.status === "suspended" || isEmailSuspended(session.email)) {
    redirect("/auth?err=account_suspended");
  }
  try {
    await ensureProfileEmailRow(session.email, session.nickname);
    await backfillAccountTradesEmail(session.email);
  } catch (err) {
    console.warn("[requireUserSession] failed to sync profile email:", err);
  }
  return session;
}
