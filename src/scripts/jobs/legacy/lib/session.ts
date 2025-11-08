import type { PoolClient } from 'pg';

export async function beginSession(client: PoolClient, label: string) {
  const { rows } = await client.query<{ sid: string }>(
    `SELECT public.begin_cp_session($1) AS sid`,
    [label]
  );
  return rows[0].sid;
}

export async function endSession(client: PoolClient, sid: string) {
  await client.query(`SELECT public.end_cp_session($1)`, [sid]);
}
