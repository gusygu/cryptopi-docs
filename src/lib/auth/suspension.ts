function parseList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

const suspendedEmails = new Set(parseList(process.env.AUTH_SUSPEND_LIST));
const excludedEmails = new Set(
  parseList(process.env.AUTH_SUSPEND_EXCLUDE_LIST)
);

export function getSuspendedEmails(): string[] {
  return Array.from(suspendedEmails);
}

export function getExcludedEmails(): string[] {
  return Array.from(excludedEmails);
}

export function isEmailExcluded(email: string): boolean {
  return excludedEmails.has(email.toLowerCase());
}

export function isEmailSuspended(email: string): boolean {
  const normalized = email.toLowerCase();
  if (isEmailExcluded(normalized)) return false;
  return suspendedEmails.has(normalized);
}
