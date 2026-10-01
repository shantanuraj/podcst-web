import type { IPodcast } from '@/types';
import { sql } from '../db';

export async function publicTopPodcasts(
  podcasts: IPodcast[],
): Promise<IPodcast[]> {
  const ids = podcasts
    .map((podcast) => podcast.id)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!ids.length) return [];
  const rows =
    await sql`SELECT id, feed_url FROM podcasts WHERE id = ANY(${ids}::bigint[]) AND owner_user_id IS NULL`;
  const allowed = new Map(rows.map((row) => [Number(row.id), row.feed_url]));
  return podcasts.filter((podcast) => allowed.get(podcast.id) === podcast.feed);
}

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
      AND p.owner_user_id IS NULL
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
