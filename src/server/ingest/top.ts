import { sql } from '../db';
import type { IPodcast } from '@/types';

export async function getTopPodcasts(
  limit: number,
  locale: string,
): Promise<IPodcast[]> {
  const rows = await sql`
    SELECT
      p.id,
      p.itunes_id,
      p.title,
      p.feed_url,
      p.cover,
      p.thumbnail,
      p.explicit,
      p.episode_count,
      a.name as author_name
    FROM top_podcasts tp
    JOIN podcasts p ON p.id = tp.podcast_id
    JOIN authors a ON a.id = p.author_id
    WHERE tp.country_id = ${locale}
      AND tp.genre_id = 0
    ORDER BY tp.rank
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    itunes_id: r.itunes_id,
    author: r.author_name,
    feed: r.feed_url,
    title: r.title,
    cover: r.cover,
    thumbnail: r.thumbnail || r.cover,
    categories: [],
    explicit: r.explicit ? 'explicit' : 'notExplicit',
    count: r.episode_count,
  }));
}
