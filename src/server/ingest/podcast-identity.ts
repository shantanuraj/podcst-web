import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { isCanonicalId } from '@/shared/canonical-id';

export class PodcastIdentityConflict extends Error {}
export class PodcastAccessDenied extends Error {}
export class PodcastIdentityBusy extends Error {}

export interface AppleListingVerification {
  country: string;
  verifiedAt: string;
}

export function appleIdentities(sql: postgres.ISql, ids: readonly string[]) {
  return sql`
    SELECT id, itunes_id FROM podcasts
    WHERE itunes_id = ANY(${ids}::bigint[]) AND owner_user_id IS NULL
    UNION ALL
    SELECT p.id, alias.itunes_id FROM podcast_apple_aliases alias
    JOIN podcasts p ON p.id = alias.podcast_id
    WHERE alias.itunes_id = ANY(${ids}::bigint[]) AND p.owner_user_id IS NULL
  `;
}

export interface PodcastIdentity {
  id: string;
  itunes_id: string | number | null;
  podcast_index_id: string | number | null;
  feed_url: string;
  owner_user_id: string | null;
}

export async function lockPodcastIdentities(
  sql: postgres.ISql,
  identities: { feedUrl: string; itunesId?: string; podcastIndexId?: number }[],
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

export async function findPodcastIdentities(
  sql: postgres.ISql,
  feedUrl: string,
  itunesId?: string,
  podcastIndexId?: number,
  forUpdate = false,
): Promise<PodcastIdentity[]> {
  return sql<PodcastIdentity[]>`
    SELECT p.id, p.itunes_id, p.podcast_index_id, p.feed_url, p.owner_user_id FROM podcasts p
    WHERE p.id IN (
      ${locatorIds(sql, feedUrl)}
      UNION SELECT id FROM (${appleIdentities(sql, itunesId === undefined ? [] : [itunesId])}) apple
      UNION SELECT id FROM podcasts WHERE podcast_index_id = ${podcastIndexId ?? null}::integer
    )
    ORDER BY p.id
    ${forUpdate ? sql`FOR UPDATE OF p` : sql``}
  `;
}

export async function findPodcastIdentity(
  sql: postgres.ISql,
  feedUrl: string,
  itunesId?: string,
  podcastIndexId?: number,
  forUpdate = false,
): Promise<PodcastIdentity | undefined> {
  const matches = await findPodcastIdentities(
    sql,
    feedUrl,
    itunesId,
    podcastIndexId,
    forUpdate,
  );
  if (matches.length > 1)
    throw new PodcastIdentityConflict(
      'Feed and provider identify different podcasts',
    );
  return matches[0];
}

export async function claimPublicIdentity(
  sql: postgres.TransactionSql,
  podcast: PodcastIdentity,
  feedUrl: string,
  itunesId?: string,
  verification?: AppleListingVerification,
): Promise<string> {
  if (
    podcast.owner_user_id !== null &&
    (itunesId === undefined || podcast.feed_url !== feedUrl)
  ) {
    throw new PodcastAccessDenied('Feed unavailable');
  }
  if (itunesId !== undefined) {
    if (!isCanonicalId(itunesId))
      throw new PodcastIdentityConflict('Invalid public provider identity');
    if (podcast.itunes_id !== null && String(podcast.itunes_id) !== itunesId) {
      const [accepted] = await sql`
        SELECT podcast_id FROM podcast_apple_aliases WHERE itunes_id = ${itunesId}
      `;
      if (accepted) {
        if (String(accepted.podcast_id) !== podcast.id)
          throw new PodcastIdentityConflict(
            'Apple alias belongs to another source',
          );
        return podcast.id;
      }
      const verifiedAt = Date.parse(verification?.verifiedAt ?? '');
      const age = Date.now() - verifiedAt;
      if (
        !verification ||
        !/^[a-z]{2}$/.test(verification.country) ||
        !Number.isFinite(verifiedAt) ||
        age < 0 ||
        age > 10 * 60 * 1000
      )
        throw new PodcastIdentityConflict(
          'Fresh Apple listing verification required',
        );
      const [source] = await sql`
        SELECT p.id FROM podcasts p WHERE p.id = ${podcast.id}
          AND p.owner_user_id IS NULL AND ${locatorMatches(sql, feedUrl)}
        FOR UPDATE
      `;
      if (!source)
        throw new PodcastIdentityConflict(
          'Verified listing does not identify this public source',
        );
      const evidence = { feedUrl, ...verification };
      const reference = createHash('sha256')
        .update(JSON.stringify({ itunesId, ...evidence }))
        .digest('hex');
      await sql`
        INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference,evidence)
        VALUES (${itunesId},${podcast.id},'apple_lookup',${reference},${sql.json(evidence)})
        ON CONFLICT (itunes_id) DO NOTHING
      `;
      const [claimed] = await sql`
        SELECT podcast_id FROM podcast_apple_aliases WHERE itunes_id = ${itunesId}
      `;
      if (!claimed || String(claimed.podcast_id) !== podcast.id)
        throw new PodcastIdentityConflict(
          'Apple alias belongs to another source',
        );
      return podcast.id;
    }
    if (
      podcast.owner_user_id === null &&
      podcast.itunes_id !== null &&
      String(podcast.itunes_id) === itunesId
    )
      return podcast.id;
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
  return podcast.id;
}
