import type postgres from 'postgres';
import { FEED_LIMITS } from '@/shared/feed-contract';
import { requestFeedRefresh } from '../ingest/feed-demand';
import { podcastAccess } from '../podcast-access';

export async function recoverListContent(
  sql: postgres.Sql,
  userId: string,
  listId: string,
  admit: (podcastId: string) => Promise<void>,
) {
  const candidates = await sql`
    SELECT p.id, min(e.id)::text AS episode_id
    FROM episode_lists l JOIN episode_list_items i ON i.list_id = l.id
    JOIN episodes e ON e.id = i.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    LEFT JOIN episode_content c ON c.episode_id = e.id
    LEFT JOIN feed_poll_state s ON s.podcast_id = p.id
    WHERE l.id = ${listId} AND l.user_id = ${userId}
      AND ${podcastAccess(sql, userId)} AND c.episode_id IS NULL
      AND (coalesce(s.failures, 0) = 0 OR s.next_poll_at IS NULL OR s.next_poll_at <= now())
      AND (s.last_rebuilt_at IS NULL OR s.last_rebuilt_at <= now() - interval '1 second' * ${FEED_LIMITS.refresh.rebuildCooldownSeconds})
    GROUP BY p.id ORDER BY min(s.last_rebuilt_at) ASC NULLS FIRST, p.id LIMIT 3
  `;
  for (const row of candidates) {
    await requestFeedRefresh(
      sql,
      String(row.id),
      userId,
      async () => {
        await admit(String(row.id));
      },
      row.episode_id,
    ).catch(() => {});
  }
}
