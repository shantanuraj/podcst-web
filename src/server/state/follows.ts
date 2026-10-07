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
  readStateScope,
  saveStateAcknowledgement,
} from './database';
import { StateError } from './protocol';

export function createFollowStateService(
  sql: postgres.Sql,
  registerClient?: (accountId: string) => Promise<void>,
) {
  return {
    async change(
      accountId: string,
      batch: FollowBatch,
    ): Promise<FollowAcknowledgement> {
      return sql.begin(async (tx) => {
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
        for (const id of ids)
          await tx`SELECT pg_advisory_xact_lock(${id}::bigint)`;
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
            status:
              Boolean(previous) === change.followed ? 'unchanged' : 'applied',
          });
        }
        const { changes: _, ...stream } = batch;
        const result: FollowAcknowledgement = { ...stream, revision, results };
        await saveStateAcknowledgement(tx, 'follows', state.hash, result);
        return result;
      });
    },

    async read(accountId: string): Promise<FollowSnapshot> {
      return sql.begin(
        'isolation level repeatable read read only',
        async (tx) => {
          const scope = await readStateScope(tx, accountId, 'follows');
          const rows = await tx<FollowSnapshot['items']>`
          SELECT s.podcast_id::text AS "podcastId", s.revision::text,
            (extract(epoch FROM s.subscribed_at) * 1000)::bigint AS "followedAtMs",
            CASE WHEN ${podcastAccess(tx, accountId)} THEN 'available' ELSE 'unavailable' END AS availability
          FROM subscriptions s JOIN podcasts p ON p.id = s.podcast_id
          WHERE s.user_id = ${accountId} ORDER BY s.subscribed_at DESC NULLS LAST, s.podcast_id DESC
        `;
          const result = {
            ...scope,
            items: rows.map((row) => ({
              ...row,
              followedAtMs:
                row.followedAtMs === null ? null : Number(row.followedAtMs),
            })),
          };
          if (!stateValidator('followSnapshot')(result))
            throw new StateError('unavailable', 'State unavailable');
          return result;
        },
      );
    },
  };
}
