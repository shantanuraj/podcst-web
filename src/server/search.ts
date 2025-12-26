import { sql } from './db';
import type { IPodcastSearchResult } from '@/types';

export async function searchPodcasts(
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
    id: row.id,
    title: row.title,
    feed: row.feed_url,
    thumbnail: row.thumbnail || row.cover,
    author: row.author,
  }));
}

export async function searchPodcastsByFeedUrl(
  feedUrl: string,
): Promise<IPodcastSearchResult | null> {
  const [row] = await sql`
    SELECT
      p.id,
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
    id: row.id,
    title: row.title,
    feed: row.feed_url,
    thumbnail: row.thumbnail || row.cover,
    author: row.author,
  };
}
