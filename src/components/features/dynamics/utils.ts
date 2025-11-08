// src/components/features/dynamics/utils.ts
export type ClassValue = string | false | null | undefined;

export function classNames(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

export type FormatNumberOptions = {
  precision?: number;
  minimumFractionDigits?: number;
  fallback?: string;
  sign?: "auto" | "always";
};

export function formatNumber(value: unknown, options: FormatNumberOptions = {}): string {
  const {
    precision = 4,
    minimumFractionDigits,
    fallback = "-",
    sign = "auto",
  } = options;

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;

  const formatted = numeric.toLocaleString(undefined, {
    minimumFractionDigits: minimumFractionDigits ?? Math.min(precision, 2),
    maximumFractionDigits: precision,
  });

  if (sign === "always" && numeric > 0) {
    return `+${formatted}`;
  }

  return formatted;
}

export function formatPercent(value: unknown, options: FormatNumberOptions = {}): string {
  const formatted = formatNumber(value, { precision: 4, ...options });
  return formatted === options.fallback ? formatted : `${formatted}%`;
}

export function uniqueUpper(tokens: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens ?? []) {
    const token = String(raw ?? "").trim().toUpperCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}
