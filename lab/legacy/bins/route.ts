import { NextResponse } from "next/server";

import type { WindowKey, MarketPoint, OpeningExact } from "../auxiliary/str-aux/types";
import { computeIdhrBinsN, computeFM } from "../auxiliary/str-aux/population/idhr";
import { getOrInitSymbolSession, updateSymbolSession, exportStreams } from "../auxiliary/str-aux/session";
import { upsertSession } from "@/lib/str-aux/sessionDb";

import {
  fetchKlines,
  fetchOrderBook,
  fetchTicker24h,
  fetch24hAll,
  type RawKline,
} from "@/core/sources/binance";

import { getAll as getSettings } from "@/lib/settings/server";
import {
  pairsFromSettings,
  usdtLegsFromCoins,
  normalizeCoin,
  type PairAvailability,
} from "@/lib/markets/pairs";

import { getPool } from "legacy/pool";

/* -------------------------------------------------------------------------- */

export const dynamic = "force-dynamic";

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  pragma: "no-cache",
  expires: "0",
  "surrogate-control": "no-store",
};

/* -------------------------------- config ---------------------------------- */

const CONCURRENCY = Math.max(1, Number(process.env.BINANCE_CONCURRENCY ?? 4));
const TIMEOUT_MS  = Math.max(800, Number(process.env.BINANCE_TIMEOUT_MS ?? 2500));
const RECOUNT_ON_BOOT = ["1","true","yes"].includes(String(process.env.STRAUX_RECOUNT_ON_BOOT ?? "1").toLowerCase());

/* ----------------------------- query helpers ------------------------------ */

type Interval = "1m" | "5m" | "15m" | "30m" | "1h";

function windowToInterval(w: WindowKey): { interval: Interval; klineLimit: number } {
  switch (w) {
    case "30m": return { interval: "1m",  klineLimit: 240 };
    case "1h":  return { interval: "1m",  klineLimit: 360 };
    case "3h":  return { interval: "5m",  klineLimit: 240 };
    default:    return { interval: "1m",  klineLimit: 240 };
  }
}

const norm = normalizeCoin;

/** Parse list tokens (coins or symbols) from query. Accepts `coins=` or `pairs=` */
function parseListParam(url: URL, keys = ["coins", "pairs"]): string[] {
  for (const k of keys) {
    const raw = String(url.searchParams.get(k) ?? "").trim();
    if (!raw) continue;
    return raw.toUpperCase().split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
  }
  return [];
}
function parseWindow(s: string | null | undefined): WindowKey {
  const v = (s ?? "30m").toLowerCase();
  return (v === "30m" || v === "1h" || v === "3h") ? (v as WindowKey) : "30m";
}
function parseBinsParam(s: string | null | undefined, dflt = 128) {
  const n = Number(s ?? dflt);
  return Number.isFinite(n) && n > 0 ? Math.min(2048, Math.max(8, Math.floor(n))) : dflt;
}
function parseBool(s: string | null | undefined): boolean {
  const v = String(s ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/* ------------------------------- transforms ------------------------------- */

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS, tag = "op"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms @ ${tag}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function klinesToPoints(kl: RawKline[]): MarketPoint[] {
  return (kl ?? []).map((k) => {
    const openTime = Number(k[0]);   // ms
    const close    = Number(k[4]);   // close price
    const vol      = Number(k[5]);   // base volume
    return { ts: openTime, price: close, volume: Number.isFinite(vol) ? vol : 0 };
  });
}
async function orderbookPoint(symbol: string): Promise<MarketPoint | null> {
  try {
    const ob = await withTimeout(fetchOrderBook(symbol, 100), TIMEOUT_MS, `orderbook:${symbol}`);
    if (Number.isFinite(ob.mid) && ob.mid > 0) {
      const vol = (Number(ob.bidVol) || 0) + (Number(ob.askVol) || 0);
      return { ts: ob.ts, price: ob.mid, volume: vol };
    }
  } catch {}
  return null;
}
async function loadPoints(symbol: string, windowKey: WindowKey, binsN: number): Promise<MarketPoint[]> {
  const { interval, klineLimit } = windowToInterval(windowKey);
  const pts: MarketPoint[] = [];

  try {
    const kl = await withTimeout(fetchKlines(symbol, interval, Math.max(klineLimit, binsN * 2)), TIMEOUT_MS, `klines:${symbol}`);
    pts.push(...klinesToPoints(kl));
  } catch {}

  const obPt = await orderbookPoint(symbol);
  if (obPt) pts.push(obPt);

  // sort + dedup
  const seen = new Set<number>();
  const uniq: MarketPoint[] = [];
  for (const p of pts.sort((a, b) => a.ts - b.ts)) {
    if (!seen.has(p.ts)) { seen.add(p.ts); uniq.push(p); }
  }
  return uniq;
}

/* ------------------- verify / availability helpers ------------------------ */

const QUOTE_ONLY = new Set([
  "USDT","FDUSD","BUSD","TUSD","USDC","TRY","BRL","EUR","GBP","AUD","CAD","CHF","JPY","MXN","ARS","IDR","NGN","ZAR","KRW","INR","RUB","PLN","SEK","NOK","DKK","CZK","HUF","AED","SAR","CLP","COP","PEN","VES","GHS","KES","TZS","UAH","VND"
]);

function genUsdtLegs(bases: string[]): string[] {
  return bases.filter(b => !QUOTE_ONLY.has(b)).map(b => `${b}USDT`);
}

function genCrossPairsFromBases(bases: string[]): string[] {
  const xs: string[] = [];
  for (let i = 0; i < bases.length; i++) {
    for (let j = 0; j < bases.length; j++) {
      if (i === j) continue;
      const a = bases[i], b = bases[j];
      xs.push(`${a}${b}`); // both directions; verifier will prune non-existent ones
    }
  }
  return Array.from(new Set(xs.filter(s => !s.endsWith("USDT"))));
}

async function verifySymbolsMulti(symbols: string[], chunkSize = 150): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    try {
      const arr = await withTimeout(fetch24hAll(chunk), TIMEOUT_MS, `verify:${i}/${symbols.length}`);
      for (const t of arr ?? []) if (t?.symbol) out.add(String(t.symbol).toUpperCase());
    } catch {
      // ignore this chunk; we may fallback later
    }
  }
  return out;
}

/* --------------------------------- opening --------------------------------- */

function ensureOpening(points: MarketPoint[], fallbackPrice: number, tsNow: number): OpeningExact {
  const p0 = Number(points[0]?.price ?? fallbackPrice ?? 0);
  return {
    benchmark: p0 > 0 ? p0 : 0,
    pct24h: 0,
    id_pct: 0,
    ts: Number(points[0]?.ts ?? tsNow),
    layoutHash: "str-aux:idhr-128",
  };
}

/* --------------------------- symbol split ---------------------------------- */

const KNOWN_QUOTES = ["USDT","BTC","ETH","BNB","FDUSD","BUSD","TUSD","USDC","TRY","BRL"];
function splitSymbol(s: string): { base: string; quote: string } {
  const U = String(s || "").toUpperCase();
  for (const q of KNOWN_QUOTES) {
    if (U.endsWith(q) && U.length > q.length) return { base: U.slice(0, U.length - q.length), quote: q };
  }
  // fallback: 3/4-letter base heuristic
  const base = U.slice(0, 3);
  const quote = U.slice(3) || "USDT";
  return { base, quote };
}

/* ----------------------------- recount on boot ----------------------------- */

const pool = getPool();
const sgn = (x?: number | null) => (!x || !Number.isFinite(x) || x === 0 ? 0 : x > 0 ? 1 : -1);

async function latestSnapshot(appSessionId: string, symbol: string, windowKey: WindowKey) {
  const c = await pool.connect();
  try {
    const r = await c.query(
      `select payload from public.strategy_aux_snapshots
        where app_session_id=$1 and pair=$2 and (win is null or win::text=$3::text)
        order by created_at desc limit 1`,
      [appSessionId, symbol, String(windowKey)]
    );
    return r.rows?.[0]?.payload ?? null;
  } finally {
    c.release();
  }
}

/**
 * Rebuild shifts/swaps/anchor from snapshots if session row missing.
 */
async function recountIfMissing(appSessionId: string, symbol: string, windowKey: WindowKey, kConfirm: number, epsPct: number) {
  const client = await pool.connect();
  try {
    const { base, quote } = splitSymbol(symbol);

    const r0 = await client.query(
      `select 1 from public.strategy_aux_sessions
        where app_session_id=$1 and pair_base=$2 and pair_quote=$3 and window_key=$4 limit 1`,
      [appSessionId, base, quote, windowKey]
    );
    if (r0.rowCount > 0) return;

    const snaps = await client.query(
      `select payload
         from public.strategy_aux_snapshots
        where app_session_id=$1 and pair=$2 and (win is null or win::text=$3::text)
        order by created_at asc
        limit 2000`,
      [appSessionId, symbol, String(windowKey)]
    );
    if (snaps.rowCount === 0) return;

    let gfm_ref_price = 0;
    let gfm_calc_price = 0;
    let shifts = 0, swaps = 0;
    let psShift = 0, psSwap = 0, lastSign = 0;

    let opening_price = 0;
    let price_min: number | null = null, price_max: number | null = null;
    let bench_pct_min: number | null = null, bench_pct_max: number | null = null;
    let last_update_ms: number | null = null;

    for (const row of snaps.rows) {
      const p = row.payload || {};
      const live = p?.cards?.live ?? {};
      const opening = p?.cards?.opening ?? {};
      const fm = p?.fm ?? {};
      const gfmDelta = p?.gfmDelta ?? {};
      const stats = p?.sessionStats ?? {};

      if (!opening_price) opening_price = Number(opening?.benchmark ?? live?.benchmark ?? 0) || opening_price;
      if (!gfm_ref_price) gfm_ref_price = Number(fm?.gfm_ref_price ?? opening_price ?? 0) || gfm_ref_price;

      gfm_calc_price = Number(fm?.gfm_calc_price ?? live?.benchmark ?? gfm_ref_price ?? 0);
      const deltaAbs = Number(gfmDelta?.absPct ?? (gfm_ref_price > 0 && gfm_calc_price > 0 ? Math.abs(gfm_calc_price / gfm_ref_price - 1) : 0));

      if (Number.isFinite(deltaAbs) && deltaAbs >= epsPct) psShift += 1; else psShift = 0;
      if (psShift >= kConfirm && gfm_calc_price > 0) { shifts += 1; gfm_ref_price = gfm_calc_price; psShift = 0; }

      const sign = sgn(Number(live?.pct_drv ?? 0));
      if (sign === 0) psSwap = 0;
      else if (lastSign === 0 || lastSign === sign) { psSwap += 1; lastSign = sign; }
      else { lastSign = sign; psSwap = 1; }
      if (psSwap >= kConfirm) { swaps += 1; psSwap = 0; }

      const lp = Number(live?.benchmark ?? 0);
      price_min = price_min == null ? lp : Math.min(price_min, lp);
      price_max = price_max == null ? lp : Math.max(price_max, lp);
      const pct24 = Number(live?.pct24h ?? 0);
      bench_pct_min = bench_pct_min == null ? pct24 : Math.min(bench_pct_min, pct24);
      bench_pct_max = bench_pct_max == null ? pct24 : Math.max(bench_pct_max, pct24);

      last_update_ms = Number(p?.lastUpdateTs ?? last_update_ms ?? 0) || last_update_ms;
    }

    await client.query(
      `insert into public.strategy_aux_sessions
        (app_session_id, pair_base, pair_quote, window_key,
         opening_price, price_min, price_max, bench_pct_min, bench_pct_max,
         gfm_ref_price, gfm_calc_price, epsilon_pct, k_cycles,
         shifts, swaps, pending_shift_streak, pending_swap_streak, last_pct_drv_sign, last_update_ms)
       values ($1,$2,$3,$4,
               $5,$6,$7,$8,$9,
               $10,$11,$12,$13,
               $14,$15, 0, 0, 0, $16)
       on conflict (app_session_id, pair_base, pair_quote, window_key) do nothing`,
      [
        appSessionId, base, quote, windowKey,
        opening_price || gfm_ref_price || 0,
        price_min, price_max, bench_pct_min, bench_pct_max,
        gfm_ref_price || opening_price || 0,
        gfm_calc_price || gfm_ref_price || 0,
        epsPct, kConfirm,
        shifts, swaps,
        last_update_ms ?? Date.now(),
      ]
    );
  } finally {
    client.release();
  }
}

/* ------------------------------- helpers ---------------------------------- */

function uniq<T>(xs: T[]) { return Array.from(new Set(xs)); }

/* ---------------------------------- GET ------------------------------------ */

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const now = Date.now();

    // Settings universe (coins)
    const settings = await getSettings();
    const settingsBasesRaw = (settings.coinUniverse ?? []).map((s: string) => norm(s)).filter(Boolean);
    const settingsBases = uniq(settingsBasesRaw);

    // Compute verified availability from settings universe (robust to verifier timeouts)
    const availableVerified: PairAvailability = await pairsFromSettings(settingsBases, {
      verify: async (syms) => {
        try { return await verifySymbolsMulti(syms); }
        catch { return new Set<string>(); }
      },
      preferVerifiedUsdt: true,
    });

    // Build cross universe from the same bases; verify (fallback to generated on timeout)
    const crossUniverse = genCrossPairsFromBases(settingsBases);
    let verifiedCross: string[] = [];
    try {
      const set = await verifySymbolsMulti(crossUniverse);
      verifiedCross = Array.from(set);
    } catch {
      // fall through
    }

    const available: PairAvailability = {
      usdt: uniq(genUsdtLegs(settingsBases).concat(availableVerified.usdt ?? [])).filter(s => !s.startsWith("BRL")), // avoid BRLUSDT etc.
      cross: uniq([...(availableVerified.cross ?? []), ...verifiedCross]),
      all: []
    };
    available.all = uniq([...(available.usdt ?? []), ...(available.cross ?? [])]);

    // Client selection: accept coins (→ USDT legs + optional generated crosses) or explicit symbols
    const tokens = parseListParam(url, ["coins", "pairs"]); // e.g., ["BTC","ETH"] or ["ETHBTC","BTCUSDT"]
    const verifiedSet = new Set<string>(available.all ?? []);
    const allowUnverified = parseBool(url.searchParams.get("allowUnverified"));

    let selectedSymbols: string[];
    const tokensLookLikeSymbols = tokens.length > 0 && tokens.every(t => /^[A-Z0-9]{5,}$/.test(t));

    if (!tokens.length) {
      selectedSymbols = available.usdt.slice(); // default
    } else if (tokensLookLikeSymbols) {
      selectedSymbols = (allowUnverified || !verifiedSet.size) ? tokens.slice() : tokens.filter(s => verifiedSet.has(s));
    } else {
      const bases = uniq(tokens.map(norm).filter(Boolean));
      const legs = genUsdtLegs(bases);
      const genCross = allowUnverified ? genCrossPairsFromBases(bases) : [];
      const merged = uniq([...legs, ...genCross]);
      selectedSymbols = (allowUnverified || !verifiedSet.size) ? merged : merged.filter(s => verifiedSet.has(s));
    }

    // Remove known-bad symbols like BRLUSDT
    selectedSymbols = selectedSymbols.filter(s => !s.startsWith("BRL"));

    const windowKey = parseWindow(url.searchParams.get("window"));
    const binsN = parseBinsParam(url.searchParams.get("bins"), 128);
    const appSessionId = (url.searchParams.get("sessionId") ?? "ui").slice(0, 64);

    // empty selection → only advertise availability
    if (!selectedSymbols.length) {
      const headers = new Headers(NO_STORE);
      headers.set("x-cycle-id", String(now));
      return NextResponse.json({
        ok: true, symbols: [], out: {},
        available, selected: [], window: windowKey, ts: now,
        timing: settings.timing ?? undefined,
      }, { headers });
    }

    /* -------------------- K/ε params -------------------- */

    const kConfirm = Math.max(1, Number(process.env.SHIFT_K_CYCLES ?? settings?.timing?.secondaryCycles ?? 3));
    const epsPct   = Math.max(0, Number(process.env.SHIFT_EPS_PCT ?? settings?.thresholds?.gfmShiftEps ?? 0.0025));

    /* ---------- recount on boot (one-time), then normal processing ---------- */
    if (RECOUNT_ON_BOOT) {
      await Promise.allSettled(selectedSymbols.map((sym) => recountIfMissing(appSessionId, sym, windowKey, kConfirm, epsPct)));
    }

    /* -------------------- concurrency-limited runner -------------------- */

    async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
      const ret: R[] = new Array(items.length);
      let i = 0, active = 0;
      return await new Promise((resolve) => {
        const pump = () => {
          while (active < limit && i < items.length) {
            const cur = i++;
            active++;
            fn(items[cur]).then((r) => { ret[cur] = r; }, (e) => { ret[cur] = e as any; })
              .finally(() => { active--; if (i >= items.length && active === 0) resolve(ret); else pump(); });
          }
        };
        pump();
      });
    }

    /* -------------------- per-symbol processing (limited) -------------------- */

    const perSymbol = async (symbol: string) => {
      const { base, quote } = splitSymbol(symbol);
      try {
        const t24 = await withTimeout(fetchTicker24h(symbol), TIMEOUT_MS, `t24:${symbol}`);
        const lastPriceFromTicker = Number((t24 as any)?.lastPrice ?? (t24 as any)?.weightedAvgPrice ?? NaN);
        const pct24h = Number((t24 as any)?.priceChangePercent ?? 0) || 0;

        const points: MarketPoint[] = await loadPoints(symbol, windowKey, binsN);
        if (!points.length || !Number.isFinite(points[points.length - 1]?.price)) {
          throw new Error("no market data");
        }

        const lastPoint = points[points.length - 1];
        const lastPrice = Number.isFinite(lastPoint.price) ? lastPoint.price : lastPriceFromTicker;

        const opening = ensureOpening(points, lastPriceFromTicker, now);
        if (!(opening.benchmark > 0)) throw new Error("opening≤0");

        const ss = getOrInitSymbolSession(appSessionId, symbol, opening.benchmark, now);
        const idhr = computeIdhrBinsN(points, opening, {}, binsN);
        const fm = computeFM(points, opening, { totalBins: binsN });

        const gfmReturns = Number(fm?.gfm ?? 0);
        const gfmCalcPrice = opening.benchmark * Math.exp(gfmReturns);

        const upd = updateSymbolSession(ss, lastPrice, lastPoint.ts ?? now, gfmCalcPrice, pct24h);
        const streams = exportStreams(ss);

        const looksLikeFreshOpen =
          ss.priceMin === ss.openingPrice &&
          ss.priceMax === ss.openingPrice &&
          ss.shifts === 0 &&
          ss.swaps === 0;

        const dbGate = await (upsertSession as any)(
          { base, quote, window: windowKey, appSessionId },
          ss,
          looksLikeFreshOpen,
          {
            nowMs: now,
            kConfirm,
            epsPct,
            pctDrv: ss?.snapCur?.pctDrv ?? 0,
            gfmDeltaAbsPct: upd?.gfmDeltaAbsPct ?? 0,
          }
        );

        const cardOpeningPct = ss.snapPrev?.pct24h ?? pct24h;
        const cardLivePct   = ss.snapCur?.pct24h ?? pct24h;
        const cardLiveDrv   = ss.snapCur?.pctDrv ?? 0;

        return [symbol, {
          ok: true,
          n: points.length,
          bins: binsN,
          window: windowKey,
          cards: {
            opening: { benchmark: ss.openingPrice,                 pct24h: cardOpeningPct },
            live:    { benchmark: ss.snapCur?.price ?? lastPrice,  pct24h: cardLivePct, pct_drv: cardLiveDrv },
          },
          fm: {
            gfm_ref_price: dbGate?.gfm_ref_price ?? ss.gfmRefPrice ?? opening.benchmark,
            gfm_calc_price: ss.gfmCalcPrice ?? gfmCalcPrice,
            sigma: fm?.sigmaGlobal ?? idhr?.sigmaGlobal ?? 0,
            zAbs: fm?.zMeanAbs ?? 0,
            vInner: fm?.vInner ?? 0,
            vOuter: fm?.vOuter ?? 0,
            inertia: fm?.inertia ?? 0,
            disruption: fm?.disruption ?? 0,
            nuclei: (fm?.nuclei ?? []).map((n: any, i: number) => ({ binIndex: Number(n?.key?.idhr ?? i) })),
          },
          gfmDelta: {
            absPct: upd?.gfmDeltaAbsPct ?? 0,
            anchorPrice: dbGate?.gfm_ref_price ?? ss.gfmRefPrice ?? opening.benchmark,
            price: lastPrice
          },
          swaps: dbGate?.swaps ?? ss.swaps ?? 0,
          shifts: {
            nShifts: dbGate?.shifts ?? ss.shifts ?? 0,
            timelapseSec: Math.floor((now - (ss.openingTs ?? now)) / 1000),
            latestTs: lastPoint.ts ?? now
          },
          shift_stamp: Boolean(dbGate?.confirmedShift ?? false),
          sessionStats: { priceMin: ss.priceMin, priceMax: ss.priceMax, benchPctMin: ss.benchPctMin, benchPctMax: ss.benchPctMax },
          streams,
          hist: { counts: idhr?.counts ?? [] },
          meta: { uiEpoch: upd?.uiEpoch ?? ss.uiEpoch },
          lastUpdateTs: lastPoint.ts ?? now,
        }] as const;
      } catch (err: any) {
        // fallback to snapshot payload (if any)
        const snap = await latestSnapshot(appSessionId, symbol, windowKey);
        if (snap?.cards?.live) {
          return [symbol, { ok: true, ...snap, flags: { source: "snapshot" } }] as const;
        }
        return [symbol, { ok: false, error: String(err?.message ?? err) }] as const;
      }
    };

    const results = await mapLimit(selectedSymbols, CONCURRENCY, perSymbol);

    const out: Record<string, any> = {};
    for (const r of results) {
      const [sym, val] = r as any;
      out[sym] = val;
    }

    const symbols = Object.keys(out);
    const headers = new Headers(NO_STORE);
    headers.set("x-cycle-id", String(now));

    return NextResponse.json({
      ok: true,
      symbols,
      out,
      available,                 // includes verified cross-pairs (with fallback)
      selected: selectedSymbols,
      window: windowKey,
      ts: now,
      timing: settings.timing ?? undefined,
    }, { headers });

  } catch (err: any) {
    const headers = new Headers(NO_STORE);
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500, headers });
  }
}
