import type postgres from 'postgres';
import { MigrationError } from './migration-error';

export interface ConcurrentIndex {
  name: string;
  schema: string;
  table: string;
  columns: string;
  source: string;
}

// Deliberately not a general SQL parser or a nontransactional escape hatch.
export function parseConcurrentIndex(
  source: string,
): ConcurrentIndex | undefined {
  if (!source.startsWith('-- podcst-migration:')) return;
  const header = '-- podcst-migration: concurrent-index\n';
  const identifier = '[a-z_][a-z_0-9]{0,62}';
  const column = `${identifier}(?:\\s+(?:ASC|DESC))?`;
  const statement = source.slice(header.length).trim();
  const match = new RegExp(
    `^CREATE\\s+INDEX\\s+CONCURRENTLY\\s+(${identifier})\\s+ON\\s+(${identifier})\\.(${identifier})\\s*\\((${column}(?:\\s*,\\s*${column})*)\\)\\s*;$`,
    'i',
  ).exec(statement);
  if (!source.startsWith(header) || !match) {
    throw new MigrationError(
      'Online migration must contain one simple CREATE INDEX CONCURRENTLY',
    );
  }
  const [, name, schema, table, keys] = match;
  return {
    name: name.toLowerCase(),
    schema: schema.toLowerCase(),
    table: table.toLowerCase(),
    columns: keys
      .split(',')
      .map((key) => {
        const [name, direction] = key.trim().split(/\s+/);
        return `${name.toLowerCase()}${direction?.toUpperCase() === 'DESC' ? ' DESC' : ''}`;
      })
      .join(', '),
    source: statement,
  };
}

export async function inspectConcurrentIndex(
  sql: postgres.ISql,
  index: ConcurrentIndex,
) {
  const [target] = await sql`
    SELECT c.relkind = 'r' AND c.relpersistence = 'p' AS supported
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${index.schema} AND c.relname = ${index.table}
  `;
  if (!target?.supported)
    throw new MigrationError(
      'Online index requires a permanent ordinary table',
    );
  const [existing] = await sql`
    SELECT c.relkind = 'i' AND c.relpersistence = 'p'
      AND c.reloptions IS NULL AND c.reltablespace = 0
      AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
      AND NOT i.indnullsnotdistinct AND i.indimmediate
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts = i.indnkeyatts
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint con WHERE con.conindid = c.oid)
      AND pg_catalog.pg_get_indexdef(c.oid) = pg_catalog.format(
        'CREATE INDEX %I ON %I.%I USING btree (%s)',
        ${index.name}::text, ${index.schema}::text, ${index.table}::text, ${index.columns}::text
      ) AS matches
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname = ${index.schema} AND c.relname = ${index.name}
  `;
  if (existing && !existing.matches) {
    throw new MigrationError(
      `Index ${index.schema}.${index.name} requires operator recovery: existing relation is invalid or does not exactly match`,
    );
  }
  return Boolean(existing);
}
