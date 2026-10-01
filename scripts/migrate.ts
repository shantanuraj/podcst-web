#!/usr/bin/env bun

import postgres from 'postgres';
import {
  loadMigrations,
  MigrationError,
  migrate,
  migrationStatus,
} from './migrations';

export async function main(args: string[]) {
  if (args.length > 1 || !['status', 'up'].includes(args[0] ?? 'status')) {
    throw new MigrationError('Usage: bun scripts/migrate.ts [status|up]');
  }
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString)
    throw new MigrationError(
      'MIGRATION_DATABASE_URL must explicitly select the target database',
    );
  let target: URL;
  try {
    target = new URL(connectionString);
  } catch {
    throw new MigrationError('Invalid MIGRATION_DATABASE_URL');
  }
  const host = target.searchParams.get('host');
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !(host || target.hostname) ||
    target.pathname.length < 2
  ) {
    throw new MigrationError(
      'MIGRATION_DATABASE_URL must name a PostgreSQL host and database',
    );
  }
  target.searchParams.delete('host');
  const migrations = loadMigrations();
  const sql = postgres(target.toString(), {
    ...(host ? { host } : {}),
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => {},
  });
  try {
    if (args[0] === 'up') {
      const applied = await migrate(sql, migrations);
      console.log(JSON.stringify({ applied }));
    } else {
      console.log(
        JSON.stringify(await migrationStatus(sql, migrations), null, 2),
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof MigrationError
        ? error.message
        : 'Database operation failed; inspect protected diagnostics and migration status before retrying',
    );
    process.exitCode = 1;
  });
}
