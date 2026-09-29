import type {
  IEpisodeInfo,
  IPaginatedEpisodes,
  IPodcastEpisodesInfo,
  IPodcastInfo,
} from '@/types';
import { sql } from '../db';
import { ensureContent, touchAccess } from './episode-read';
import { refreshFeed } from './feed-refresh';
import { indexPodcast } from './index-podcast';

export async function ingestPodcast(
  feedUrl: string,
): Promise<IPodcastEpisodesInfo | null> {
  const existing = await getPodcastByFeedUrl(feedUrl);
  if (existing?.id) {
    return existing.episodes.length > 0
      ? existing
      : refreshPodcast(existing.id);
  }

  const id = await indexPodcast(sql, feedUrl).catch(() => null);
  return id === null ? null : getPodcastById(id);
}

export async function refreshPodcast(
  podcastId: number,
): Promise<IPodcastEpisodesInfo | null> {
  const result = await refreshFeed(sql, podcastId);
  if (result === 'not_found' || result === 'error') return null;
  return getPodcastById(podcastId);
}

export async function getPodcastByFeedUrl(
  feedUrl: string,
): Promise<IPodcastEpisodesInfo | null> {
  const [podcast] = await sql`
    SELECT p.*, a.name as author_name
    FROM podcasts p
    JOIN authors a ON a.id = p.author_id
    WHERE p.feed_url = ${feedUrl}
  `;

  if (!podcast) {
    return null;
  }

  await touchAccess(podcast.id);
  await ensureContent(podcast.id);

  const episodes = await sql`
    SELECT e.id, e.guid, e.published,
           c.title, c.summary, c.duration, c.episode_art,
           c.file_url, c.file_length, c.file_type
    FROM episodes e
    LEFT JOIN episode_content c ON c.episode_id = e.id
    WHERE e.podcast_id = ${podcast.id}
    ORDER BY e.published DESC
  `;

  return {
    id: podcast.id,
    feed: feedUrl,
    title: podcast.title,
    author: podcast.author_name,
    cover: podcast.cover,
    description: podcast.description || '',
    link: podcast.website_url,
    published: podcast.last_published?.getTime() || null,
    explicit: podcast.explicit,
    keywords: [],
    episodes: episodes.map(
      (ep): IEpisodeInfo => ({
        id: ep.id,
        podcastId: podcast.id,
        feed: feedUrl,
        podcastTitle: podcast.title,
        guid: ep.guid,
        title: ep.title,
        summary: ep.summary,
        showNotes: ep.summary || '',
        published: ep.published?.getTime() || null,
        duration: ep.duration,
        cover: podcast.cover,
        episodeArt: ep.episode_art,
        explicit: podcast.explicit,
        link: null,
        author: podcast.author_name,
        file: {
          url: ep.file_url,
          length: Number(ep.file_length) || 0,
          type: ep.file_type || 'audio/mpeg',
        },
      }),
    ),
  };
}

export async function getPodcastById(
  id: number,
): Promise<IPodcastEpisodesInfo | null> {
  const [podcast] = await sql`
    SELECT p.*, a.name as author_name
    FROM podcasts p
    JOIN authors a ON a.id = p.author_id
    WHERE p.id = ${id}
  `;

  if (!podcast) return null;

  await touchAccess(podcast.id);
  await ensureContent(podcast.id);

  const episodes = await sql`
    SELECT e.id, e.guid, e.published,
           c.title, c.summary, c.duration, c.episode_art,
           c.file_url, c.file_length, c.file_type
    FROM episodes e
    LEFT JOIN episode_content c ON c.episode_id = e.id
    WHERE e.podcast_id = ${podcast.id}
    ORDER BY e.published DESC
  `;

  return {
    id: podcast.id,
    feed: podcast.feed_url,
    title: podcast.title,
    author: podcast.author_name,
    cover: podcast.cover,
    description: podcast.description || '',
    link: podcast.website_url,
    published: podcast.last_published?.getTime() || null,
    explicit: podcast.explicit,
    keywords: [],
    episodes: episodes.map(
      (ep): IEpisodeInfo => ({
        id: ep.id,
        podcastId: podcast.id,
        feed: podcast.feed_url,
        podcastTitle: podcast.title,
        guid: ep.guid,
        title: ep.title,
        summary: ep.summary,
        showNotes: ep.summary || '',
        published: ep.published?.getTime() || null,
        duration: ep.duration,
        cover: podcast.cover,
        episodeArt: ep.episode_art,
        explicit: podcast.explicit,
        link: null,
        author: podcast.author_name,
        file: {
          url: ep.file_url,
          length: Number(ep.file_length) || 0,
          type: ep.file_type || 'audio/mpeg',
        },
      }),
    ),
  };
}

export async function getEpisodeById(
  episodeId: number,
): Promise<IEpisodeInfo | null> {
  const query = () => sql`
    SELECT e.id, e.guid, e.published, e.podcast_id,
           c.title, c.summary, c.duration, c.episode_art,
           c.file_url, c.file_length, c.file_type,
           p.feed_url, p.title as podcast_title, p.cover as podcast_cover,
           p.explicit as podcast_explicit, a.name as author_name
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    JOIN authors a ON a.id = p.author_id
    LEFT JOIN episode_content c ON c.episode_id = e.id
    WHERE e.id = ${episodeId}
  `;

  let [row] = await query();
  if (!row) return null;

  if (row.file_url == null) {
    await ensureContent(row.podcast_id as number);
    [row] = await query();
    if (!row) return null;
  }

  return {
    id: row.id,
    podcastId: row.podcast_id,
    feed: row.feed_url,
    podcastTitle: row.podcast_title,
    guid: row.guid,
    title: row.title,
    summary: row.summary,
    showNotes: row.summary || '',
    published: row.published?.getTime() || null,
    duration: row.duration,
    cover: row.podcast_cover,
    episodeArt: row.episode_art,
    explicit: row.podcast_explicit,
    link: null,
    author: row.author_name,
    file: {
      url: row.file_url ?? '',
      length: Number(row.file_length) || 0,
      type: row.file_type || 'audio/mpeg',
    },
  };
}

export async function getPodcastInfoById(
  id: number,
): Promise<IPodcastInfo | null> {
  const [podcast] = await sql`
    SELECT p.*, a.name as author_name
    FROM podcasts p
    JOIN authors a ON a.id = p.author_id
    WHERE p.id = ${id}
  `;

  if (!podcast) return null;

  return {
    id: podcast.id,
    feed: podcast.feed_url,
    title: podcast.title,
    author: podcast.author_name,
    cover: podcast.cover,
    description: podcast.description || '',
    link: podcast.website_url,
    published: podcast.last_published?.getTime() || null,
    explicit: podcast.explicit,
    keywords: [],
    episodeCount: podcast.episode_count || 0,
  };
}

export type SortField = 'published' | 'title' | 'duration';
export type SortDirection = 'asc' | 'desc';

interface GetEpisodesOptions {
  podcastId: number;
  limit?: number;
  cursor?: number;
  search?: string;
  sortBy?: SortField;
  sortDir?: SortDirection;
}

export async function getEpisodesPaginated(
  options: GetEpisodesOptions,
): Promise<IPaginatedEpisodes> {
  const {
    podcastId,
    limit = 20,
    cursor,
    search,
    sortBy = 'published',
    sortDir = 'desc',
  } = options;

  const [podcast] = await sql`
    SELECT p.*, a.name as author_name
    FROM podcasts p
    JOIN authors a ON a.id = p.author_id
    WHERE p.id = ${podcastId}
  `;

  if (!podcast) {
    return { episodes: [], total: 0, hasMore: false };
  }

  await touchAccess(podcastId);
  await ensureContent(podcastId);

  let episodes: Array<Record<string, unknown>>;
  let countResult: Array<{ count: string }>;

  if (search) {
    const searchPattern = `%${search}%`;

    countResult = await sql`
      SELECT COUNT(*)::text as count FROM episodes e
      LEFT JOIN episode_content c ON c.episode_id = e.id
      WHERE e.podcast_id = ${podcastId}
        AND (c.title ILIKE ${searchPattern} OR c.summary ILIKE ${searchPattern})
    `;

    if (sortBy === 'published') {
      if (sortDir === 'desc') {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
            AND (c.title ILIKE ${searchPattern} OR c.summary ILIKE ${searchPattern})
          ORDER BY e.published DESC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
            AND (c.title ILIKE ${searchPattern} OR c.summary ILIKE ${searchPattern})
          ORDER BY e.published ASC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      }
    } else if (sortBy === 'title') {
      if (sortDir === 'asc') {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
            AND (c.title ILIKE ${searchPattern} OR c.summary ILIKE ${searchPattern})
          ORDER BY c.title ASC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
            AND (c.title ILIKE ${searchPattern} OR c.summary ILIKE ${searchPattern})
          ORDER BY c.title DESC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      }
    } else {
      if (sortDir === 'asc') {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
            AND (c.title ILIKE ${searchPattern} OR c.summary ILIKE ${searchPattern})
          ORDER BY c.duration ASC NULLS LAST
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
            AND (c.title ILIKE ${searchPattern} OR c.summary ILIKE ${searchPattern})
          ORDER BY c.duration DESC NULLS LAST
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      }
    }
  } else {
    countResult = await sql`
      SELECT COUNT(*)::text as count FROM episodes WHERE podcast_id = ${podcastId}
    `;

    if (sortBy === 'published') {
      if (sortDir === 'desc') {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
          ORDER BY e.published DESC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
          ORDER BY e.published ASC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      }
    } else if (sortBy === 'title') {
      if (sortDir === 'asc') {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
          ORDER BY c.title ASC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
          ORDER BY c.title DESC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      }
    } else {
      if (sortDir === 'asc') {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
          ORDER BY c.duration ASC NULLS LAST
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT e.id, e.guid, e.published,
                 c.title, c.summary, c.duration, c.episode_art,
                 c.file_url, c.file_length, c.file_type
          FROM episodes e
          LEFT JOIN episode_content c ON c.episode_id = e.id
          WHERE e.podcast_id = ${podcastId}
          ORDER BY c.duration DESC NULLS LAST
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      }
    }
  }

  const total = parseInt(countResult[0]?.count || '0', 10);
  const hasMore = episodes.length > limit;

  if (hasMore) {
    episodes.pop();
  }

  const nextCursor = hasMore ? (cursor || 0) + limit : undefined;

  return {
    episodes: episodes.map(
      (ep): IEpisodeInfo => ({
        id: ep.id as number,
        podcastId: podcast.id,
        feed: podcast.feed_url,
        podcastTitle: podcast.title,
        guid: ep.guid as string,
        title: ep.title as string,
        summary: ep.summary as string | null,
        showNotes: (ep.summary as string) || '',
        published: (ep.published as Date)?.getTime() || null,
        duration: ep.duration as number | null,
        cover: podcast.cover,
        episodeArt: ep.episode_art as string | null,
        explicit: podcast.explicit,
        link: null,
        author: podcast.author_name,
        file: {
          url: ep.file_url as string,
          length: Number(ep.file_length) || 0,
          type: (ep.file_type as string) || 'audio/mpeg',
        },
      }),
    ),
    total,
    hasMore,
    nextCursor,
  };
}

export async function getEpisodeWithPodcast(
  episodeId: number,
): Promise<{ episode: IEpisodeInfo; podcast: IPodcastInfo } | null> {
  const episode = await getEpisodeById(episodeId);
  if (!episode || !episode.podcastId) return null;

  const podcast = await getPodcastInfoById(episode.podcastId);
  if (!podcast) return null;

  return { episode, podcast };
}
