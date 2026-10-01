#!/usr/bin/env bun

import { DatabaseTargetError, openDatabase } from './lib/database';
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
  const migrations = loadMigrations();
  const sql = openDatabase('MIGRATION_DATABASE_URL');
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
      error instanceof MigrationError || error instanceof DatabaseTargetError
        ? error.message
        : 'Database operation failed; inspect protected diagnostics and migration status before retrying',
    );
    process.exitCode = 1;
  });
}
