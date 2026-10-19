import type { IPodcastEpisodesInfo } from '@/types';
import { sql } from './db';
import { prepareEpisodeRead } from './ingest/episode-read';
import { type FeedReadState, feedFreshness } from './ingest/feed-demand';
import { podcastAccess } from './podcast-access';

interface EpisodeRow {
  id: string;
  guid: string;
  published: string | Date | null;
  title: string;
  summary: string | null;
  duration: number | null;
  episode_art: string | null;
  file_url: string;
  file_length: string | null;
  file_type: string | null;
}

interface SubscriptionRow extends FeedReadState {
  id: string;
  feed_url: string;
  title: string;
  description: string | null;
  cover: string;
  link: string | null;
  explicit: boolean;
  owner_user_id: string | null;
  author: string;
  episodes: EpisodeRow[] | null;
}

export async function getSubscriptions(
  userId: string,
): Promise<IPodcastEpisodesInfo[]> {
  // Bound each podcast's episode read in SQL instead of making two network
  // round trips per subscription. The retained episodes also establish freshness.
  const rows = await sql<SubscriptionRow[]>`
    SELECT
      p.id,
      p.feed_url,
      p.title,
      p.description,
      p.cover,
      p.website_url as link,
      p.explicit,
      p.owner_user_id,
      a.name as author,
      f.last_success_at, f.last_rebuilt_at, f.next_poll_at,
      coalesce(f.failures, 0) AS failures, f.refresh_expires_at,
      f.demand_token, f.demand_expires_at,
      coalesce(f.demand_rebuild, false) AS demand_rebuild,
      recent.episodes IS NOT NULL AS has_content,
      p.episode_count = 0 AND f.last_success_at IS NOT NULL AS empty_feed,
      clock_timestamp() AS observed_at,
      recent.episodes
    FROM subscriptions s
    JOIN podcasts p ON p.id = s.podcast_id
    JOIN authors a ON a.id = p.author_id
    LEFT JOIN feed_poll_state f ON f.podcast_id = p.id
    LEFT JOIN LATERAL (
      SELECT json_agg(episode ORDER BY episode.published DESC) AS episodes
      FROM (
        SELECT e.id::text, e.guid, e.published,
               c.title, c.summary, c.duration, c.episode_art,
               c.file_url, c.file_length::text, c.file_type
        FROM episodes e
        JOIN episode_content c ON c.episode_id = e.id
        WHERE e.podcast_id = p.id
        ORDER BY e.published DESC
        LIMIT 2
      ) episode
    ) recent ON true
    WHERE s.user_id = ${userId} AND ${podcastAccess(sql, userId)}
    ORDER BY s.subscribed_at DESC
  `;

  const podcasts: IPodcastEpisodesInfo[] = [];

  let repairs = 0;
  for (const row of rows) {
    let freshness = feedFreshness(row);
    let episodes = row.episodes ?? [];
    if (freshness.content === 'missing' && repairs++ < 3) {
      const repaired = await prepareEpisodeRead(sql, row.id, userId);
      if (!repaired) continue;
      freshness = repaired;
      // A worker may have restored content since the initial snapshot.
      episodes = await sql<EpisodeRow[]>`
        SELECT e.id, e.guid, e.published,
               c.title, c.summary, c.duration, c.episode_art,
               c.file_url, c.file_length, c.file_type
        FROM episodes e
        JOIN episode_content c ON c.episode_id = e.id
        JOIN podcasts p ON p.id = e.podcast_id
        WHERE e.podcast_id = ${row.id} AND ${podcastAccess(sql, userId)}
        ORDER BY e.published DESC
        LIMIT 2
      `;
    }

    const mappedEpisodes = episodes.map((e) => ({
      id: e.id,
      podcastId: row.id,
      isPrivate: row.owner_user_id !== null,
      guid: e.guid,
      title: e.title,
      summary: e.summary,
      published: e.published ? new Date(e.published).getTime() : null,
      duration: e.duration,
      episodeArt: e.episode_art,
      cover: row.cover,
      explicit: row.explicit,
      link: null,
      showNotes: e.summary || '',
      author: row.author,
      feed: row.feed_url,
      podcastTitle: row.title,
      file: {
        url: e.file_url,
        length: Number(e.file_length) || 0,
        type: e.file_type || 'audio/mpeg',
      },
    }));

    podcasts.push({
      id: row.id,
      isPrivate: row.owner_user_id !== null,
      feed: row.feed_url,
      title: row.title,
      description: row.description || '',
      cover: row.cover,
      link: row.link,
      author: row.author,
      explicit: row.explicit,
      keywords: [],
      published: mappedEpisodes[0]?.published ?? null,
      episodes: mappedEpisodes,
      freshness,
    });
  }

  return podcasts;
}
