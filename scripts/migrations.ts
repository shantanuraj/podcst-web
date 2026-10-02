import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type postgres from 'postgres';

export const migrationDirectory = new URL(
  '../migrations/active/',
  import.meta.url,
);
const baselineName = '0000-baseline.sql';
const lockKey = 1347372099;

export class MigrationError extends Error {}

export interface Migration {
  name: string;
  checksum: string;
  source: string;
}

interface AppliedMigration {
  name: string;
  checksum: string;
}

export interface MigrationStatus {
  state: 'empty' | 'untracked' | 'tracked';
  migrations: (AppliedMigration & { state: 'applied' | 'pending' })[];
}

function executableSQL(source: string): string {
  let result = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('--', index)) {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end + 1;
      result += ' ';
    } else if (source.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith('/*', index)) {
          depth++;
          index += 2;
        } else if (source.startsWith('*/', index)) {
          depth--;
          index += 2;
        } else index++;
      }
      if (depth) throw new MigrationError('Unterminated SQL comment');
      result += ' ';
    } else if (source[index] === "'" || source[index] === '"') {
      const quote = source[index];
      const escaped =
        quote === "'" && /(?:^|\W)[eE]$/.test(source.slice(0, index));
      let closed = false;
      index++;
      while (index < source.length) {
        if (escaped && source[index] === '\\') index += 2;
        else if (source[index] === quote) {
          index++;
          if (source[index] === quote) index++;
          else {
            closed = true;
            break;
          }
        } else index++;
      }
      if (!closed) throw new MigrationError('Unterminated SQL quotation');
      result += ' ';
    } else {
      const tag = /^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/.exec(
        source.slice(index),
      )?.[0];
      if (tag) {
        const end = source.indexOf(tag, index + tag.length);
        if (end < 0)
          throw new MigrationError('Unterminated SQL dollar quotation');
        index = end + tag.length;
        result += ' ';
      } else result += source[index++];
    }
  }
  return result;
}

export function loadMigrations(
  directory: string | URL = migrationDirectory,
): Migration[] {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (names[0] !== baselineName) {
    throw new MigrationError(
      `The active chain must start with ${baselineName}`,
    );
  }
  const versions = new Set<string>();
  return names.map((name) => {
    const match = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.sql$/.exec(name);
    if (!match || versions.has(match[1])) {
      throw new MigrationError(
        `Invalid or duplicate migration version: ${name}`,
      );
    }
    versions.add(match[1]);
    const source = readFileSync(
      typeof directory === 'string'
        ? join(directory, name)
        : new URL(name, directory),
      'utf8',
    );
    const statements = executableSQL(source)
      .split(';')
      .map((statement) => statement.trim());
    if (!statements.some(Boolean))
      throw new MigrationError(`Empty migration: ${name}`);
    const transactionCommand =
      /^(?:begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction|set\s+(?:(?:local|session)\s+)?transaction|set\s+session\s+characteristics)\b/i;
    if (statements.some((statement) => transactionCommand.test(statement))) {
      throw new MigrationError(
        `Migration must not control its transaction: ${name}`,
      );
    }
    return {
      name,
      source,
      checksum: createHash('sha256').update(source).digest('hex'),
    };
  });
}

async function inspect(
  sql: postgres.ISql,
  migrations: Migration[],
): Promise<MigrationStatus> {
  const [catalog] = await sql`
    SELECT to_regnamespace('podcst_migrations') IS NOT NULL AS has_ledger,
      EXISTS (
        SELECT 1 FROM pg_namespace n
        WHERE n.nspname !~ '^pg_'
          AND n.nspname NOT IN ('information_schema', 'podcst_migrations')
          AND (
            EXISTS (
              SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid
                AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
            ) OR EXISTS (
              SELECT 1 FROM pg_proc p WHERE p.pronamespace = n.oid
            ) OR EXISTS (
              SELECT 1 FROM pg_type t WHERE t.typnamespace = n.oid
                AND t.typtype IN ('d', 'e')
            )
          )
      ) AS has_objects
  `;
  const applied = catalog.has_ledger
    ? await sql<
        AppliedMigration[]
      >`SELECT name, checksum FROM podcst_migrations.history ORDER BY name`
    : [];
  if (catalog.has_ledger && applied.length === 0) {
    throw new MigrationError('Empty migration ledger requires operator review');
  }
  for (const [index, row] of applied.entries()) {
    const expected = migrations[index];
    if (!expected || row.name !== expected.name) {
      throw new MigrationError(
        'Applied migrations are not a prefix of the active chain',
      );
    }
    if (row.checksum !== expected.checksum) {
      throw new MigrationError(
        `Applied migration checksum changed: ${row.name}`,
      );
    }
  }
  return {
    state: catalog.has_ledger
      ? 'tracked'
      : catalog.has_objects
        ? 'untracked'
        : 'empty',
    migrations: migrations.map(({ name, checksum }, index) => ({
      name,
      checksum,
      state: index < applied.length ? 'applied' : 'pending',
    })),
  };
}

export async function migrationStatus(
  sql: postgres.Sql,
  migrations = loadMigrations(),
) {
  return sql.begin('isolation level repeatable read read only', (tx) =>
    inspect(tx, migrations),
  );
}

export async function lockMigrations(sql: postgres.ISql) {
  const [lock] =
    await sql`SELECT pg_catalog.pg_try_advisory_xact_lock(${lockKey}, 0) AS acquired`;
  if (!lock.acquired)
    throw new MigrationError('Another migration runner holds the lock');
}

export async function createMigrationLedger(sql: postgres.ISql) {
  await sql`CREATE SCHEMA podcst_migrations`;
  await sql`
    CREATE TABLE podcst_migrations.history (
      name text PRIMARY KEY,
      checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      method text NOT NULL DEFAULT 'applied' CHECK (method IN ('applied', 'adopted')),
      review_digest text,
      CHECK (
        (method = 'applied' AND review_digest IS NULL) OR
        (method = 'adopted' AND review_digest IS NOT NULL AND review_digest ~ '^[a-f0-9]{64}$')
      )
    )
  `;
}

export async function migrate(
  sql: postgres.Sql,
  migrations = loadMigrations(),
): Promise<string[]> {
  return sql.begin(async (tx) => {
    await lockMigrations(tx);
    await tx`SET LOCAL search_path TO public`;
    await tx`SET LOCAL standard_conforming_strings TO on`;
    await tx`SET LOCAL lock_timeout TO '5s'`;
    await tx`SET LOCAL statement_timeout TO '10min'`;
    const status = await inspect(tx, migrations);
    if (status.state === 'untracked') {
      throw new MigrationError(
        'Existing database has no reviewed migration baseline; no changes applied',
      );
    }
    const pending = migrations.slice(
      status.migrations.filter((row) => row.state === 'applied').length,
    );
    if (status.state === 'empty') await createMigrationLedger(tx);
    for (const migration of pending) {
      await tx.unsafe(migration.source);
      await tx`
        INSERT INTO podcst_migrations.history (name, checksum)
        VALUES (${migration.name}, ${migration.checksum})
      `;
    }
    return pending.map(({ name }) => name);
  });
}
