import type { IPodcast } from '@/types';
import { sql } from './db';
import { genreColumns, genreJoin, genresOf } from './genres';

const DEBUT_DAYS = 180;
const CHART_SHOWN = 30;
const SHARED_LISTENERS = 3;

export type Noteworthy = IPodcast & { firstPublished: number | null };

const podcast = (r: Record<string, unknown>): IPodcast => ({
  id: Number(r.id),
  itunes_id: (r.itunes_id as number | null) ?? undefined,
  author: r.author_name as string,
  feed: r.feed_url as string,
  title: r.title as string,
  cover: r.cover as string,
  thumbnail: (r.thumbnail as string | null) || (r.cover as string),
  categories: [],
  explicit: r.explicit ? 'explicit' : 'notExplicit',
  count: r.episode_count as number,
  ...genresOf(r),
});

export async function noteworthy(
  locale: string,
  limit: number,
  category: number | null,
): Promise<Noteworthy[]> {
  const rows = await sql`
    SELECT p.id, p.itunes_id, p.title, p.feed_url, p.cover, p.thumbnail, p.explicit,
           p.episode_count, a.name AS author_name, ${genreColumns(sql)}, tp.rank,
           (SELECT min(e.published) FROM episodes e WHERE e.podcast_id = p.id) AS first_published
    FROM top_podcasts tp
    JOIN podcasts p ON p.id = tp.podcast_id
    JOIN authors a ON a.id = p.author_id
    ${genreJoin(sql, 'p')}
    WHERE tp.country_id = ${locale} AND tp.genre_id = 0 AND p.owner_user_id IS NULL
      ${category === null ? sql`` : sql`AND gc.id = ${category}`}
  `;
  const debut = Date.now() - DEBUT_DAYS * 86_400_000;
  const first = (row: (typeof rows)[number]) =>
    (row.first_published as Date | null)?.getTime() ?? null;
  const young = rows
    .filter((row) => (first(row) ?? 0) >= debut)
    .sort((a, b) => (first(b) ?? 0) - (first(a) ?? 0));
  const rest = rows
    .filter((row) => (first(row) ?? 0) < debut && row.rank > CHART_SHOWN)
    .sort((a, b) => a.rank - b.rank);
  return [...young, ...rest]
    .slice(0, limit)
    .map((row) => ({ ...podcast(row), firstPublished: first(row) }));
}

export async function related(
  podcastId: number,
  locale: string,
  limit: number,
): Promise<IPodcast[]> {
  const shared = await sql`
    SELECT p.id, p.itunes_id, p.title, p.feed_url, p.cover, p.thumbnail, p.explicit,
           p.episode_count, a.name AS author_name, ${genreColumns(sql)}
    FROM (
      SELECT other.podcast_id, count(*) AS listeners
      FROM subscriptions source
      JOIN subscriptions other ON other.user_id = source.user_id AND other.podcast_id <> source.podcast_id
      WHERE source.podcast_id = ${podcastId}
      GROUP BY other.podcast_id
      HAVING count(*) >= ${SHARED_LISTENERS}
    ) co
    JOIN podcasts p ON p.id = co.podcast_id
    JOIN authors a ON a.id = p.author_id
    ${genreJoin(sql, 'p')}
    WHERE p.owner_user_id IS NULL
    ORDER BY co.listeners DESC, p.id
    LIMIT ${limit}
  `;
  const chosen = [podcastId, ...shared.map((row) => Number(row.id))];
  const neighbours =
    shared.length >= limit
      ? []
      : await sql`
    SELECT p.id, p.itunes_id, p.title, p.feed_url, p.cover, p.thumbnail, p.explicit,
           p.episode_count, a.name AS author_name, ${genreColumns(sql)}
    FROM podcasts source
    JOIN genres sg ON sg.id = source.primary_genre_id
    JOIN top_podcasts tp ON tp.country_id = ${locale} AND tp.genre_id = 0
    JOIN podcasts p ON p.id = tp.podcast_id
    JOIN authors a ON a.id = p.author_id
    ${genreJoin(sql, 'p')}
    WHERE source.id = ${podcastId}
      AND p.owner_user_id IS NULL
      AND p.id <> ALL(${chosen}::bigint[])
      AND gc.id = CASE WHEN sg.parent_id = 26 THEN sg.id ELSE sg.parent_id END
    ORDER BY tp.rank
    LIMIT ${limit - shared.length}
  `;
  return [...shared, ...neighbours].map(podcast);
}
