import type postgres from 'postgres';
import { loadMigrations } from '../migrations';

export async function createSchemaFixture(
  sql: postgres.ISql,
  through?: string,
) {
  const migrations = loadMigrations();
  if (through && !migrations.some(({ name }) => name === through))
    throw new Error('Unknown fixture migration boundary');
  for (const migration of migrations) {
    await sql.unsafe(migration.source);
    if (migration.name === through) break;
  }
}
