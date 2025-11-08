import {
  inertiaFromReturns,
  disruptionInstant,
  ampFromSeries,
  voltFromSeries,
} from "@/core/features/str-aux/calc/metrics";

export async function smokeStrAuxCalcs() {
  const returns = [0.4, -0.2, 0.1, 0.3];
  const inertia = inertiaFromReturns(returns, { window: returns.length, scale: 100 });
  const disrupt = disruptionInstant(returns.map((r) => r * 5));
  const amp = ampFromSeries(returns, { scale: 100 });
  const volt = voltFromSeries(returns, { window: returns.length });
  if (!Number.isFinite(inertia)) throw new Error("inertiaFromReturns produced NaN");
  console.log("[smoke-str-aux-calcs] inertia", inertia.toFixed(2), "disruption", disrupt.toFixed(2), "amp", amp.toFixed(2), "volt", volt.toFixed(2));
}

if (process.argv[1]?.endsWith("str-aux-calcs.mjs")) {
  smokeStrAuxCalcs()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[smoke-str-aux-calcs] failed', err);
      process.exit(1);
    });
}
