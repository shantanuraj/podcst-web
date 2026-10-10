import { sql } from '../src/server/db';
import { requireRuntimeAdmission } from '../src/server/erasure/admission';
import { erasureService } from '../src/server/erasure/runtime';

if (import.meta.main) {
  let started = false;
  try {
    if (process.argv.slice(2).join(' ') !== '--once') throw new Error();
    await requireRuntimeAdmission();
    const service = erasureService();
    started = true;
    const outcomes = await service.reconcilePending();
    const completed = outcomes.filter(
      ({ status }) => status === 'completed',
    ).length;
    console.log(
      JSON.stringify({
        attempted: outcomes.length,
        completed,
        pending: outcomes.length - completed,
      }),
    );
    if (completed !== outcomes.length) process.exitCode = 1;
  } catch {
    console.error('Account reconciliation unavailable');
    process.exitCode = 1;
  } finally {
    if (started) await sql.end({ timeout: 5 });
  }
}
