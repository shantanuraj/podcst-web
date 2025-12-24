#!/usr/bin/env bun

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

async function migrate(filename?: string) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const sql = postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
  });

  if (filename) {
    await runMigration(sql, filename);
  } else {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      await runMigration(sql, file);
    }
  }

  await sql.end();
  console.log('Done.');
}

async function runMigration(sql: postgres.Sql, filename: string) {
  const filepath = join(MIGRATIONS_DIR, filename);
  const content = readFileSync(filepath, 'utf-8');

  console.log(`Running ${filename}...`);
  await sql.unsafe(content);
  console.log(`✓ ${filename}`);
}

const filename = process.argv[2];
migrate(filename).catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
