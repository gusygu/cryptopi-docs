export type PreviewSource = "preview" | "empty" | "error";

export async function getPreviewSymbols(
  coins: string[]
): Promise<{ symbols: string[]; source: PreviewSource }> {
  try {
    const params = new URLSearchParams();
    if (coins.length) params.set("coins", coins.map((s) => String(s).toUpperCase()).join(","));
    const qs = params.toString();
    const response = await fetch(`/api/preview/universe/symbols${qs ? `?${qs}` : ""}`, {
      cache: "no-store",
    });

    if (!response.ok) return { symbols: [], source: "error" };

    const payload = (await response.json()) as { symbols?: unknown };
    const rawSymbols = Array.isArray(payload.symbols) ? payload.symbols : [];
    const symbols = rawSymbols
      .map((value) => (typeof value === "string" ? value : String(value ?? "")))
      .filter(Boolean)
      .map((value) => value.toUpperCase());

    return {
      symbols,
      source: symbols.length ? "preview" : "empty",
    };
  } catch {
    return { symbols: [], source: "error" };
  }
}
