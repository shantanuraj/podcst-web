import { createHash, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import type {
  EpisodeList,
  ListAcknowledgement,
  ListBatch,
  ListChangeResult,
  ListEpisodeItem,
  ListEpisodePage,
  ListMembership,
  ListSnapshot,
} from '@/shared/lists';
import { podcastAccess } from '../podcast-access';
import { encodeListCursor, type ListCursor } from './input';

export class ListError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function ownedList(
  sql: postgres.ISql,
  userId: string,
  listId: string,
  lock = false,
) {
  const [list] = await sql`
    SELECT id, revision::text FROM episode_lists
    WHERE id = ${listId} AND user_id = ${userId}
    ${lock ? sql`FOR UPDATE` : sql``}
  `;
  if (!list) throw new ListError(404, 'List not found');
  return { id: String(list.id), revision: String(list.revision) };
}

async function readItems(
  sql: postgres.ISql,
  userId: string,
  listId: string,
  page?: { limit: number; cursor?: ListCursor },
) {
  const cursor = page?.cursor;
  return sql<(ListMembership & { episode?: ListEpisodeItem['episode'] })[]>`
    SELECT i.episode_id AS "episodeId",
      (extract(epoch FROM i.added_at) * 1000)::bigint AS "addedAt",
      CASE WHEN p.id IS NULL THEN 'unavailable'
        WHEN c.episode_id IS NULL THEN 'content_missing'
        ELSE 'available' END AS availability
      ${
        page
          ? sql`, CASE WHEN c.episode_id IS NOT NULL THEN jsonb_build_object(
              'id', e.id, 'podcastId', p.id, 'isPrivate', p.owner_user_id IS NOT NULL,
              'guid', e.guid, 'feed', p.feed_url, 'podcastTitle', p.title,
              'title', c.title, 'summary', c.summary, 'showNotes', coalesce(c.summary, ''),
              'published', (extract(epoch FROM e.published) * 1000)::bigint,
              'duration', c.duration, 'episodeArt', c.episode_art,
              'cover', p.cover, 'explicit', p.explicit, 'author', a.name, 'link', NULL,
              'file', jsonb_build_object('url', c.file_url,
                'length', coalesce(c.file_length, 0), 'type', coalesce(c.file_type, 'audio/mpeg'))
            ) ELSE NULL END AS episode`
          : sql``
      }
    FROM episode_list_items i
    JOIN episodes e ON e.id = i.episode_id
    LEFT JOIN podcasts p ON p.id = e.podcast_id AND ${podcastAccess(sql, userId)}
    LEFT JOIN episode_content c ON c.episode_id = e.id AND p.id IS NOT NULL
    ${page ? sql`LEFT JOIN authors a ON a.id = p.author_id` : sql``}
    WHERE i.list_id = ${listId}
      ${
        cursor
          ? sql`AND (i.added_at, i.episode_id) < (${new Date(cursor.addedAt)}, ${cursor.episodeId})`
          : sql``
      }
    ORDER BY i.added_at DESC, i.episode_id DESC
    ${page ? sql`LIMIT ${page.limit + 1}` : sql``}
  `;
}

export function createEpisodeListService(sql: postgres.Sql) {
  return {
    async lists(userId: string): Promise<{ lists: EpisodeList[] }> {
      await sql`
        INSERT INTO episode_lists (id, user_id, kind)
        VALUES (${randomUUID()}, ${userId}, 'starred')
        ON CONFLICT (user_id) WHERE kind = 'starred' DO NOTHING
      `;
      const lists = await sql<EpisodeList[]>`
        SELECT l.id, l.kind, l.name, l.revision::text,
          (SELECT count(*)::int FROM episode_list_items i WHERE i.list_id = l.id) AS "itemCount"
        FROM episode_lists l WHERE l.user_id = ${userId}
        ORDER BY l.created_at, l.id
      `;
      return { lists: Array.from(lists) };
    },

    async membership(userId: string, listId: string): Promise<ListSnapshot> {
      return sql.begin(
        'isolation level repeatable read read only',
        async (tx) => {
          const list = await ownedList(tx, userId, listId);
          const rows = await readItems(tx, userId, listId);
          return {
            listId: list.id,
            revision: list.revision,
            items: rows.map((row) => ({
              ...row,
              episodeId: Number(row.episodeId),
              addedAt: Number(row.addedAt),
            })),
          };
        },
      );
    },

    async episodes(
      userId: string,
      listId: string,
      page: { limit: number; cursor?: ListCursor },
    ): Promise<ListEpisodePage> {
      return sql.begin(
        'isolation level repeatable read read only',
        async (tx) => {
          const list = await ownedList(tx, userId, listId);
          const rows = await readItems(tx, userId, listId, page);
          const more = rows.length > page.limit;
          const items: ListEpisodeItem[] = rows
            .slice(0, page.limit)
            .map((row) => ({
              ...row,
              episodeId: Number(row.episodeId),
              addedAt: Number(row.addedAt),
              episode: row.episode ?? null,
            }));
          const last = items.at(-1);
          return {
            listId: list.id,
            revision: list.revision,
            items,
            nextCursor:
              more && last
                ? encodeListCursor({
                    listId: list.id,
                    addedAt: last.addedAt,
                    episodeId: last.episodeId,
                  })
                : null,
          };
        },
      );
    },

    async change(
      userId: string,
      listId: string,
      batch: ListBatch,
    ): Promise<ListAcknowledgement> {
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            listId,
            clientId: batch.clientId,
            sequence: batch.sequence,
            changes: batch.changes.map(({ op, episodeId }) => ({
              op,
              episodeId,
            })),
          }),
        )
        .digest('hex');
      return sql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout = '3s'`;
        await ownedList(tx, userId, listId);
        await tx`
          INSERT INTO episode_list_clients (user_id, client_id)
          VALUES (${userId}, ${batch.clientId}) ON CONFLICT DO NOTHING
        `;
        const [client] = await tx`
          SELECT last_sequence::text, last_request_hash, last_result
          FROM episode_list_clients
          WHERE user_id = ${userId} AND client_id = ${batch.clientId} FOR UPDATE
        `;
        const sequence = BigInt(batch.sequence);
        const previous = BigInt(client.last_sequence);
        if (sequence === previous && client.last_request_hash === hash)
          return client.last_result as ListAcknowledgement;
        if (sequence !== previous + 1n)
          throw new ListError(409, 'Invalid list synchronization sequence');

        const ids = [
          ...new Set(batch.changes.map(({ episodeId }) => episodeId)),
        ];
        const references = () => tx`
          SELECT id::text, podcast_id::text FROM episodes
          WHERE id = ANY(${ids}::bigint[]) ORDER BY id
        `;
        const before = await references();
        const podcastIds = [
          ...new Set(before.map((row) => Number(row.podcast_id))),
        ].sort((a, b) => a - b);
        for (const id of podcastIds)
          await tx`SELECT pg_advisory_xact_lock(${id}::bigint)`;
        if (JSON.stringify(before) !== JSON.stringify(await references()))
          throw new ListError(503, 'Episode identities changed; retry');
        const list = await ownedList(tx, userId, listId, true);
        const results: ListChangeResult[] = [];
        for (const change of batch.changes) {
          if (change.op === 'remove') {
            const removed = await tx`
              DELETE FROM episode_list_items
              WHERE list_id = ${listId} AND episode_id = ${change.episodeId}
              RETURNING episode_id
            `;
            results.push({
              episodeId: change.episodeId,
              status: removed.length ? 'applied' : 'unchanged',
            });
          } else {
            const [episode] = await tx`
              SELECT e.id FROM episodes e JOIN podcasts p ON p.id = e.podcast_id
              WHERE e.id = ${change.episodeId} AND ${podcastAccess(tx, userId)}
            `;
            const added = episode
              ? await tx`
                  INSERT INTO episode_list_items (list_id, episode_id)
                  VALUES (${listId}, ${change.episodeId})
                  ON CONFLICT DO NOTHING RETURNING episode_id
                `
              : [];
            results.push({
              episodeId: change.episodeId,
              status: !episode
                ? 'not_found'
                : added.length
                  ? 'applied'
                  : 'unchanged',
            });
          }
        }
        if (results.some(({ status }) => status === 'applied')) {
          const [updated] = await tx`
            UPDATE episode_lists SET revision = revision + 1, updated_at = clock_timestamp()
            WHERE id = ${listId} RETURNING revision::text
          `;
          list.revision = updated.revision;
        }
        const result: ListAcknowledgement = {
          clientId: batch.clientId,
          sequence: batch.sequence,
          listId: list.id,
          revision: list.revision,
          results,
        };
        await tx`
          UPDATE episode_list_clients SET last_sequence = ${batch.sequence}::bigint,
            last_request_hash = ${hash}, last_result = ${tx.json(result as unknown as postgres.JSONValue)}
          WHERE user_id = ${userId} AND client_id = ${batch.clientId}
        `;
        return result;
      });
    },
  };
}

export type EpisodeListService = ReturnType<typeof createEpisodeListService>;
