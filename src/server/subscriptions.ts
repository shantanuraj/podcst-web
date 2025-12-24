import { sql } from './db';
import { ingestPodcast, getPodcastByFeedUrl } from './ingest/podcast';
import type { IPodcastEpisodesInfo } from '@/types';

export async function getSubscriptions(userId: string): Promise<IPodcastEpisodesInfo[]> {
  const rows = await sql`
    SELECT
      p.id,
      p.feed_url,
      p.title,
      p.description,
      p.cover,
      p.website_url as link,
      p.explicit,
      a.name as author
    FROM subscriptions s
    JOIN podcasts p ON p.id = s.podcast_id
    JOIN authors a ON a.id = p.author_id
    WHERE s.user_id = ${userId}
    ORDER BY s.subscribed_at DESC
  `;

  const podcasts: IPodcastEpisodesInfo[] = [];

  for (const row of rows) {
    const episodes = await sql`
      SELECT
        e.id,
        e.guid,
        e.title,
        e.summary,
        e.published,
        e.duration,
        e.episode_art,
        e.file_url,
        e.file_length,
        e.file_type
      FROM episodes e
      WHERE e.podcast_id = ${row.id}
      ORDER BY e.published DESC
      LIMIT 2
    `;

    const mappedEpisodes = episodes.map((e) => ({
      id: e.id,
      podcastId: row.id,
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
    });
  }

  return podcasts;
}

export async function addSubscription(userId: string, podcastId: number): Promise<boolean> {
  const [exists] = await sql`
    SELECT 1 FROM podcasts WHERE id = ${podcastId}
  `;
  if (!exists) return false;

  await sql`
    INSERT INTO subscriptions (user_id, podcast_id)
    VALUES (${userId}, ${podcastId})
    ON CONFLICT (user_id, podcast_id) DO NOTHING
  `;

  return true;
}

export async function removeSubscription(userId: string, podcastId: number): Promise<boolean> {
  await sql`
    DELETE FROM subscriptions
    WHERE user_id = ${userId} AND podcast_id = ${podcastId}
  `;

  return true;
}

export async function importSubscriptions(
  userId: string,
  feedUrls: string[],
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (const feedUrl of feedUrls) {
    let podcast = await getPodcastByFeedUrl(feedUrl);
    if (!podcast) {
      podcast = await ingestPodcast(feedUrl);
    }
    if (!podcast?.id) {
      failed++;
      continue;
    }

    await sql`
      INSERT INTO subscriptions (user_id, podcast_id)
      VALUES (${userId}, ${podcast.id})
      ON CONFLICT (user_id, podcast_id) DO NOTHING
    `;
    succeeded++;
  }

  return { succeeded, failed };
}
