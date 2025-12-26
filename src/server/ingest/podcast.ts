import { sql } from '../db';
import { adaptFeed } from '@/app/api/feed/parser';
import type {
  IEpisode,
  IEpisodeListing,
  IPodcastEpisodesInfo,
  IEpisodeInfo,
} from '@/types';

export async function ingestPodcast(
  feedUrl: string,
): Promise<IPodcastEpisodesInfo | null> {
  const existing = await getPodcastByFeedUrl(feedUrl);
  if (existing && existing.episodes.length > 0) {
    return existing;
  }

  const feedData = await fetchAndParseFeed(feedUrl);
  if (!feedData) {
    return null;
  }

  const podcast = await storePodcast(feedUrl, feedData);
  if (!podcast) {
    return null;
  }

  await storeEpisodes(podcast.id, feedUrl, feedData.episodes);

  return getPodcastByFeedUrl(feedUrl);
}

export async function refreshPodcast(
  podcastId: number,
): Promise<IPodcastEpisodesInfo | null> {
  const [existing] = await sql`
    SELECT id, feed_url FROM podcasts WHERE id = ${podcastId}
  `;

  if (!existing) {
    return null;
  }

  const feedUrl = existing.feed_url;
  const feedData = await fetchAndParseFeed(feedUrl);
  if (!feedData) {
    return null;
  }

  await sql`
    UPDATE podcasts SET
      title = ${feedData.title},
      description = ${feedData.description},
      cover = ${feedData.cover},
      website_url = ${feedData.link},
      explicit = ${feedData.explicit},
      last_published = ${feedData.published ? new Date(feedData.published) : null},
      updated_at = now()
    WHERE id = ${existing.id}
  `;

  await storeEpisodes(existing.id, feedUrl, feedData.episodes);

  return getPodcastByFeedUrl(feedUrl);
}

async function fetchAndParseFeed(
  feedUrl: string,
): Promise<IEpisodeListing | null> {
  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'Podcst/1.0' },
    });
    if (!res.ok) {
      console.error(`Failed to fetch feed: ${feedUrl} - ${res.status}`);
      return null;
    }
    const xml = await res.text();
    return adaptFeed(xml);
  } catch (err) {
    console.error(`Error fetching feed ${feedUrl}:`, err);
    return null;
  }
}

async function storePodcast(feedUrl: string, data: IEpisodeListing) {
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

  return podcast;
}

async function storeEpisodes(
  podcastId: number,
  feedUrl: string,
  episodes: IEpisode[],
) {
  if (episodes.length === 0) return;

  for (const ep of episodes) {
    if (!ep.guid) continue;

    await sql`
      INSERT INTO episodes (
        podcast_id, guid, title, summary, published, duration,
        episode_art, file_url, file_length, file_type
      ) VALUES (
        ${podcastId},
        ${ep.guid},
        ${ep.title},
        ${ep.showNotes || ep.summary},
        ${ep.published ? new Date(ep.published) : new Date()},
        ${ep.duration},
        ${ep.episodeArt},
        ${ep.file.url},
        ${ep.file.length},
        ${ep.file.type}
      )
      ON CONFLICT (podcast_id, guid) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        duration = EXCLUDED.duration,
        episode_art = EXCLUDED.episode_art,
        file_url = EXCLUDED.file_url
    `;
  }

  await sql`
    UPDATE podcasts SET episode_count = (
      SELECT COUNT(*) FROM episodes WHERE podcast_id = ${podcastId}
    ) WHERE id = ${podcastId}
  `;
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
