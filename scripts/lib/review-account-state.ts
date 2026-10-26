import type postgres from 'postgres';
import { digest } from './artifacts';

export class ReviewAccountError extends Error {}

interface Dependency {
  child: string;
  parent: string;
  columns: string[];
  references: string[];
}

export async function accountInventory(
  tx: postgres.TransactionSql,
  userId: string | null,
  email: string,
  lock = false,
) {
  const dependencies = await tx<Dependency[]>`
    SELECT child.relname AS child, parent.relname AS parent,
      ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY n(id, position)
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = n.id ORDER BY n.position) AS columns,
      ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY n(id, position)
        JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = n.id ORDER BY n.position) AS references
    FROM pg_constraint k
    JOIN pg_class child ON child.oid = k.conrelid
    JOIN pg_class parent ON parent.oid = k.confrelid
    WHERE k.contype = 'f' AND child.relnamespace = 'public'::regnamespace
      AND parent.relnamespace = 'public'::regnamespace
    ORDER BY child.relname, k.conname
  `;
  const tables = new Set(['users']);
  for (let size = 0; size !== tables.size; ) {
    size = tables.size;
    for (const edge of dependencies)
      if (tables.has(edge.parent)) tables.add(edge.child);
  }
  const predicates = new Map<string, postgres.PendingQuery<postgres.Row[]>>();
  predicates.set('users', tx`id = ${userId}`);
  const visiting = new Set<string>();
  const predicate = (table: string): postgres.PendingQuery<postgres.Row[]> => {
    const cached = predicates.get(table);
    if (cached) return cached;
    if (visiting.has(table))
      throw new ReviewAccountError(
        'Cyclic account dependencies require review',
      );
    visiting.add(table);
    const parts = dependencies
      .filter(({ child, parent }) => child === table && tables.has(parent))
      .map(
        (edge) =>
          tx`(${tx(edge.columns)}) IN (SELECT ${tx(edge.references)} FROM ${tx(edge.parent)} WHERE ${predicate(edge.parent)})`,
      );
    const condition = parts.reduce(
      (left, right) => tx`(${left}) OR (${right})`,
    );
    visiting.delete(table);
    predicates.set(table, condition);
    return condition;
  };
  for (const table of tables) predicate(table);
  predicates.set('email_verifications', tx`lower(email) = ${email}`);
  const inventory: Record<string, { rows: number; digest: string }> = {};
  for (const [table, condition] of predicates) {
    if (lock)
      await tx`SELECT 1 FROM ${tx(table)} WHERE ${condition} FOR UPDATE`;
    for (const edge of dependencies.filter(
      ({ child, parent }) => child === table && parent === 'users',
    )) {
      const [foreign] = await tx`
        SELECT 1 FROM ${tx(table)} WHERE (${condition}) AND ${tx(edge.columns[0])} <> ${userId} LIMIT 1
      `;
      if (foreign)
        throw new ReviewAccountError(
          'Account has references owned by another user',
        );
    }
    if (table === 'episode_list_items') {
      const [foreign] = await tx`
        SELECT 1 FROM episode_list_items WHERE (${condition})
          AND list_id IN (SELECT id FROM episode_lists WHERE user_id <> ${userId}) LIMIT 1
      `;
      if (foreign)
        throw new ReviewAccountError(
          'Private episodes are referenced by another account',
        );
    }
    const [row] = await tx<{ rows: number; digest: string }[]>`
      SELECT count(*)::int AS rows,
        encode(sha256(convert_to(coalesce(string_agg(to_jsonb(item)::text, E'\n' ORDER BY to_jsonb(item)::text), ''), 'UTF8')), 'hex') AS digest
      FROM ${tx(table)} item WHERE ${condition}
    `;
    inventory[table] = row;
  }
  const [erasure] =
    await tx`SELECT 1 FROM account_erasure_intents WHERE account_id = ${userId} LIMIT 1`;
  if (erasure)
    throw new ReviewAccountError(
      'Account has erasure bookkeeping requiring reconciliation',
    );
  return {
    fingerprint: digest(inventory),
    rows: Object.fromEntries(
      Object.entries(inventory).map(([table, value]) => [table, value.rows]),
    ),
  };
}
