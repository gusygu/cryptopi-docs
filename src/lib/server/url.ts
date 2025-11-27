import { headers } from "next/headers";

function normalizePath(path: string) {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function cleanBase(base: string) {
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

/**
 * Builds an absolute URL for server-side fetches that need to hit our own API.
 * Prefers NEXT_PUBLIC_BASE_URL (or APP_BASE_URL), otherwise falls back to the
 * current request host so the call keeps working in dev/staging without extra env.
 */
export function buildInternalUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  const envBase =
    cleanBase(process.env.NEXT_PUBLIC_BASE_URL || "") ||
    cleanBase(process.env.APP_BASE_URL || "");

  if (envBase) {
    return `${envBase}${normalizedPath}`;
  }

  const hdr = headers();
  const host = hdr.get("x-forwarded-host") || hdr.get("host");
  const proto = hdr.get("x-forwarded-proto") || "http";

  if (!host) {
    // fall back to relative path; fetch() will resolve it for serverless runtimes
    return normalizedPath;
  }

  return `${proto}://${host}${normalizedPath}`;
}
