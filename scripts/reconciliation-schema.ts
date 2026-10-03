import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { stable } from './lib/artifacts';

const guards = [
  {
    table: 'podcast_feed_aliases',
    name: 'guard_public_feed_alias',
    columns: [],
    body: '93e4a3a4a210dc86e0f65f63ee65ccb190c6e7ee4867b429fdcb067014c36090',
  },
  {
    table: 'podcasts',
    name: 'guard_podcast_alias_claim',
    columns: ['feed_url', 'owner_user_id'],
    body: 'bcd1a71f25e6da510e2831b4b2e49e19b82a038604c8b7b73d240b50db332c98',
  },
  {
    table: 'podcast_apple_aliases',
    name: 'guard_public_apple_alias',
    columns: [],
    body: '730bbbddf619445fd225e00426f7751ff95a571ee794c620635a29cab416b42e',
  },
  {
    table: 'podcasts',
    name: 'guard_podcast_apple_claim',
    columns: ['itunes_id', 'owner_user_id'],
    body: '531d908b3b1107cb951332007b54ed45844b1737de48e0c82c153c6c3344f5f9',
  },
];

export async function verifyReconciliationTriggers(
  tx: postgres.TransactionSql,
  tables: string[],
) {
  const relations = tables.map((table) => `public.${table}`);
  const unsupported = await tx`
    SELECT 1 FROM pg_class c WHERE c.oid=ANY(${relations}::regclass[])
      AND (c.relkind <> 'r' OR c.relrowsecurity OR c.relforcerowsecurity
        OR EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class=c.oid))
  `;
  if (unsupported.length)
    throw new Error('Relation policies require a tool review');
  const triggers = await tx`
    SELECT c.relname AS table, t.tgname AS name, t.tgenabled, t.tgtype,
      t.tgqual IS NULL AS unconditional, t.tgnargs, t.tgconstraint::text,
      ARRAY(SELECT a.attname FROM pg_attribute a WHERE a.attrelid=t.tgrelid
        AND a.attnum=ANY(t.tgattr) ORDER BY a.attname) AS columns,
      n.nspname AS function_schema, p.proname, p.prosrc, p.prosecdef, p.proconfig,
      p.pronargs, p.prorettype='trigger'::regtype AS trigger_result, l.lanname
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
    WHERE NOT t.tgisinternal AND t.tgrelid=ANY(${relations}::regclass[])
  `;
  if (
    triggers.length !== guards.length ||
    !guards.every((guard) => {
      const actual = triggers.find(
        (t) => t.table === guard.table && t.name === guard.name,
      );
      return (
        actual &&
        actual.tgenabled === 'O' &&
        actual.tgtype === 23 &&
        actual.unconditional &&
        actual.tgnargs === 0 &&
        actual.tgconstraint === '0' &&
        stable(actual.columns) === stable(guard.columns) &&
        actual.function_schema === 'public' &&
        actual.proname === guard.name &&
        !actual.prosecdef &&
        actual.pronargs === 0 &&
        actual.trigger_result &&
        actual.lanname === 'plpgsql' &&
        stable(actual.proconfig) ===
          stable(['search_path=pg_catalog, public, pg_temp']) &&
        createHash('sha256').update(actual.prosrc).digest('hex') === guard.body
      );
    })
  )
    throw new Error('User triggers require a tool review');
}
