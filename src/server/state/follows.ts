import type postgres from 'postgres';
import { compareCanonicalIds } from '@/shared/canonical-id';
import type {
  FollowAcknowledgement,
  FollowBatch,
  FollowSnapshot,
} from '@/shared/state-contract';
import { stateValidator } from '@/shared/state-contract';
import { podcastAccess } from '../podcast-access';
import {
  lockStateChange,
  nextStateRevision,
  saveStateAcknowledgement,
} from './database';
import { StateError } from './protocol';

type SnapshotRow = {
  accountId: string;
  generation: string | null;
  revision: string;
  podcastId: string | null;
  itemRevision: string | null;
  followedAtMs: string | number | null;
  availability: 'available' | 'unavailable' | null;
};

async function readSnapshot(
  sql: postgres.ISql,
  identity: { accountId: string } | { sessionId: string },
): Promise<FollowSnapshot> {
  const account =
    'sessionId' in identity
      ? sql`(
          SELECT user_id FROM sessions
          WHERE id = ${identity.sessionId} AND expires_at > now()
        )`
      : identity.accountId;
  // Authentication, scope and memberships share one statement snapshot without
  // a separate session lookup or transaction round trips.
  const rows = await sql<SnapshotRow[]>`
    SELECT u.id AS "accountId", g.generation,
      coalesce(h.revision, 0)::text AS revision,
      membership.podcast_id::text AS "podcastId",
      membership.revision::text AS "itemRevision",
      (extract(epoch FROM membership.subscribed_at) * 1000)::bigint AS "followedAtMs",
      membership.availability
    FROM users u
    LEFT JOIN state_generation g ON g.singleton
    LEFT JOIN follow_revision_heads h ON h.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT s.podcast_id, s.revision, s.subscribed_at,
        CASE WHEN p.owner_user_id IS NULL OR p.owner_user_id = u.id
          THEN 'available' ELSE 'unavailable' END AS availability
      FROM subscriptions s JOIN podcasts p ON p.id = s.podcast_id
      WHERE s.user_id = u.id
    ) membership ON true
    WHERE u.id = ${account}
    ORDER BY membership.subscribed_at DESC NULLS LAST, membership.podcast_id DESC
  `;
  const scope = rows[0];
  if (!scope)
    throw new StateError(
      'unauthenticated',
      'sessionId' in identity ? 'Unauthorized' : 'Authentication required',
    );
  if (!scope.generation)
    throw new StateError('unavailable', 'State unavailable');
  const result = {
    protocol: 1,
    accountId: scope.accountId,
    generation: String(scope.generation),
    revision: scope.revision,
    items: rows.flatMap((row) =>
      row.podcastId === null
        ? []
        : [
            {
              podcastId: row.podcastId,
              revision: row.itemRevision,
              followedAtMs:
                row.followedAtMs === null ? null : Number(row.followedAtMs),
              availability: row.availability,
            },
          ],
    ),
  };
  if (!stateValidator('followSnapshot')(result))
    throw new StateError('unavailable', 'State unavailable');
  return result;
}

export async function changeFollowState(
  tx: postgres.TransactionSql,
  accountId: string,
  batch: FollowBatch,
  registerClient?: (accountId: string) => Promise<void>,
): Promise<FollowAcknowledgement> {
  const state = await lockStateChange(
    tx,
    accountId,
    'follows',
    batch,
    registerClient,
  );
  if (state.replay) return state.replay as FollowAcknowledgement;
  const ids = [
    ...new Set(batch.changes.map(({ podcastId }) => podcastId)),
  ].sort(compareCanonicalIds);
  for (const id of ids) await tx`SELECT pg_advisory_xact_lock(${id}::bigint)`;
  const visible = await tx<{ id: string }[]>`
    SELECT p.id::text FROM podcasts p
    WHERE p.id = ANY(${ids}::bigint[]) AND ${podcastAccess(tx, accountId)}
    ORDER BY p.id FOR SHARE
  `;
  const available = new Set(visible.map(({ id }) => id));
  const results: FollowAcknowledgement['results'] = [];
  let revision = state.revision;
  for (const change of batch.changes) {
    if (change.followed && !available.has(change.podcastId)) {
      results.push({ podcastId: change.podcastId, status: 'not_found' });
      continue;
    }
    const [previous] = await tx`
      SELECT podcast_id FROM subscriptions
      WHERE user_id = ${accountId} AND podcast_id = ${change.podcastId}
    `;
    revision = nextStateRevision(revision);
    if (change.followed) {
      await tx`
        INSERT INTO subscriptions (user_id, podcast_id, revision, subscribed_at)
        VALUES (${accountId}, ${change.podcastId}, ${revision}::bigint, clock_timestamp())
        ON CONFLICT (user_id, podcast_id) DO UPDATE SET revision = EXCLUDED.revision
      `;
    } else {
      await tx`DELETE FROM subscriptions WHERE user_id = ${accountId} AND podcast_id = ${change.podcastId}`;
    }
    results.push({
      podcastId: change.podcastId,
      status: Boolean(previous) === change.followed ? 'unchanged' : 'applied',
    });
  }
  const { changes: _, ...stream } = batch;
  const result: FollowAcknowledgement = { ...stream, revision, results };
  await saveStateAcknowledgement(tx, 'follows', state.hash, result);
  return result;
}

export function createFollowStateService(
  sql: postgres.Sql,
  registerClient?: (accountId: string) => Promise<void>,
) {
  return {
    async change(
      accountId: string,
      batch: FollowBatch,
    ): Promise<FollowAcknowledgement> {
      return sql.begin((tx) =>
        changeFollowState(tx, accountId, batch, registerClient),
      );
    },

    read(accountId: string): Promise<FollowSnapshot> {
      return readSnapshot(sql, { accountId });
    },

    readForSession(sessionId: string): Promise<FollowSnapshot> {
      return readSnapshot(sql, { sessionId });
    },
  };
}
