import crypto from 'crypto';
import { withTx } from '@/lib/db.server';
import { BinanceClient } from '@/lib/binance';


function apiKeyHash(key: string) {
return crypto.createHash('sha256').update(key).digest('hex');
}


export async function syncSpotBalances({ label, apiKey }:{ label: string; apiKey: string }) {
const binance = new BinanceClient();
const account = await binance.accountInfo();


return withTx(async (client) => {
const { rows: [{ cin_upsert_wallet }] } = await client.query(
'select strategy_aux.cin_upsert_wallet($1,$2) as cin_upsert_wallet',
[label, apiKeyHash(apiKey)]
);
const walletId: number = cin_upsert_wallet;


// Insert snapshot rows
for (const b of account.balances) {
// Skip zero balances to keep table lean; adjust if you prefer full book
if (b.free === '0' && b.locked === '0') continue;
await client.query(
`insert into strategy_aux.cin_balance_snapshot(wallet_id, asset, free_units, locked_units)
values ($1,$2,$3,$4)`,
[walletId, b.asset, b.free, b.locked]
);
}


return { walletId, count: account.balances.length };
});
}