import type postgres from 'postgres';
import { isCanonicalId } from '@/shared/canonical-id';
import { feedUrl } from '../../shared/feed-url';
import {
  findPodcastIdentity,
  lockPodcastIdentities,
  PodcastAccessDenied,
  type PodcastIdentity,
  PodcastIdentityBusy,
  PodcastIdentityConflict,
} from './podcast-identity';

export interface PublicAliasClaim {
  podcastId: string;
  expectedFeedUrl: string;
  aliases: string[];
  canonicalFeedUrl?: string;
  evidence: {
    type: 'reviewed' | 'permanent_redirect';
    reference: string;
    details?: postgres.JSONValue;
  };
}

export function publicAliasUrl(input: string) {
  const value = feedUrl(input);
  if (new URL(value).hash || value.length > 2048)
    throw new TypeError('Unsupported alias locator');
  return value;
}

export async function claimPublicAliases(
  tx: postgres.TransactionSql,
  claim: PublicAliasClaim,
) {
  if (!isCanonicalId(claim.podcastId))
    throw new TypeError('Invalid podcast ID');
  if (
    !['reviewed', 'permanent_redirect'].includes(claim.evidence.type) ||
    !claim.evidence.reference.trim() ||
    claim.evidence.reference.length > 512
  )
    throw new TypeError('Alias evidence required');
  if (claim.aliases.length > 32) throw new TypeError('Too many aliases');
  const expected = publicAliasUrl(claim.expectedFeedUrl);
  const canonical = publicAliasUrl(claim.canonicalFeedUrl ?? expected);
  if (canonical !== expected) {
    const [lock] =
      await tx`SELECT pg_try_advisory_xact_lock(${claim.podcastId}::bigint) AS acquired`;
    if (!lock.acquired)
      throw new PodcastIdentityBusy('Source is refreshing; retry verification');
  }
  const locators = [
    ...new Set([expected, canonical, ...claim.aliases.map(publicAliasUrl)]),
  ];
  await lockPodcastIdentities(
    tx,
    locators.map((feedUrl) => ({ feedUrl })),
  );
  const [source] = await tx<PodcastIdentity[]>`
    SELECT id, feed_url, owner_user_id, itunes_id, podcast_index_id FROM podcasts WHERE id = ${claim.podcastId} FOR UPDATE
  `;
  if (!source || source.owner_user_id !== null)
    throw new PodcastAccessDenied('Public source unavailable');
  if (source.feed_url !== expected)
    throw new PodcastIdentityConflict(
      'Canonical source changed during verification',
    );
  for (const locator of locators) {
    const match = await findPodcastIdentity(tx, locator);
    if (match && String(match.id) !== claim.podcastId)
      throw new PodcastIdentityConflict(
        'Alias identifies another existing source',
      );
  }
  for (const locator of locators.filter((url) => url !== canonical)) {
    await tx`
      INSERT INTO podcast_feed_aliases (feed_url, podcast_id, evidence_type, evidence_reference, evidence)
      VALUES (${locator}, ${claim.podcastId}, ${claim.evidence.type}, ${claim.evidence.reference}, ${tx.json(claim.evidence.details ?? {})})
      ON CONFLICT (feed_url) DO NOTHING
    `;
  }
  if (canonical !== expected) {
    await tx`UPDATE podcasts SET feed_url = ${canonical}, updated_at = now() WHERE id = ${claim.podcastId}`;
    await tx`
      INSERT INTO feed_poll_state (podcast_id, next_poll_at, failures) VALUES (${claim.podcastId}, now(), 0)
      ON CONFLICT (podcast_id) DO NOTHING
    `;
  }
  await tx`DELETE FROM podcast_feed_aliases WHERE podcast_id = ${claim.podcastId} AND feed_url = ${canonical}`;
  return {
    podcastId: claim.podcastId,
    canonicalChanged: canonical !== expected,
  };
}

export function registerPublicAliases(
  sql: postgres.Sql,
  claim: PublicAliasClaim,
) {
  return sql.begin((tx) => claimPublicAliases(tx, claim));
}
