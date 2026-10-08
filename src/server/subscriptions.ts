import type { IPodcastEpisodesInfo } from '@/types';
import { sql } from './db';
import { podcastAccess } from './podcast-access';

export async function getSubscriptions(
  userId: string,
): Promise<IPodcastEpisodesInfo[]> {
  const rows = await sql`
    SELECT
      p.id,
      p.feed_url,
      p.title,
      p.description,
      p.cover,
      p.website_url as link,
      p.explicit,
      p.owner_user_id,
      a.name as author
    FROM subscriptions s
    JOIN podcasts p ON p.id = s.podcast_id
    JOIN authors a ON a.id = p.author_id
    WHERE s.user_id = ${userId} AND ${podcastAccess(sql, userId)}
    ORDER BY s.subscribed_at DESC
  `;

  const podcasts: IPodcastEpisodesInfo[] = [];

  for (const row of rows) {
    const episodes = await sql`
      SELECT e.id, e.guid, e.published,
             c.title, c.summary, c.duration, c.episode_art,
             c.file_url, c.file_length, c.file_type
      FROM episodes e
      JOIN episode_content c ON c.episode_id = e.id
      WHERE e.podcast_id = ${row.id}
      ORDER BY e.published DESC
      LIMIT 2
    `;

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
    });
  }

  return podcasts;
}
