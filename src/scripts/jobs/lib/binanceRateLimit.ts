export function isWeightLimitError(err: unknown): boolean {
  if (!err) return false;
  const maybeCode = typeof err === "object" && err !== null && "code" in err ? (err as any).code : undefined;
  if (maybeCode === -1003) return true;
  const message =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : String(err ?? "");
  return /-1003/.test(message) || /request weight/i.test(message) || /IP banned/i.test(message) || /HTTP 418/.test(message);
}

export function formatWeightLimitMessage(label: string, waitMs: number): string {
  const seconds = Math.ceil(waitMs / 1000);
  return `[${label}] Binance request weight exceeded. Backing off for ${seconds}s.`;
}
