import { Client } from 'pg';

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: 'inspect-perms'
  });
  await client.connect();

  const show = async (label:string, sql:string, params:any[] = []) => {
    const { rows } = await client.query(sql, params);
    console.log(`\n[${label}]`); console.table(rows);
  };

  await show('whoami',
`select current_user, session_user, current_database(), current_schema, version()`);

  await show('search_path',
`show search_path`);

  // What the refresher needs to read/write
  await show('table grants (session)',
`select table_schema, table_name, privilege_type, grantee
   from information_schema.role_table_grants
  where (table_schema, table_name) in (('strategy_aux','str_aux_session'))
  order by privilege_type, grantee`);

  await show('table grants (snapshots)',
`select table_schema, table_name, privilege_type, grantee
   from information_schema.role_table_grants
  where (table_schema, table_name) in (('public','strategy_aux_snapshots'))
  order by privilege_type, grantee`);

  // Sequences under strategy_aux (for identity/serial columns)
  await show('sequences in strategy_aux',
`select sequence_schema, sequence_name
   from information_schema.sequences
  where sequence_schema='strategy_aux'`);

  await client.end();
}
main().catch(e => { console.error('[inspect-perms]', e?.message || e); process.exit(1); });
