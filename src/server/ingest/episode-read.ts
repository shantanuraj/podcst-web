import type postgres from 'postgres';
import { podcastAccess } from '../podcast-access';
import {
  feedFreshness,
  readFeedState,
  requestFeedRefresh,
} from './feed-demand';
import { interactiveAdmission } from './interactive-admission';

export async function prepareEpisodeRead(
  sql: postgres.Sql,
  podcastId: string,
  userId: string | null = null,
  episodeId?: string,
  admit = async () =>
    (await interactiveAdmission()).refresh(
      userId
        ? { kind: 'account', id: userId }
        : { kind: 'source', id: 'unattributed' },
    ),
) {
  const row = await readFeedState(sql, podcastId, userId, episodeId);
  if (!row) return null;
  await sql`
    UPDATE podcasts p SET last_accessed_at = now()
    WHERE p.id = ${podcastId} AND ${podcastAccess(sql, userId)}
      AND (last_accessed_at IS NULL OR last_accessed_at < now() - interval '1 hour')
  `;
  if (feedFreshness(row).content === 'cached') return feedFreshness(row);
  try {
    return await requestFeedRefresh(sql, podcastId, userId, admit, episodeId);
  } catch {
    const current = await readFeedState(sql, podcastId, userId, episodeId);
    if (!current) return null;
    const freshness = feedFreshness(current);
    return freshness.state === 'stale'
      ? { ...freshness, state: 'unavailable' as const, retryAtMs: null }
      : freshness;
  }
}

export type SortField = 'published' | 'title' | 'duration';
export type SortDirection = 'asc' | 'desc';

export interface EpisodePageOptions {
  podcastId: string;
  limit?: number;
  cursor?: number;
  search?: string;
  sortBy?: SortField;
  sortDir?: SortDirection;
  unplayedBy?: string;
}

interface EpisodeRow {
  id: string;
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
    unplayedBy,
  }: EpisodePageOptions,
  userId: string | null = null,
) {
  const filter = sql`
    ${search ? sql`AND (c.title ILIKE ${`%${search}%`} OR c.summary ILIKE ${`%${search}%`})` : sql``}
    ${
      unplayedBy
        ? sql`AND NOT EXISTS (
            SELECT 1 FROM playback_progress pp
            WHERE pp.user_id = ${unplayedBy} AND pp.episode_id = e.id AND pp.completed
          )`
        : sql``
    }
  `;
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
      JOIN podcasts p ON p.id = e.podcast_id
      WHERE e.podcast_id = ${podcastId} AND ${podcastAccess(sql, userId)} ${filter}
    `,
    sql<EpisodeRow[]>`
      SELECT e.id, e.guid, e.published,
             c.title, c.summary, c.duration, c.episode_art,
             c.file_url, c.file_length, c.file_type
      FROM episodes e
      JOIN episode_content c ON c.episode_id = e.id
      JOIN podcasts p ON p.id = e.podcast_id
      WHERE e.podcast_id = ${podcastId} AND ${podcastAccess(sql, userId)} ${filter}
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
