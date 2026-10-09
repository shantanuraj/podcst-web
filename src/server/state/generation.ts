import type postgres from 'postgres';
import type { StateScope } from '@/shared/state-contract';
import { readActiveAccount } from '../auth/account-guard';
import { StateError } from './protocol';

export async function readGeneration(
  sql: postgres.ISql,
  accountId: string,
  lock = false,
): Promise<{ scope: StateScope; legacyGeneration: string }> {
  const [generation] = await sql`
    SELECT generation, legacy_generation FROM state_generation
    WHERE singleton ${lock ? sql`FOR SHARE` : sql``}
  `;
  if (!generation) throw new StateError('unavailable', 'State unavailable');
  const user = await readActiveAccount(sql, accountId, lock ? 'share' : false);
  if (!user) throw new StateError('unauthenticated', 'Authentication required');
  return {
    scope: {
      protocol: 1,
      accountId,
      generation: String(generation.generation),
    },
    legacyGeneration: String(generation.legacy_generation),
  };
}
