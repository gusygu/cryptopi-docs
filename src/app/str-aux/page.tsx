import { headers } from "next/headers";
import StrAuxClient from "./StrAuxComponent";
import { resolveSymbolSelection } from "@/core/features/str-aux/symbols";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function fetchPreviewSymbols(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/api/preview/universe/symbols`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.symbols)
      ? json.symbols
          .map((symbol: unknown) => String(symbol ?? "").trim().toUpperCase())
          .filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function resolveStrAuxSymbols(): Promise<string[]> {
  try {
    const hdrs = headers();
    const proto =
      hdrs.get("x-forwarded-proto") ??
      (process.env.NODE_ENV === "production" ? "https" : "http");
    const host =
      hdrs.get("x-forwarded-host") ??
      hdrs.get("host") ??
      process.env.NEXT_PUBLIC_APP_ORIGIN ??
      "localhost:3000";
    const origin = host.startsWith("http") ? host : `${proto}://${host}`;

    const previewSymbols = await fetchPreviewSymbols(origin);
    if (previewSymbols.length) return previewSymbols;

    const url = new URL(`${origin}/str-aux`);
    const selection = await resolveSymbolSelection(url);
    if (selection.symbols.length) return selection.symbols;
    if (selection.defaults.length) return selection.defaults;
  } catch (err) {
    console.warn("[str-aux/page] symbol resolution failed, falling back:", err);
  }
  const fallback = (process.env.NEXT_PUBLIC_COINS ?? "")
    .split(/[\s,]+/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
  return fallback;
}

export default async function StrAuxPage() {
  const symbols = await resolveStrAuxSymbols();
  return <StrAuxClient symbols={symbols} />;
}
