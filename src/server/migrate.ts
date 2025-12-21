import { readFileSync } from 'fs';
import { join } from 'path';
import { sql } from './db';

async function migrate() {
  const schemaPath = join(process.cwd(), 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  console.log('Running migration...');

  await sql.unsafe(schema);

  console.log('Migration complete.');

  await sql.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
