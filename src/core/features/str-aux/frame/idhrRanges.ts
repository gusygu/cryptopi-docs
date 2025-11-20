import { computeIdhrBins } from "./idhr";

export type PricePoint = {
  price: number;
  ts?: number;
};

export type ReturnRange = {
  min: number;
  max: number;
};

export type IdhrRangeInfo = {
  ranges: ReturnRange[];
  selectedPrimaries: number[];
  selectedBins: number[];
  anchor: number | null;
};

type OrderedPoint = { ts: number; price: number };

function orderPoints(points: PricePoint[]): OrderedPoint[] {
  return points
    .map((pt, idx) => {
      const price = Number(pt.price);
      if (!(price > 0)) return null;
      const ts = Number.isFinite(pt.ts) ? Number(pt.ts) : idx;
      return { price, ts };
    })
    .filter((p): p is OrderedPoint => Boolean(p))
    .sort((a, b) => a.ts - b.ts);
}

function buildRanges(
  selectedPrimaries: number[],
  edges: number[],
  secondaryBins: number,
  binWidth: number
): ReturnRange[] {
  const ranges: ReturnRange[] = [];
  for (const primary of selectedPrimaries) {
    const start = primary * secondaryBins;
    const end = Math.min(edges.length - 1, start + secondaryBins - 1);
    if (start < 0 || end >= edges.length) continue;
    const min = edges[start] - binWidth / 2;
    const max = edges[end] + binWidth / 2;
    ranges.push({ min, max });
  }
  return ranges;
}

export function deriveIdhrRanges(points: PricePoint[]): IdhrRangeInfo {
  const ordered = orderPoints(points);
  if (ordered.length < 2) {
    return { ranges: [], selectedPrimaries: [], selectedBins: [], anchor: null };
  }

  const anchor = ordered[0]?.price ?? null;
  if (!(anchor && anchor > 0)) {
    return { ranges: [], selectedPrimaries: [], selectedBins: [], anchor: null };
  }

  const opening = { benchmark: anchor };
  const bins = computeIdhrBins(ordered as any, opening as any, {
    primaryBins: 16,
    secondaryBins: 16,
    selectedBins: 16,
  });

  const ranges = buildRanges(
    bins.selectedPrimaries ?? [],
    bins.edges ?? [],
    bins.secondaryBins,
    bins.binWidth ?? 0
  );

  return {
    ranges,
    selectedPrimaries: bins.selectedPrimaries ?? [],
    selectedBins: bins.selectedBins ?? [],
    anchor,
  };
}

export function filterByIdhrRanges<T extends PricePoint>(
  points: T[],
  info: IdhrRangeInfo
): T[] {
  if (!info.anchor || !info.ranges.length) {
    return points;
  }
  const anchor = info.anchor;

  const filtered = points.filter((pt) => {
    const price = Number(pt.price);
    if (!(price > 0)) return false;
    const ret = Math.log(price / anchor);
    return info.ranges.some((range) => ret >= range.min && ret <= range.max);
  });

  return filtered.length ? filtered : points;
}
