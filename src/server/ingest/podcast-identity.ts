import type postgres from 'postgres';

export class PodcastIdentityConflict extends Error {}
export class PodcastAccessDenied extends Error {}
export class PodcastIdentityBusy extends Error {}

export interface PodcastIdentity {
  id: string | number;
  itunes_id: string | number | null;
  podcast_index_id: string | number | null;
  feed_url: string;
  owner_user_id: string | null;
}

export async function lockPodcastIdentities(
  sql: postgres.ISql,
  identities: { feedUrl: string; itunesId?: number; podcastIndexId?: number }[],
) {
  const keys = identities.flatMap(({ feedUrl, itunesId, podcastIndexId }) => [
    { namespace: 'podcast:feed', value: feedUrl },
    ...(itunesId === undefined
      ? []
      : [{ namespace: 'podcast:itunes', value: String(itunesId) }]),
    ...(podcastIndexId === undefined
      ? []
      : [{ namespace: 'podcast:index', value: String(podcastIndexId) }]),
  ]);
  await sql`
    SELECT pg_advisory_xact_lock(namespace, identity) FROM (
      SELECT DISTINCT hashtext(key->>'namespace') AS namespace, hashtext(key->>'value') AS identity
      FROM jsonb_array_elements(${sql.json(keys)}::jsonb) AS key
      ORDER BY namespace, identity
    ) claims
  `;
}

function locatorIds(sql: postgres.ISql, feedUrl: string) {
  return sql`
    SELECT id FROM podcasts WHERE feed_url = ${feedUrl}
    UNION
    SELECT alias.podcast_id FROM podcast_feed_aliases alias
    JOIN podcasts source ON source.id = alias.podcast_id
    WHERE alias.feed_url = ${feedUrl} AND source.owner_user_id IS NULL
  `;
}

export function locatorMatches(sql: postgres.ISql, feedUrl: string) {
  return sql`p.id IN (${locatorIds(sql, feedUrl)})`;
}

export async function findPodcastIdentity(
  sql: postgres.ISql,
  feedUrl: string,
  itunesId?: number,
  podcastIndexId?: number,
  forUpdate = false,
): Promise<PodcastIdentity | undefined> {
  const matches = await sql<PodcastIdentity[]>`
    SELECT p.id, p.itunes_id, p.podcast_index_id, p.feed_url, p.owner_user_id FROM podcasts p
    WHERE p.id IN (
      ${locatorIds(sql, feedUrl)}
      UNION SELECT id FROM podcasts WHERE itunes_id = ${itunesId ?? null}::bigint
      UNION SELECT id FROM podcasts WHERE podcast_index_id = ${podcastIndexId ?? null}::integer
    )
    ORDER BY p.id
    ${forUpdate ? sql`FOR UPDATE OF p` : sql``}
  `;
  if (matches.length > 1)
    throw new PodcastIdentityConflict(
      'Feed and provider identify different podcasts',
    );
  return matches[0];
}

export async function claimPublicIdentity(
  sql: postgres.ISql,
  podcast: PodcastIdentity,
  feedUrl: string,
  itunesId?: number,
): Promise<number> {
  if (
    podcast.owner_user_id !== null &&
    (itunesId === undefined || podcast.feed_url !== feedUrl)
  ) {
    throw new PodcastAccessDenied('Feed unavailable');
  }
  if (itunesId !== undefined) {
    if (!Number.isSafeInteger(itunesId) || itunesId <= 0)
      throw new PodcastIdentityConflict('Invalid public provider identity');
    if (podcast.itunes_id !== null && Number(podcast.itunes_id) !== itunesId)
      throw new PodcastIdentityConflict('Feed belongs to another Apple ID');
    if (
      podcast.owner_user_id === null &&
      podcast.itunes_id !== null &&
      Number(podcast.itunes_id) === itunesId
    )
      return Number(podcast.id);
    const [claimed] = await sql`
      UPDATE podcasts p SET itunes_id = ${itunesId}, owner_user_id = NULL, updated_at = now()
      WHERE p.id = ${podcast.id} AND ${locatorMatches(sql, feedUrl)}
        AND (p.owner_user_id IS NULL OR p.feed_url = ${feedUrl})
        AND (p.itunes_id IS NULL OR p.itunes_id = ${itunesId})
      RETURNING p.id
    `;
    if (!claimed)
      throw new PodcastIdentityConflict(
        'Source changed during public verification',
      );
  }
  return Number(podcast.id);
}
