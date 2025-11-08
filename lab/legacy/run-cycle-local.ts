/**
 * Build a tiny synthetic snapshot and run runMatricesCycle on it.
 * Use --persist 0|1 to skip/write DB.
 *
 * PS:
 *   $env:TS_NODE_TRANSPILE_ONLY="1"; node -r ts-node/register -r tsconfig-paths/register --env-file=.env `
 *   .\src\scripts\shards\run-cycle-local.ts --bases BTC,ETH --quote USDT --period 1m --persist 0
 */
import type { PipelineSettings, PollTick, Logger, LiveSnapshot, PriceBook } from "@/core/pipelines/types";

async function loadRunMatricesCycle(): Promise<(ctx:any, tick:any, snap:LiveSnapshot)=>Promise<any>> {
  const mod = await import("@/core/pipelines/pipeline");
  const fn = (mod as any).runMatricesCycle ?? (mod as any).default?.runMatricesCycle;
  if (!fn) throw new Error("runMatricesCycle not found");
  return fn;
}

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const basesArg  = arg("bases")   ?? process.env.BASES            ?? "BTC,ETH";
const quoteArg  = arg("quote")   ?? process.env.QUOTE            ?? "USDT";
const periodArg = arg("period")  ?? process.env.MATRICES_PERIOD  ?? "1m";
const persistArg= arg("persist") ?? process.env.MATRICES_PERSIST ?? "0";

const BASES = basesArg.split(",").map(s=>s.trim()).filter(Boolean);
const QUOTE = (quoteArg || "USDT").trim();
const PERSIST = /^(1|true)$/i.test(persistArg || "");

function parsePeriod(s: string|number){ if(typeof s==="number") return s;
  const m=String(s).match(/^(\d+)(ms|s|m|h|d)$/i); if(!m) return 60_000;
  const v=+m[1], u=m[2].toLowerCase(); return u==="ms"?v:u==="s"?v*1e3:u==="m"?v*6e4:u==="h"?v*36e5:u==="d"?v*864e5:6e4;
}

const logger: Logger = console as any;
const settings: PipelineSettings = {
  matrices: { bases: BASES, quote: QUOTE, source: "binance", period: periodArg!, persist: PERSIST, window: "1h" },
  scales:   { cycle: { period: periodArg! } }
};

const ms = parsePeriod(settings.matrices.period);
const now = Date.now();
const tick: PollTick = { cycleTs: Math.floor(now/ms)*ms, periodMs: ms, appSessionId: null, reason: "manual", scale: "cycle" };

function makeSnapshot(): LiveSnapshot {
  // price for BTC/USDT and ETH/USDT; everything else empty
  const direct: PriceBook["direct"] = { "BTC/USDT": 65000, "ETH/USDT": 3500 };
  const usdt:   PriceBook["usdt"]   = { "BTC/USDT": 65000, "ETH/USDT": 3500 };
  const open24h:PriceBook["open24h"]= { "BTC/USDT": 64000, "ETH/USDT": 3400 };
  return { priceBook: { direct, usdt, open24h }, orderBooks: {}, wallet: {} };
}

(async () => {
  console.info("[shard:run-cycle-local] cfg", { bases: BASES, quote: QUOTE, persist: PERSIST });
  const runMatricesCycle = await loadRunMatricesCycle();
  const res = await runMatricesCycle({ settings, logger }, tick, makeSnapshot());
  const size = (m?: (number|null)[][]) => (m ? `${m.length}x${m[0]?.length ?? 0}` : "0x0");
  console.info("[shard:run-cycle-local] shapes", {
    nBases: res.bases.length,
    benchmark: size(res.matrices.benchmark),
    delta:     size(res.matrices.delta),
    pct24h:    size(res.matrices.pct24h),
    id_pct:    size(res.matrices.id_pct),
    pct_drv:   size((res as any).matrices?.pct_drv),
  });
  console.info(res.persisted ? "[shard:run-cycle-local] persisted" : "[shard:run-cycle-local] persist skipped", res.persisted ?? "");
})().catch(e => { console.error("[shard:run-cycle-local] error", e); process.exit(1); });

