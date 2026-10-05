import type { IPodcast } from '@/types';
import { sql } from '../db';
import { genreColumns, genreJoin, genresOf } from '../genres';

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
    WITH latest AS (
      SELECT max(day) AS day FROM chart_history WHERE country_id = ${locale}
    ), base AS (
      SELECT min(h.day) AS day
      FROM chart_history h, latest
      WHERE h.country_id = ${locale} AND h.day >= latest.day - 7 AND h.day < latest.day
    )
    SELECT
      p.id,
      p.itunes_id,
      p.title,
      p.feed_url,
      p.cover,
      p.thumbnail,
      p.explicit,
      p.episode_count,
      a.name AS author_name,
      ${genreColumns(sql)},
      base.day IS NOT NULL AS compared,
      previous.rank AS previous_rank
    FROM top_podcasts tp
    JOIN podcasts p ON p.id = tp.podcast_id
    JOIN authors a ON a.id = p.author_id
    ${genreJoin(sql, 'p')}
    CROSS JOIN base
    LEFT JOIN chart_history previous
      ON previous.country_id = tp.country_id AND previous.day = base.day AND previous.podcast_id = p.id
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
    ...genresOf(r),
    ...(r.compared ? { previousRank: r.previous_rank ?? null } : {}),
  }));
}
