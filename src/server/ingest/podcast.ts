import { cache } from 'react';
import type {
  IEpisodeInfo,
  IPaginatedEpisodes,
  IPodcastEpisodesInfo,
  IPodcastInfo,
} from '@/types';
import { sql } from '../db';
import {
  type EpisodePageOptions,
  prepareEpisodeRead,
  readEpisodePage,
} from './episode-read';
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

  await prepareEpisodeRead(sql, podcast.id);

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

  await prepareEpisodeRead(sql, podcast.id);

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

export const getEpisodeById = cache(
  async (episodeId: number): Promise<IEpisodeInfo | null> => {
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
      await prepareEpisodeRead(sql, row.podcast_id as number);
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
  },
);

export const getPodcastInfoById = cache(
  async (id: number): Promise<IPodcastInfo | null> => {
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
  },
);

export type { SortDirection, SortField } from './episode-read';

export async function getEpisodesPaginated(
  options: EpisodePageOptions,
): Promise<IPaginatedEpisodes> {
  const { podcastId } = options;

  const [podcast] = await Promise.all([
    getPodcastInfoById(podcastId),
    prepareEpisodeRead(sql, podcastId),
  ]);

  if (!podcast) {
    return { episodes: [], total: 0, hasMore: false };
  }

  const page = await readEpisodePage(sql, options);

  return {
    ...page,
    episodes: page.episodes.map(
      (ep): IEpisodeInfo => ({
        id: ep.id,
        podcastId: podcast.id,
        feed: podcast.feed,
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
        author: podcast.author,
        file: {
          url: ep.file_url,
          length: Number(ep.file_length) || 0,
          type: ep.file_type || 'audio/mpeg',
        },
      }),
    ),
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
