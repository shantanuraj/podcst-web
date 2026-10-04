import type postgres from 'postgres';
import { refreshFeed } from './feed-refresh';

export async function prepareEpisodeRead(
  sql: postgres.Sql,
  podcastId: number,
): Promise<void> {
  const [{ has_episodes, has_content }] = await sql`
    WITH accessed AS (
      UPDATE podcasts
      SET last_accessed_at = now()
      WHERE id = ${podcastId}
        AND (last_accessed_at IS NULL OR last_accessed_at < now() - interval '1 hour')
      RETURNING id
    )
    SELECT
      EXISTS (SELECT 1 FROM episodes WHERE podcast_id = ${podcastId}) AS has_episodes,
      EXISTS (
        SELECT 1 FROM episode_content c JOIN episodes e ON e.id = c.episode_id
        WHERE e.podcast_id = ${podcastId}
      ) AS has_content
  `;
  if (has_episodes && !has_content) {
    await refreshFeed(sql, podcastId, 'rebuild');
  }
}

export type SortField = 'published' | 'title' | 'duration';
export type SortDirection = 'asc' | 'desc';

export interface EpisodePageOptions {
  podcastId: number;
  limit?: number;
  cursor?: number;
  search?: string;
  sortBy?: SortField;
  sortDir?: SortDirection;
}

interface EpisodeRow {
  id: number;
  guid: string;
  published: Date | null;
  title: string;
  summary: string | null;
  duration: number | null;
  episode_art: string | null;
  file_url: string;
  file_length: number | string | null;
  file_type: string | null;
}

export async function readEpisodePage(
  sql: postgres.Sql,
  {
    podcastId,
    limit = 20,
    cursor,
    search,
    sortBy = 'published',
    sortDir = 'desc',
  }: EpisodePageOptions,
) {
  const filter = search
    ? sql`AND (c.title ILIKE ${`%${search}%`} OR c.summary ILIKE ${`%${search}%`})`
    : sql``;
  const sortColumn =
    sortBy === 'title'
      ? sql`c.title`
      : sortBy === 'duration'
        ? sql`c.duration`
        : sql`e.published`;
  const direction = sortDir === 'asc' ? sql`ASC` : sql`DESC`;
  const nulls = sortBy === 'duration' ? sql`NULLS LAST` : sql``;

  const [countResult, episodes] = await Promise.all([
    sql`
      SELECT COUNT(*)::text AS count FROM episodes e
      JOIN episode_content c ON c.episode_id = e.id
      WHERE e.podcast_id = ${podcastId} ${filter}
    `,
    sql<EpisodeRow[]>`
      SELECT e.id, e.guid, e.published,
             c.title, c.summary, c.duration, c.episode_art,
             c.file_url, c.file_length, c.file_type
      FROM episodes e
      JOIN episode_content c ON c.episode_id = e.id
      WHERE e.podcast_id = ${podcastId} ${filter}
      ORDER BY ${sortColumn} ${direction} ${nulls}, e.id ${direction}
      LIMIT ${limit + 1}
      ${cursor ? sql`OFFSET ${cursor}` : sql``}
    `,
  ]);

  const total = parseInt(countResult[0]?.count || '0', 10);
  const hasMore = episodes.length > limit;

  if (hasMore) {
    episodes.pop();
  }

  const nextCursor = hasMore ? (cursor || 0) + limit : undefined;

  return { episodes, total, hasMore, nextCursor };
}
