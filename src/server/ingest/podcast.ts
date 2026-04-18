import { createHash } from 'crypto';
import { adaptFeed } from '@/app/api/feed/parser';
import type {
  IEpisodeInfo,
  IEpisodeListing,
  IPaginatedEpisodes,
  IPodcastEpisodesInfo,
  IPodcastInfo,
} from '@/types';
import { sql } from '../db';
import { upsertEpisodes } from './episodes';

interface FeedFetchResult {
  data: IEpisodeListing;
  etag: string | null;
  lastModified: string | null;
  hash: string;
}

export async function ingestPodcast(
  feedUrl: string,
): Promise<IPodcastEpisodesInfo | null> {
  const existing = await getPodcastByFeedUrl(feedUrl);
  if (existing && existing.episodes.length > 0) {
    return existing;
  }

  const result = await fetchAndParseFeed(feedUrl);
  if (!result) {
    return null;
  }

  const { data, etag, lastModified, hash } = result;
  const podcast = await storePodcast(feedUrl, data, {
    etag,
    lastModified,
    hash,
  });
  if (!podcast) {
    return null;
  }

  await upsertEpisodes(sql, podcast.id, data.cover, data.episodes);

  return getPodcastByFeedUrl(feedUrl);
}

export async function refreshPodcast(
  podcastId: number,
): Promise<IPodcastEpisodesInfo | null> {
  const [existing] = await sql`
    SELECT id, feed_url, update_frequency FROM podcasts WHERE id = ${podcastId}
  `;

  if (!existing) {
    return null;
  }

  const feedUrl = existing.feed_url;
  const result = await fetchAndParseFeed(feedUrl);
  if (!result) {
    return null;
  }

  const { data, etag, lastModified, hash } = result;
  const interval = existing.update_frequency || 86400;

  await sql`
    UPDATE podcasts SET
      title = ${data.title},
      description = ${data.description},
      cover = ${data.cover},
      website_url = ${data.link},
      explicit = ${data.explicit},
      episode_count = ${data.episodes.length},
      last_published = ${data.published ? new Date(data.published) : null},
      updated_at = now()
    WHERE id = ${existing.id}
  `;

  await upsertEpisodes(sql, existing.id, data.cover, data.episodes);

  await savePollState(existing.id, { etag, lastModified, hash }, interval);

  return getPodcastByFeedUrl(feedUrl);
}

async function fetchAndParseFeed(
  feedUrl: string,
): Promise<FeedFetchResult | null> {
  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'Podcst/1.0' },
    });
    if (!res.ok) {
      console.error(`Failed to fetch feed: ${feedUrl} - ${res.status}`);
      return null;
    }
    const xml = await res.text();
    const data = await adaptFeed(xml);
    if (!data) return null;

    return {
      data,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      hash: createHash('sha256').update(xml).digest('hex'),
    };
  } catch (err) {
    console.error(`Error fetching feed ${feedUrl}:`, err);
    return null;
  }
}

interface FeedMeta {
  etag: string | null;
  lastModified: string | null;
  hash: string;
}

async function savePollState(
  podcastId: number,
  meta: FeedMeta,
  intervalSeconds: number,
): Promise<void> {
  await sql`
    INSERT INTO feed_poll_state (
      podcast_id, etag, last_modified, hash,
      last_polled_at, next_poll_at, failures
    ) VALUES (
      ${podcastId}, ${meta.etag}, ${meta.lastModified}, ${meta.hash},
      now(), now() + interval '1 second' * ${intervalSeconds}, 0
    )
    ON CONFLICT (podcast_id) DO UPDATE SET
      etag = EXCLUDED.etag,
      last_modified = EXCLUDED.last_modified,
      hash = EXCLUDED.hash,
      last_polled_at = now(),
      next_poll_at = EXCLUDED.next_poll_at,
      failures = 0
  `;
}

async function storePodcast(
  feedUrl: string,
  data: IEpisodeListing,
  meta: FeedMeta,
) {
  const authorName = data.author || 'Unknown';

  let [author] = await sql`
    SELECT id FROM authors WHERE name = ${authorName} LIMIT 1
  `;

  if (!author) {
    [author] = await sql`
      INSERT INTO authors (name) VALUES (${authorName})
      RETURNING id
    `;
  }

  const [podcast] = await sql`
    INSERT INTO podcasts (
      feed_url, title, author_id, description, cover, website_url,
      explicit, episode_count, last_published
    ) VALUES (
      ${feedUrl},
      ${data.title},
      ${author.id},
      ${data.description},
      ${data.cover},
      ${data.link},
      ${data.explicit},
      ${data.episodes.length},
      ${data.published ? new Date(data.published) : null}
    )
    ON CONFLICT (feed_url) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      cover = EXCLUDED.cover,
      website_url = EXCLUDED.website_url,
      explicit = EXCLUDED.explicit,
      episode_count = EXCLUDED.episode_count,
      last_published = EXCLUDED.last_published,
      updated_at = now()
    RETURNING id
  `;

  await savePollState(podcast.id, meta, 86400);

  return podcast;
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

  const episodes = await sql`
    SELECT * FROM episodes
    WHERE podcast_id = ${podcast.id}
    ORDER BY published DESC
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

  const episodes = await sql`
    SELECT * FROM episodes
    WHERE podcast_id = ${podcast.id}
    ORDER BY published DESC
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
  const [row] = await sql`
    SELECT e.*, p.id as podcast_id, p.feed_url, p.title as podcast_title, p.cover as podcast_cover,
           p.explicit as podcast_explicit, a.name as author_name
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    JOIN authors a ON a.id = p.author_id
    WHERE e.id = ${episodeId}
  `;

  if (!row) return null;

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
      url: row.file_url,
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

  let episodes: Array<Record<string, unknown>>;
  let countResult: Array<{ count: string }>;

  if (search) {
    const searchPattern = `%${search}%`;

    countResult = await sql`
      SELECT COUNT(*)::text as count FROM episodes
      WHERE podcast_id = ${podcastId}
        AND (title ILIKE ${searchPattern} OR summary ILIKE ${searchPattern})
    `;

    if (sortBy === 'published') {
      if (sortDir === 'desc') {
        episodes = await sql`
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
            AND (title ILIKE ${searchPattern} OR summary ILIKE ${searchPattern})
          ORDER BY published DESC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
            AND (title ILIKE ${searchPattern} OR summary ILIKE ${searchPattern})
          ORDER BY published ASC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      }
    } else if (sortBy === 'title') {
      if (sortDir === 'asc') {
        episodes = await sql`
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
            AND (title ILIKE ${searchPattern} OR summary ILIKE ${searchPattern})
          ORDER BY title ASC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
            AND (title ILIKE ${searchPattern} OR summary ILIKE ${searchPattern})
          ORDER BY title DESC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      }
    } else {
      if (sortDir === 'asc') {
        episodes = await sql`
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
            AND (title ILIKE ${searchPattern} OR summary ILIKE ${searchPattern})
          ORDER BY duration ASC NULLS LAST
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
            AND (title ILIKE ${searchPattern} OR summary ILIKE ${searchPattern})
          ORDER BY duration DESC NULLS LAST
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
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
          ORDER BY published DESC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
          ORDER BY published ASC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      }
    } else if (sortBy === 'title') {
      if (sortDir === 'asc') {
        episodes = await sql`
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
          ORDER BY title ASC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
          ORDER BY title DESC
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      }
    } else {
      if (sortDir === 'asc') {
        episodes = await sql`
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
          ORDER BY duration ASC NULLS LAST
          LIMIT ${limit + 1}
          ${cursor ? sql`OFFSET ${cursor}` : sql``}
        `;
      } else {
        episodes = await sql`
          SELECT * FROM episodes
          WHERE podcast_id = ${podcastId}
          ORDER BY duration DESC NULLS LAST
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

export async function getPodcastIdByItunesId(
  itunesId: string,
): Promise<number | null> {
  const [podcast] = await sql`
    SELECT id FROM podcasts WHERE itunes_id = ${itunesId} LIMIT 1
  `;

  return podcast ? (podcast.id as number) : null;
}
