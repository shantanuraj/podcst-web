import type postgres from 'postgres';
import { loadMigrations } from '../migrations';

export async function createSchemaFixture(sql: postgres.ISql) {
  for (const migration of loadMigrations()) await sql.unsafe(migration.source);
}
