// src/core/features/matrices/selector.ts

import type { MatrixRow } from "./matrices/schema";
import type { SelectorParams, PriceBook, ReferenceSelector } from "../../../lab/legacy/types";

// If you have a DB function available, you can import and wire it here.
// import { getOpeningFromDb } from "@/core/db/db";

// --- utilities ----------------------------------------------------------------

const sym = (base: string, quote: string) => `${base}/${quote}`;
const k = (base: string, quote: string) => `${base}/${quote}`;

// pull direct price
function getDirect(book: PriceBook, base: string, quote: string): number | null {
  const v = book.direct[k(base, quote)];
  return Number.isFinite(v) ? v : null;
}
// derive inverse if the opposite direct exists
function getInverse(book: PriceBook, base: string, quote: string): number | null {
  const inv = book.direct[k(quote, base)];
  return Number.isFinite(inv) && inv !== 0 ? 1 / inv : null;
}
// fall back to USDT-bridged
function getBridged(book: PriceBook, base: string, quote: string): number | null {
  const a = book.usdt?.[k(base, "USDT")];
  const b = book.usdt?.[k(quote, "USDT")];
  return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a! / b! : null;
}

type Derivation = "direct" | "inverse" | "bridged" | "none";
function resolvePairPrice(
  book: PriceBook,
  base: string,
  quote: string
): { price: number | null; derivation: Derivation } {
  const d = getDirect(book, base, quote);
  if (d != null) return { price: d, derivation: "direct" };
  const inv = getInverse(book, base, quote);
  if (inv != null) return { price: inv, derivation: "inverse" };
  const br = getBridged(book, base, quote);
  if (br != null) return { price: br, derivation: "bridged" };
  return { price: null, derivation: "none" };
}

// Reference computation (kept simple and local):
// - custom override
// - opening from priceBook.open24h as a pragmatic default (you can swap for DB opening)
async function resolveReferenceValue(
  base: string,
  quote: string,
  book: PriceBook,
  ref?: ReferenceSelector,
  _opts?: { appSessionId?: string | null; window?: string }
): Promise<{ value: number | null; source: string | null }> {
  if (ref?.kind === "custom") {
    return { value: Number(ref.overrideValue ?? null), source: "custom" };
  }

  // If you have DB-backed opening, replace below with getOpeningFromDb({ base, quote, window, appSessionId })
  // and return that price as the reference ("opening").
  const open24 = book.open24h?.[k(base, quote)];
  if (Number.isFinite(open24)) return { value: open24!, source: "opening:local" };

  return { value: null, source: null };
}

// Return { pct_ref, ref } following the contract used by the /matrices UI
// See project code that computes a similar "ref block" (:contentReference[oaicite:2]{index=2})
function computeRefBlock(benchmarkNew: number | null, refValue: number | null) {
  if (!Number.isFinite(benchmarkNew) || !Number.isFinite(refValue) || !refValue) {
    return { pct_ref: null as number | null, ref: Number.isFinite(refValue!) ? Number(refValue) : null };
  }
  const pct_ref = (benchmarkNew! - refValue!) / refValue!;
  return { pct_ref, ref: refValue! };
}

// --- main selector -------------------------------------------------------------

/**
 * getMatricesRaw
 * Produces rows shaped for the Matrices table (symbol, benchPct, pctDrv, pct24h, pct_ref, ref, id_pct, ...)
 * The function is data-source–agnostic; feed it the current/prev/open24h priceBook.
 *
 * NOTE on fields:
 *  - benchPct: we keep it `null` here (your UI has a dedicated pct24h and pctDrv already).
 *              If you prefer, map it to pctDrv or another signal.
 *  - pctDrv:   derived from prev snapshot (book.prev).
 *  - pct24h:   derived from open24h.
 *  - pct_ref/ref: computed using resolveReferenceValue + computeRefBlock.
 *  - id_pct:   left null (wire from your calc layer when ready).
 */
export async function getMatricesRaw({
  bases,
  quote = "USDT",
  priceBook,
  appSessionId = null,
  window = "1h",
  ref,
}: SelectorParams): Promise<MatrixRow[]> {
  const rows: MatrixRow[] = [];
  const Q = String(quote).toUpperCase();

  for (const bRaw of bases ?? []) {
    const base = String(bRaw).toUpperCase();
    if (!base || base === Q) continue;

    const { price: bench, derivation } = resolvePairPrice(priceBook, base, Q);

    // deltas vs prev and 24h
    const prev = priceBook.prev?.[k(base, Q)];
    const open24 = priceBook.open24h?.[k(base, Q)];
    const delta = Number.isFinite(bench) && Number.isFinite(prev) ? (bench as number) - (prev as number) : null;
    const pctDrv =
      Number.isFinite(bench) && Number.isFinite(prev) && Math.abs(Number(prev)) > 1e-12
        ? ((bench as number) - (prev as number)) / Math.max(Math.abs(Number(prev)), 1e-12)
        : null;
    const pct24h =
      Number.isFinite(bench) && Number.isFinite(open24) && Math.abs(Number(open24)) > 1e-12
        ? ((bench as number) - (open24 as number)) / Number(open24)
        : null;

    // reference
    const refResolved = await resolveReferenceValue(base, Q, priceBook, ref, { appSessionId, window });
    const { pct_ref, ref: refValue } = computeRefBlock(Number.isFinite(bench) ? (bench as number) : null, refResolved.value);

    // bridged flag is useful for UI copy/rings even if color is handled elsewhere
    const bridged = derivation === "bridged";

    // build the row aligned to the /matrices UI contract (:contentReference[oaicite:3]{index=3})
    rows.push({
      symbol: sym(base, Q),
      base,
      quote: Q,
      // visualization-first fields
      benchPct: null,               // keep null unless you want to map this to pctDrv or another signal
      pctDrv: pctDrv ?? null,
      pct24h: pct24h ?? null,
      pct_ref: pct_ref ?? null,
      ref: refValue ?? null,
      id_pct: null,                 // not computed here — wire from calc layer when available
      // extras (used by UI or future blocks)
      benchmark: Number.isFinite(bench) ? (bench as number) : null,
      delta: Number.isFinite(delta) ? (delta as number) : null,
      pct_drv: pctDrv ?? null,
      frozen: false,                // optional — pipe your cycle frozen-set here when you have it
      bridged,
    });
  }

  return rows;
}
