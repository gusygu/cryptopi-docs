import {
  useCoinsUniverse,
  fetchMatricesLatest,
  fetchMeaGrid,
  fetchPreviewSymbols,
  fetchStrAux,
} from "@/lib/dynamicsClient";

export async function smokeDynamicsClient() {
  if (typeof useCoinsUniverse !== 'function') {
    throw new Error('useCoinsUniverse not exported');
  }
  console.log('[smoke-dynamics-client] client hooks and fetchers present');
  console.log('  fetchMatricesLatest typeof', typeof fetchMatricesLatest);
  console.log('  fetchMeaGrid typeof', typeof fetchMeaGrid);
  console.log('  fetchPreviewSymbols typeof', typeof fetchPreviewSymbols);
  console.log('  fetchStrAux typeof', typeof fetchStrAux);
}

if (process.argv[1]?.endsWith('dynamics-client.mjs')) {
  smokeDynamicsClient()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[smoke-dynamics-client] failed', err);
      process.exit(1);
    });
}
