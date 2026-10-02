import { cache } from 'react';
import type {
  IEpisodeInfo,
  IPaginatedEpisodes,
  IPodcastEpisodesInfo,
  IPodcastInfo,
} from '@/types';
import { sql } from '../db';
import { canAccessPodcast, podcastAccess } from '../podcast-access';
import {
  type EpisodePageOptions,
  prepareEpisodeRead,
  readEpisodePage,
} from './episode-read';
import { refreshFeed } from './feed-refresh';
import { findPodcastIdentity, indexPrivatePodcast } from './index-podcast';

export async function ingestPodcast(
  feedUrl: string,
  userId: string,
): Promise<IPodcastEpisodesInfo | null> {
  const id = await indexPrivatePodcast(sql, feedUrl, userId);
  return getPodcastById(id, userId);
}

export async function refreshPodcast(
  podcastId: number,
  userId: string | null = null,
): Promise<IPodcastEpisodesInfo | null> {
  if (!(await canAccessPodcast(sql, podcastId, userId))) return null;
  const result = await refreshFeed(sql, podcastId);
  if (result === 'not_found' || result === 'error') return null;
  return getPodcastById(podcastId, userId);
}

export async function getPodcastByFeedUrl(
  feedUrl: string,
  userId: string | null = null,
): Promise<IPodcastEpisodesInfo | null> {
  const podcast = await findPodcastIdentity(sql, feedUrl);
  return podcast ? getPodcastById(Number(podcast.id), userId) : null;
}

export async function getPodcastById(
  id: number,
  userId: string | null = null,
): Promise<IPodcastEpisodesInfo | null> {
  const [podcast] = await sql`
    SELECT p.*, a.name as author_name
    FROM podcasts p
    JOIN authors a ON a.id = p.author_id
    WHERE p.id = ${id} AND ${podcastAccess(sql, userId)}
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
    isPrivate: podcast.owner_user_id !== null,
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
        isPrivate: podcast.owner_user_id !== null,
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
  async (
    episodeId: number,
    userId: string | null = null,
  ): Promise<IEpisodeInfo | null> => {
    const query = () => sql`
    SELECT e.id, e.guid, e.published, e.podcast_id,
           c.title, c.summary, c.duration, c.episode_art,
           c.file_url, c.file_length, c.file_type,
           p.feed_url, p.title as podcast_title, p.cover as podcast_cover,
           p.explicit as podcast_explicit, p.owner_user_id, a.name as author_name
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    JOIN authors a ON a.id = p.author_id
    LEFT JOIN episode_content c ON c.episode_id = e.id
    WHERE e.id = ${episodeId} AND ${podcastAccess(sql, userId)}
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
      isPrivate: row.owner_user_id !== null,
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
  async (
    id: number,
    userId: string | null = null,
  ): Promise<IPodcastInfo | null> => {
    const [podcast] = await sql`
    SELECT p.*, a.name as author_name
    FROM podcasts p
    JOIN authors a ON a.id = p.author_id
    WHERE p.id = ${id} AND ${podcastAccess(sql, userId)}
  `;

    if (!podcast) return null;

    return {
      id: podcast.id,
      isPrivate: podcast.owner_user_id !== null,
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
  userId: string | null = null,
): Promise<IPaginatedEpisodes> {
  const { podcastId } = options;
  const podcast = await getPodcastInfoById(podcastId, userId);

  if (!podcast) {
    return { episodes: [], total: 0, hasMore: false };
  }

  await prepareEpisodeRead(sql, podcastId);
  const page = await readEpisodePage(sql, options);

  return {
    ...page,
    episodes: page.episodes.map(
      (ep): IEpisodeInfo => ({
        id: ep.id,
        podcastId: podcast.id,
        isPrivate: podcast.isPrivate,
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
  userId: string | null = null,
): Promise<{ episode: IEpisodeInfo; podcast: IPodcastInfo } | null> {
  const episode = await getEpisodeById(episodeId, userId);
  if (!episode || !episode.podcastId) return null;

  const podcast = await getPodcastInfoById(episode.podcastId, userId);
  if (!podcast) return null;

  return { episode, podcast };
}
