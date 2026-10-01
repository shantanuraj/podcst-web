import type postgres from 'postgres';
import { upsertEpisodes } from './episodes';
import { fetchFeed, savePollState } from './feed-refresh';
import { getPollInterval } from './feed-schedule';

export class PodcastIdentityConflict extends Error {}
export class PodcastAccessDenied extends Error {}

export interface PodcastIdentity {
  id: string | number;
  itunes_id: string | number | null;
  feed_url: string;
  owner_user_id: string | null;
}

export async function lockPodcastIdentities(
  sql: postgres.ISql,
  identities: { feedUrl: string; itunesId?: number }[],
) {
  const keys = identities.flatMap(({ feedUrl, itunesId }) => [
    { namespace: 'podcast:feed', value: feedUrl },
    ...(itunesId === undefined
      ? []
      : [{ namespace: 'podcast:itunes', value: String(itunesId) }]),
  ]);
  await sql`
    SELECT pg_advisory_xact_lock(namespace, identity) FROM (
      SELECT DISTINCT hashtext(key->>'namespace') AS namespace,
        hashtext(key->>'value') AS identity
      FROM jsonb_array_elements(${sql.json(keys)}::jsonb) AS key
      ORDER BY namespace, identity
    ) claims
  `;
}

export async function findPodcastIdentity(
  sql: postgres.ISql,
  feedUrl: string,
  itunesId?: number,
): Promise<PodcastIdentity | undefined> {
  const matches = await sql<PodcastIdentity[]>`
    SELECT id, itunes_id, feed_url, owner_user_id FROM podcasts
    WHERE feed_url = ${feedUrl} OR itunes_id = ${itunesId ?? null}::bigint
  `;
  if (matches.length > 1) {
    throw new PodcastIdentityConflict(
      'Feed and provider identify different podcasts',
    );
  }
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
    if (podcast.itunes_id !== null && Number(podcast.itunes_id) !== itunesId) {
      throw new PodcastIdentityConflict('Feed belongs to another Apple ID');
    }
    if (
      podcast.owner_user_id === null &&
      podcast.itunes_id !== null &&
      Number(podcast.itunes_id) === itunesId
    )
      return Number(podcast.id);
    const [claimed] = await sql`
      UPDATE podcasts SET itunes_id = ${itunesId}, owner_user_id = NULL, updated_at = now()
      WHERE id = ${podcast.id} AND feed_url = ${feedUrl}
        AND (itunes_id IS NULL OR itunes_id = ${itunesId})
      RETURNING id
    `;
    if (!claimed)
      throw new PodcastIdentityConflict(
        'Source changed during public verification',
      );
  }
  return Number(podcast.id);
}

function authorizePrivate(podcast: PodcastIdentity, userId: string) {
  if (podcast.owner_user_id !== null && podcast.owner_user_id !== userId) {
    throw new PodcastAccessDenied('Feed unavailable');
  }
  return Number(podcast.id);
}

async function index(
  sql: postgres.Sql,
  feedUrl: string,
  ownerUserId: string | null,
  itunesId?: number,
): Promise<number> {
  const existing = await findPodcastIdentity(sql, feedUrl, itunesId);
  if (existing && ownerUserId) return authorizePrivate(existing, ownerUserId);
  if (existing?.owner_user_id && itunesId === undefined)
    throw new PodcastAccessDenied('Feed unavailable');
  const fetched = existing
    ? null
    : await fetchFeed(feedUrl, undefined, ownerUserId !== null);
  if (fetched && fetched.status !== 'updated')
    throw new Error('Feed was not returned');

  return sql.begin(async (tx) => {
    await lockPodcastIdentities(tx, [{ feedUrl, itunesId }]);
    const found = await findPodcastIdentity(tx, feedUrl, itunesId);
    if (found)
      return ownerUserId
        ? authorizePrivate(found, ownerUserId)
        : claimPublicIdentity(tx, found, feedUrl, itunesId);
    if (fetched?.status !== 'updated')
      throw new Error('Feed changed during import; retry');
    const { data } = fetched;
    const authorName = data.author || 'Unknown';
    let [author] =
      await tx`SELECT id FROM authors WHERE name = ${authorName} LIMIT 1`;
    if (!author)
      [author] =
        await tx`INSERT INTO authors (name) VALUES (${authorName}) RETURNING id`;
    const [podcast] = await tx<PodcastIdentity[]>`
      INSERT INTO podcasts (
        itunes_id, owner_user_id, feed_url, title, author_id, description, cover,
        website_url, explicit, episode_count, last_published
      ) VALUES (
        ${itunesId ?? null}, ${ownerUserId}, ${feedUrl}, ${data.title}, ${author.id},
        ${data.description}, ${data.cover}, ${data.link}, ${data.explicit},
        ${data.episodes.length}, ${data.published ? new Date(data.published) : null}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, itunes_id, feed_url, owner_user_id
    `;
    if (!podcast) {
      const winner = await findPodcastIdentity(tx, feedUrl, itunesId);
      if (!winner)
        throw new PodcastIdentityConflict('Unable to resolve podcast identity');
      return ownerUserId
        ? authorizePrivate(winner, ownerUserId)
        : claimPublicIdentity(tx, winner, feedUrl, itunesId);
    }
    const id = Number(podcast.id);
    await upsertEpisodes(tx, id, data.cover, data.episodes);
    await savePollState(tx, id, fetched, getPollInterval(null));
    return id;
  });
}

export function indexPodcast(
  sql: postgres.Sql,
  feedUrl: string,
  itunesId?: number,
) {
  return index(sql, feedUrl, null, itunesId);
}

export function indexPrivatePodcast(
  sql: postgres.Sql,
  feedUrl: string,
  userId: string,
) {
  if (!userId) throw new PodcastAccessDenied('Sign in to import a feed');
  return index(sql, feedUrl, userId);
}
