import { getTierWeighting, DEFAULT_TIER_RULES } from "@/core/features/mea-aux/tiers";

export async function smokeMeaAux() {
  const metrics = {
    GFMdelta: 1.2,
    vSwap: 0.5,
    Inertia: 0.3,
    Disrupt: 0.1,
    Amp: 0.8,
    Volt: 0.6,
  };
  const tier = getTierWeighting(metrics, DEFAULT_TIER_RULES);
  console.log("[smoke-mea-aux] tier", tier.id, "weight", tier.weight.toFixed(2));
  if (!tier || typeof tier.weight !== "number") {
    throw new Error("Tier weighting failed");
  }
}

if (process.argv[1]?.endsWith("mea-aux.mjs")) {
  smokeMeaAux()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[smoke-mea-aux] failed', err);
      process.exit(1);
    });
}
