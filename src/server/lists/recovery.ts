import type postgres from 'postgres';
import { refreshFeed } from '../ingest/feed-refresh';
import { podcastAccess } from '../podcast-access';

export async function recoverListContent(
  sql: postgres.Sql,
  userId: string,
  listId: string,
  claim: (podcastId: number) => Promise<boolean>,
  refresh = refreshFeed,
) {
  const candidates = await sql`
    SELECT DISTINCT p.id, s.last_polled_at
    FROM episode_lists l JOIN episode_list_items i ON i.list_id = l.id
    JOIN episodes e ON e.id = i.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    LEFT JOIN episode_content c ON c.episode_id = e.id
    LEFT JOIN feed_poll_state s ON s.podcast_id = p.id
    WHERE l.id = ${listId} AND l.user_id = ${userId}
      AND ${podcastAccess(sql, userId)} AND c.episode_id IS NULL
      AND (coalesce(s.failures, 0) = 0 OR s.next_poll_at IS NULL OR s.next_poll_at <= now())
    ORDER BY s.last_polled_at ASC NULLS FIRST, p.id LIMIT 20
  `;
  const selected: number[] = [];
  for (const row of candidates) {
    const id = Number(row.id);
    if (await claim(id)) selected.push(id);
    if (selected.length === 3) break;
  }
  await Promise.all(selected.map((id) => refresh(sql, id, 'rebuild')));
}
