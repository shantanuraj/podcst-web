import { sql } from '../src/server/db';
import { deletionService } from '../src/server/deletion/runtime';

try {
  const remaining = await deletionService().reconcilePending();
  console.log(JSON.stringify(remaining));
  if (remaining.pending) process.exitCode = 1;
} finally {
  await sql.end();
}
