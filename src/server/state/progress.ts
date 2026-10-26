import type postgres from 'postgres';
import {
  type ProgressAcknowledgement,
  type ProgressBatch,
  type ProgressSnapshot,
  STATE_READ_LIMIT,
  stateValidator,
} from '@/shared/state-contract';
import { podcastAccess } from '../podcast-access';
import {
  lockStateChange,
  nextStateRevision,
  saveStateAcknowledgement,
} from './database';
import { StateError } from './protocol';

type ProgressRow = NonNullable<
  ProgressSnapshot['items'][number]['progress']
> & {
  episodeId: string;
};

type SnapshotRow = Omit<ProgressRow, 'episodeId' | 'revision'> & {
  generation: string | null;
  revision: string;
  episodeId: string | null;
  itemRevision: string;
};

async function readSnapshot(
  tx: postgres.ISql,
  accountId: string,
  selection: { ids: string[] } | { recent: number },
): Promise<ProgressSnapshot> {
  // One statement gives scope, revision and items the same MVCC snapshot,
  // without BEGIN/COMMIT and a separate scope query over the network.
  const rows = await tx<SnapshotRow[]>`
    SELECT g.generation, coalesce(h.revision, 0)::text AS revision,
      progress.episode_id::text AS "episodeId", progress.position AS "positionSeconds",
      progress.completed, progress.revision::text AS "itemRevision",
      (extract(epoch FROM progress.updated_at) * 1000)::bigint AS "updatedAtMs"
    FROM users u
    LEFT JOIN state_generation g ON g.singleton
    LEFT JOIN progress_revision_heads h ON h.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT pp.episode_id, pp.position, pp.completed, pp.revision, pp.updated_at
      FROM playback_progress pp
      JOIN episodes e ON e.id = pp.episode_id
      JOIN podcasts p ON p.id = e.podcast_id
      WHERE pp.user_id = u.id AND ${podcastAccess(tx, accountId)}
        ${
          'ids' in selection
            ? tx`AND pp.episode_id = ANY(${selection.ids}::bigint[])`
            : tx`AND NOT pp.completed AND EXISTS (SELECT 1 FROM episode_content c WHERE c.episode_id = e.id)`
        }
      ORDER BY pp.revision DESC
      ${'recent' in selection ? tx`LIMIT ${selection.recent}` : tx``}
    ) progress ON true
    WHERE u.id = ${accountId}
    ORDER BY progress.revision DESC
  `;
  const scope = rows[0];
  if (!scope)
    throw new StateError('unauthenticated', 'Authentication required');
  if (!scope.generation)
    throw new StateError('unavailable', 'State unavailable');
  return {
    protocol: 1,
    accountId,
    generation: String(scope.generation),
    revision: scope.revision,
    items: rows.flatMap((row) =>
      row.episodeId === null
        ? []
        : [
            {
              episodeId: row.episodeId,
              progress: {
                positionSeconds: row.positionSeconds,
                completed: row.completed,
                revision: row.itemRevision,
                updatedAtMs:
                  row.updatedAtMs === null ? null : Number(row.updatedAtMs),
              },
            },
          ],
    ),
  };
}

export async function changeProgressState(
  tx: postgres.TransactionSql,
  accountId: string,
  batch: ProgressBatch,
  registerClient?: (accountId: string) => Promise<void>,
): Promise<ProgressAcknowledgement> {
  const state = await lockStateChange(
    tx,
    accountId,
    'progress',
    batch,
    registerClient,
  );
  if (state.replay) return state.replay as ProgressAcknowledgement;
  const ids = [...new Set(batch.changes.map(({ episodeId }) => episodeId))];
  const visible = await tx<{ id: string }[]>`
    SELECT e.id::text FROM episodes e JOIN podcasts p ON p.id = e.podcast_id
    WHERE e.id = ANY(${ids}::bigint[]) AND ${podcastAccess(tx, accountId)}
    ORDER BY e.id FOR SHARE OF e, p
  `;
  const available = new Set(visible.map(({ id }) => id));
  const results: ProgressAcknowledgement['results'] = [];
  let revision = state.revision;
  for (const change of batch.changes) {
    if (!available.has(change.episodeId)) {
      results.push({ episodeId: change.episodeId, status: 'not_found' });
      continue;
    }
    const [previous] = await tx`
      SELECT position, completed FROM playback_progress
      WHERE user_id = ${accountId} AND episode_id = ${change.episodeId}
    `;
    const completed = change.completed ?? previous?.completed ?? false;
    revision = nextStateRevision(revision);
    await tx`
      INSERT INTO playback_progress (user_id, episode_id, position, completed, revision, updated_at)
      VALUES (${accountId}, ${change.episodeId}, ${change.positionSeconds}, ${completed}, ${revision}::bigint, clock_timestamp())
      ON CONFLICT (user_id, episode_id) DO UPDATE SET
        position = EXCLUDED.position, completed = EXCLUDED.completed,
        revision = EXCLUDED.revision, updated_at = EXCLUDED.updated_at
    `;
    results.push({
      episodeId: change.episodeId,
      status:
        previous?.position === change.positionSeconds &&
        previous.completed === completed
          ? 'unchanged'
          : 'applied',
    });
  }
  const { changes: _, ...stream } = batch;
  const result: ProgressAcknowledgement = {
    ...stream,
    revision,
    results,
  };
  await saveStateAcknowledgement(tx, 'progress', state.hash, result);
  return result;
}

export function createProgressStateService(
  sql: postgres.Sql,
  registerClient?: (accountId: string) => Promise<void>,
) {
  return {
    async change(
      accountId: string,
      batch: ProgressBatch,
    ): Promise<ProgressAcknowledgement> {
      return sql.begin((tx) =>
        changeProgressState(tx, accountId, batch, registerClient),
      );
    },

    async read(accountId: string, ids: string[]): Promise<ProgressSnapshot> {
      if (
        ids.length < 1 ||
        ids.length > STATE_READ_LIMIT ||
        new Set(ids).size !== ids.length ||
        !ids.every((id) => stateValidator('id')(id))
      )
        throw new StateError('invalid_request', 'Invalid progress selection');
      const snapshot = await readSnapshot(sql, accountId, { ids });
      const rows = new Map(
        snapshot.items.map(({ episodeId, progress }) => [episodeId, progress]),
      );
      const result = {
        ...snapshot,
        items: ids.map((episodeId) => ({
          episodeId,
          progress: rows.get(episodeId) ?? null,
        })),
      };
      if (!stateValidator('progressSnapshot')(result))
        throw new StateError('unavailable', 'State unavailable');
      return result;
    },

    async recent(accountId: string, limit: number): Promise<ProgressSnapshot> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 10)
        throw new StateError(
          'invalid_request',
          'Invalid recent progress limit',
        );
      const result = await readSnapshot(sql, accountId, { recent: limit });
      if (!stateValidator('progressSnapshot')(result))
        throw new StateError('unavailable', 'State unavailable');
      return result;
    },
  };
}
