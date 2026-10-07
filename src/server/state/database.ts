import type postgres from 'postgres';
import type {
  FollowAcknowledgement,
  FollowBatch,
  ProgressAcknowledgement,
  ProgressBatch,
  StateScope,
} from '@/shared/state-contract';
import { stateValidator } from '@/shared/state-contract';
import {
  assertStateScope,
  StateError,
  stateReplay,
  stateRequestHash,
} from './protocol';

type Resource = 'progress' | 'follows';
const tables = {
  progress: { head: 'progress_revision_heads', clients: 'progress_clients' },
  follows: { head: 'follow_revision_heads', clients: 'follow_clients' },
} as const;

export async function readStateScope(
  tx: postgres.ISql,
  accountId: string,
  resource: Resource,
): Promise<StateScope & { revision: string }> {
  const [row] = await tx`
    SELECT g.generation, coalesce(h.revision, 0)::text AS revision
    FROM users u LEFT JOIN state_generation g ON g.singleton
    LEFT JOIN ${tx(tables[resource].head)} h ON h.user_id = u.id
    WHERE u.id = ${accountId}
  `;
  if (!row) throw new StateError('unauthenticated', 'Authentication required');
  if (!row.generation) throw new StateError('unavailable', 'State unavailable');
  return {
    protocol: 1,
    accountId,
    generation: String(row.generation),
    revision: row.revision,
  };
}

export async function lockStateChange(
  tx: postgres.ISql,
  accountId: string,
  resource: Resource,
  batch: ProgressBatch | FollowBatch,
  registerClient?: (accountId: string) => Promise<void>,
) {
  if (
    !stateValidator(resource === 'progress' ? 'progressBatch' : 'followBatch')(
      batch,
    )
  )
    throw new StateError('invalid_request', 'Invalid state changes');
  await tx`SET LOCAL lock_timeout = '3s'`;
  const [generation] =
    await tx`SELECT generation FROM state_generation WHERE singleton FOR SHARE`;
  if (!generation) throw new StateError('unavailable', 'State unavailable');
  assertStateScope(accountId, String(generation.generation), batch);
  const [user] =
    await tx`SELECT id FROM users WHERE id = ${accountId} FOR KEY SHARE`;
  if (!user) throw new StateError('unauthenticated', 'Authentication required');
  const table = tables[resource];
  const registered = await tx`
    INSERT INTO ${tx(table.clients)} (user_id, client_id)
    VALUES (${accountId}, ${batch.clientId}) ON CONFLICT DO NOTHING
    RETURNING client_id
  `;
  if (registered.length) await registerClient?.(accountId);
  const [client] = await tx`
    SELECT last_sequence::text, last_request_hash, last_result
    FROM ${tx(table.clients)}
    WHERE user_id = ${accountId} AND client_id = ${batch.clientId} FOR UPDATE
  `;
  const hash = stateRequestHash(resource, batch);
  if (
    stateReplay(batch.sequence, hash, {
      sequence: client.last_sequence,
      hash: client.last_request_hash,
    })
  ) {
    const replay = client.last_result as
      | ProgressAcknowledgement
      | FollowAcknowledgement;
    if (
      !stateValidator(
        resource === 'progress'
          ? 'progressAcknowledgement'
          : 'followAcknowledgement',
      )(replay)
    )
      throw new StateError('unavailable', 'State unavailable');
    return { hash, revision: replay.revision, replay };
  }
  await tx`
    INSERT INTO ${tx(table.head)} (user_id) VALUES (${accountId})
    ON CONFLICT DO NOTHING
  `;
  const [head] = await tx`
    SELECT revision::text FROM ${tx(table.head)} WHERE user_id = ${accountId} FOR UPDATE
  `;
  return { hash, revision: String(head.revision), replay: null };
}

export function nextStateRevision(revision: string) {
  const next = String(BigInt(revision) + 1n);
  if (!stateValidator('id')(next))
    throw new StateError('recovery_required', 'State revision exhausted');
  return next;
}

export async function saveStateAcknowledgement(
  tx: postgres.ISql,
  resource: Resource,
  hash: string,
  result: ProgressAcknowledgement | FollowAcknowledgement,
) {
  await tx`
    UPDATE ${tx(tables[resource].head)} SET revision = ${result.revision}::bigint
    WHERE user_id = ${result.accountId}
  `;
  await tx`
    UPDATE ${tx(tables[resource].clients)} SET last_sequence = ${result.sequence}::bigint,
      last_request_hash = ${hash}, last_result = ${tx.json(result as unknown as postgres.JSONValue)}
    WHERE user_id = ${result.accountId} AND client_id = ${result.clientId}
  `;
}

export const compareStateIds = (a: string, b: string) =>
  BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
