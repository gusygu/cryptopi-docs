// src/components/ui/heat.ts
export type HeatOpts = {
  min?: number;            // valor mínimo (negativo)
  max?: number;            // valor máximo (positivo)
  alpha?: number;          // opacidade do fundo
};

export function heatStyle(value: number | null | undefined, opts: HeatOpts = {}) {
  const v = typeof value === "number" && isFinite(value) ? value : 0;

  // limites default pensados para %s pequenos; ajuste se precisar
  const min = opts.min ?? -0.05;   // -5%
  const max = opts.max ??  0.05;   // +5%
  const alpha = opts.alpha ?? Number(getCss("--heat-alpha")) || 0.28;

  // normaliza |v| para [0..1] em cada lado
  const sideMax = v >= 0 ? Math.max(1e-9, max) : Math.max(1e-9, -min);
  const t = Math.max(0, Math.min(1, Math.abs(v) / sideMax));

  // tons principais (match do screenshot)
  const hue = v >= 0 ? getCss("--heat-hue-pos", 38) : getCss("--heat-hue-neg", 268);
  const sat = 92; // %
  // mais claro perto de 0, mais brilhante no extremo
  const lightBg = 15 + Math.round(t * 14);    // 15%..29%
  const lightTxt = 88 - Math.round(t * 24);   // 88%..64%
  const lightBd = 30 + Math.round(t * 22);    // 30%..52%

  const bg  = `hsl(${hue} ${sat}% ${lightBg}% / ${alpha})`;
  const bd  = `hsl(${hue} 98% ${lightBd}% / .95)`;
  const txt = `hsl(${hue} 100% ${lightTxt}%)`;

  return { backgroundColor: bg, borderColor: bd, color: txt };
}

function getCss(name: string, fallback?: number) {
  if (typeof window === "undefined") return fallback ?? 0;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = Number(v);
  return Number.isFinite(n) ? n : (fallback ?? 0);
}
