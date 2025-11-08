import { GET as marketGet } from "@/app/api/market/route";
import { GET as vitalsGet } from "@/app/api/vitals/route";

export async function smokeMarketRoutes() {
  const marketRes = await marketGet(new Request('https://example.com/api/market'));
  const marketJson = await marketRes.json();
  if (!marketJson?.routes?.providers) throw new Error('market route missing providers link');

  const vitalsRes = await vitalsGet(new Request('https://example.com/api/vitals'));
  const vitalsJson = await vitalsRes.json();
  if (!vitalsJson?.ok) throw new Error('vitals route reported failure');
  console.log('[smoke-market-routes] market routes:', Object.keys(marketJson.routes).join(', '));
  console.log('[smoke-market-routes] vitals status scope:', vitalsJson.status?.scope ?? 'n/a');
}

if (process.argv[1]?.endsWith('market-routes.mjs')) {
  smokeMarketRoutes()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[smoke-market-routes] failed', err);
      process.exit(1);
    });
}
