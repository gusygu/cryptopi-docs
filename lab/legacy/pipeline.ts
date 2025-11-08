// lab/legacy/pipeline.ts
// Backwards-compatible wrappers that now delegate to the new pipeline orchestrator.

import { parseDuration } from "@/core/db/session";
import { runCycleNow } from "@/core/pipeline/index";
import type { MatricesCycleResult } from "@/core/pipelines/pipeline";
import type { PipelineSettings } from "@/core/pipelines/types";
import { loadSettings } from "@/core/settings";

export type RunOnceOpts = {
  coins?: string[];
  sessionId?: string;
};

export type PipelineRunResult = {
  ok: true;
  ts_ms: number;
  coins: string[];
  bases: string[];
  quote: string;
  matrices: MatricesCycleResult["matrices"];
  snapshot: MatricesCycleResult["snapshot"];
  orderBooks: MatricesCycleResult["orderBooks"];
  wallet: MatricesCycleResult["wallet"];
  wrote?: MatricesCycleResult["persisted"];
  cycle: MatricesCycleResult;
};

const DEFAULT_WAIT_MS = 40_000;

function normalizeTokens(list: string[] | undefined | null): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((token) => String(token ?? "").trim().toUpperCase())
    .filter(Boolean);
}

function selectBases(
  preferred: string[] | undefined,
  quote: string,
  fallback: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (token: string) => {
    if (!token || token === quote || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };

  for (const token of normalizeTokens(preferred)) push(token);
  if (out.length) return out;

  for (const token of fallback) push(token);
  return out.length ? out : fallback;
}

function resolvePeriodMs(period: number | string): number {
  return typeof period === "number"
    ? Math.max(1, Math.floor(period))
    : Math.max(1, parseDuration(period));
}

async function runOnceInternal(
  opts: RunOnceOpts,
  providedSettings?: PipelineSettings,
): Promise<PipelineRunResult> {
  const baseSettings = providedSettings ?? (await loadSettings());
  const quote = baseSettings.matrices.quote.toUpperCase();
  const fallbackBases = baseSettings.matrices.bases;

  const bases = selectBases(opts.coins, quote, fallbackBases);
  const settings: PipelineSettings = {
    ...baseSettings,
    matrices: {
      ...baseSettings.matrices,
      bases,
      quote,
      persist: baseSettings.matrices.persist ?? true,
    },
  };

  const cycle = await runCycleNow(settings, {
    reason: "manual",
    appSessionId: opts.sessionId ?? null,
  });

  const coins = [...cycle.bases];
  if (!coins.includes(cycle.quote)) coins.push(cycle.quote);

  return {
    ok: true,
    ts_ms: cycle.ts_ms,
    coins,
    bases: cycle.bases,
    quote: cycle.quote,
    matrices: cycle.matrices,
    snapshot: cycle.snapshot,
    orderBooks: cycle.orderBooks,
    wallet: cycle.wallet,
    wrote: cycle.persisted,
    cycle,
  };
}

export async function buildAndPersistOnce(opts: RunOnceOpts = {}): Promise<PipelineRunResult> {
  return runOnceInternal(opts);
}

let _timer: NodeJS.Timeout | null = null;
let _running = false;

export function startAutoRefresh() {
  if (_timer) return false;

  const loop = async () => {
    if (_running) {
      _timer = setTimeout(loop, 1_000);
      return;
    }
    _running = true;

    let waitMs = DEFAULT_WAIT_MS;
    try {
      const settings = await loadSettings();
      waitMs = Math.max(500, resolvePeriodMs(settings.matrices.period));
      await runOnceInternal({}, settings);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[pipeline] cycle error", error);
    } finally {
      _running = false;
      _timer = setTimeout(loop, waitMs);
    }
  };

  _timer = setTimeout(loop, 0);
  // eslint-disable-next-line no-console
  console.info("[pipeline] auto-refresh started");
  return true;
}

export function stopAutoRefresh() {
  if (_timer) clearTimeout(_timer);
  _timer = null;
}

export function isAutoRefreshRunning() {
  return _timer != null;
}

export async function runOnce(opts?: RunOnceOpts) {
  return buildAndPersistOnce(opts);
}
