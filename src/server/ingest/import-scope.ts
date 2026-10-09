import type postgres from 'postgres';
import { readGeneration } from '../state/generation';
import { StateError } from '../state/protocol';

export async function assertImportScope(
  sql: postgres.ISql,
  accountId: string,
  expected: { generation: string; sessionId?: string },
  lock = false,
) {
  const current = await readGeneration(sql, accountId, lock);
  if (current.scope.generation !== expected.generation)
    throw new StateError('recovery_required', 'State reconciliation required');
  if (expected.sessionId !== undefined) {
    const [session] = await sql`
      SELECT id FROM sessions WHERE id = ${expected.sessionId} AND user_id = ${accountId}
        AND expires_at > clock_timestamp() ${lock ? sql`FOR SHARE` : sql``}
    `;
    if (!session)
      throw new StateError('unauthenticated', 'Authentication required');
  }
  return current.scope;
}
