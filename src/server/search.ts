import type postgres from 'postgres';
import type { IEpisodeInfo, IPodcastSearchResult } from '@/types';
import {
  appleIdentities,
  locatorMatches,
  PodcastIdentityConflict,
} from './ingest/podcast-identity';
import { podcastAccess } from './podcast-access';

export async function matchSearchResults(
  sql: postgres.ISql,
  results: IPodcastSearchResult[],
): Promise<IPodcastSearchResult[]> {
  const ids = results.flatMap((result) =>
    result.itunes_id === undefined ? [] : [result.itunes_id],
  );
  const rows = ids.length
    ? await sql`
        SELECT p.id, apple.itunes_id, p.feed_url FROM (${appleIdentities(sql, ids)}) apple
        JOIN podcasts p ON p.id = apple.id
      `
    : [];
  const byItunesId = new Map(rows.map((row) => [Number(row.itunes_id), row]));
  if (byItunesId.size !== rows.length)
    throw new PodcastIdentityConflict(
      'Apple identity identifies multiple sources',
    );
  const seen = new Set<string>();
  return results.flatMap((result) => {
    const existing = byItunesId.get(result.itunes_id ?? 0);
    const match = existing
      ? { ...result, id: Number(existing.id), feed: existing.feed_url }
      : result;
    if (seen.has(match.feed)) return [];
    seen.add(match.feed);
    return [match];
  });
}

export const prefixQuery = (term: string) =>
  term
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8)
    .map((word) => `${word}:*`)
    .join(' & ');

const EPISODE_CANDIDATES = 1000;

export async function searchEpisodes(
  sql: postgres.ISql,
  term: string,
  limit = 20,
): Promise<IEpisodeInfo[]> {
  const searchQuery = prefixQuery(term);
  if (!searchQuery) return [];
  const rows = await sql`
    WITH query AS (SELECT to_tsquery('english', ${searchQuery}) AS q),
    candidates AS (
      SELECT c.episode_id, c.title, c.summary, c.duration, c.episode_art,
             c.file_url, c.file_length, c.file_type,
             ts_rank_cd(to_tsvector('english', c.title), query.q) AS rank
      FROM episode_content c, query
      WHERE to_tsvector('english', c.title) @@ query.q
      LIMIT ${EPISODE_CANDIDATES}
    )
    SELECT candidates.*, e.guid, e.published, e.podcast_id,
           p.feed_url, p.title AS podcast_title, p.cover, p.explicit,
           a.name AS author
    FROM candidates
    JOIN episodes e ON e.id = candidates.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    JOIN authors a ON a.id = p.author_id
    WHERE p.owner_user_id IS NULL
    ORDER BY candidates.rank DESC, e.published DESC NULLS LAST
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    id: Number(row.episode_id),
    podcastId: Number(row.podcast_id),
    isPrivate: false,
    feed: row.feed_url,
    podcastTitle: row.podcast_title,
    guid: row.guid,
    title: row.title,
    summary: row.summary,
    showNotes: row.summary || '',
    published: row.published?.getTime() ?? null,
    duration: row.duration,
    cover: row.cover,
    episodeArt: row.episode_art,
    explicit: row.explicit,
    link: null,
    author: row.author,
    file: {
      url: row.file_url,
      length: Number(row.file_length) || 0,
      type: row.file_type || 'audio/mpeg',
    },
  }));
}

export async function searchPodcasts(
  sql: postgres.ISql,
  term: string,
  limit = 20,
): Promise<IPodcastSearchResult[]> {
  const searchQuery = prefixQuery(term);
  if (!searchQuery) return [];

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
    WHERE p.itunes_id IS NOT NULL AND p.owner_user_id IS NULL
      AND p.is_active = true
      AND to_tsvector('english', p.title || ' ' || COALESCE(p.description, ''))
          @@ to_tsquery('english', ${searchQuery})
    ORDER BY p.priority DESC NULLS LAST, p.popularity_score DESC NULLS LAST
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: Number(row.id),
    isPrivate: false,
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
  userId: string | null = null,
): Promise<IPodcastSearchResult | null> {
  const [row] = await sql`
    SELECT
      p.id,
      p.itunes_id,
      p.title,
      p.feed_url,
      p.thumbnail,
      p.cover,
      p.owner_user_id,
      a.name as author
    FROM podcasts p
    JOIN authors a ON a.id = p.author_id
    WHERE ${locatorMatches(sql, feedUrl)} AND ${podcastAccess(sql, userId)}
  `;

  if (!row) return null;

  return {
    id: Number(row.id),
    isPrivate: row.owner_user_id !== null,
    itunes_id: row.itunes_id === null ? undefined : Number(row.itunes_id),
    title: row.title,
    feed: row.feed_url,
    cover: row.cover,
    thumbnail: row.thumbnail || row.cover,
    author: row.author,
  };
}
