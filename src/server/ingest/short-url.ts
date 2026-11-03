import type postgres from 'postgres';
import type { IShortUrl } from '@/types';
import { podcastAccess } from '../podcast-access';
import { prepareEpisodeRead } from './episode-read';
import { findPodcastIdentity } from './podcast-identity';

interface ShortUrlTarget {
  podcastId: string;
  episodeId: string | null;
}

export async function resolveShortUrl(
  sql: postgres.Sql,
  { feed, guid }: IShortUrl,
  prepare = prepareEpisodeRead,
): Promise<ShortUrlTarget | null> {
  const podcast = await findPodcastIdentity(sql, feed);
  if (!podcast) return null;

  // Retain access tracking and background repair at podcast scope. Short links
  // are public, so both preparation and the final read use anonymous access.
  if (!(await prepare(sql, podcast.id))) return null;

  const [target] = await sql<ShortUrlTarget[]>`
    SELECT p.id AS "podcastId", c.episode_id AS "episodeId"
    FROM podcasts p
    LEFT JOIN episodes e ON e.podcast_id = p.id AND e.guid = ${guid}
    LEFT JOIN episode_content c ON c.episode_id = e.id
    WHERE p.id = ${podcast.id} AND ${podcastAccess(sql)}
  `;
  // As with the episode list, an evicted content row falls back to the podcast.
  return target ?? null;
}
