import type postgres from 'postgres';
import type { IPodcastSearchResult } from '@/types';

export async function matchSearchResults(
  sql: postgres.ISql,
  results: IPodcastSearchResult[],
): Promise<IPodcastSearchResult[]> {
  const ids = results.flatMap((result) =>
    result.itunes_id === undefined ? [] : [result.itunes_id],
  );
  if (ids.length === 0) return results;
  const rows = await sql`
    SELECT id, itunes_id, feed_url FROM podcasts
    WHERE itunes_id = ANY(${ids}::bigint[])
  `;
  const byItunesId = new Map(rows.map((row) => [Number(row.itunes_id), row]));
  return results.map((result) => {
    const existing = byItunesId.get(result.itunes_id ?? 0);
    return existing
      ? { ...result, id: Number(existing.id), feed: existing.feed_url }
      : result;
  });
}

export async function searchPodcasts(
  sql: postgres.ISql,
  term: string,
  limit = 20,
): Promise<IPodcastSearchResult[]> {
  const searchQuery = term
    .trim()
    .split(/\s+/)
    .map((word) => word + ':*')
    .join(' & ');

  const rows = await sql`
    SELECT
      p.id,
      p.itunes_id,
      p.title,
      p.feed_url,
      p.thumbnail,
      p.cover,
      a.name as author
    FROM podcasts p
    JOIN authors a ON a.id = p.author_id
    WHERE p.itunes_id IS NOT NULL
      AND p.is_active = true
      AND to_tsvector('english', p.title || ' ' || COALESCE(p.description, ''))
          @@ to_tsquery('english', ${searchQuery})
    ORDER BY p.priority DESC NULLS LAST, p.popularity_score DESC NULLS LAST
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: Number(row.id),
    itunes_id: Number(row.itunes_id),
    title: row.title,
    feed: row.feed_url,
    cover: row.cover,
    thumbnail: row.thumbnail || row.cover,
    author: row.author,
  }));
}

export async function searchPodcastsByFeedUrl(
  sql: postgres.ISql,
  feedUrl: string,
): Promise<IPodcastSearchResult | null> {
  const [row] = await sql`
    SELECT
      p.id,
      p.itunes_id,
      p.title,
      p.feed_url,
      p.thumbnail,
      p.cover,
      a.name as author
    FROM podcasts p
    JOIN authors a ON a.id = p.author_id
    WHERE p.feed_url = ${feedUrl}
  `;

  if (!row) return null;

  return {
    id: Number(row.id),
    itunes_id: row.itunes_id === null ? undefined : Number(row.itunes_id),
    title: row.title,
    feed: row.feed_url,
    cover: row.cover,
    thumbnail: row.thumbnail || row.cover,
    author: row.author,
  };
}
