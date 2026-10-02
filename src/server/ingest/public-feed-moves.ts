import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { parseFeedEvidence } from '../../app/api/feed/parser';
import { publicAliasUrl, registerPublicAliases } from './feed-aliases';
import {
  PodcastAccessDenied,
  PodcastIdentityBusy,
  PodcastIdentityConflict,
} from './podcast-identity';
import { requestPublicFeed } from './public-feed-http';

export interface PublicMoveEvidence {
  requestedUrl: string;
  canonicalFeedUrl: string;
  aliases: string[];
  reference: string;
  details?: postgres.JSONValue;
}

type Verification =
  | { status: 'verified'; evidence: PublicMoveEvidence }
  | { status: 'unchanged' | 'verification_pending'; reason: string };

export async function verifyPublicFeedMove(
  input: string,
  request: (
    url: string,
    signal: AbortSignal,
  ) => ReturnType<typeof requestPublicFeed> = requestPublicFeed,
): Promise<Verification> {
  const requestedUrl = publicAliasUrl(input);
  const signal = AbortSignal.timeout(30_000);
  const seen = new Set<string>();
  const hops: { from: string; to: string; status: number }[] = [];
  let url = requestedUrl;
  for (let hop = 0; hop <= 5; hop++) {
    if (seen.has(url))
      return { status: 'verification_pending', reason: 'redirect_loop' };
    seen.add(url);
    const response = await request(url, signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location)
        return {
          status: 'verification_pending',
          reason: 'missing_redirect_location',
        };
      const target = publicAliasUrl(new URL(response.location, url).href);
      if (
        new URL(url).protocol === 'https:' &&
        new URL(target).protocol !== 'https:'
      )
        return { status: 'verification_pending', reason: 'insecure_redirect' };
      hops.push({ from: url, to: target, status: response.status });
      url = target;
      continue;
    }
    if (response.status !== 200)
      return { status: 'verification_pending', reason: 'upstream_unavailable' };
    const parsed = await parseFeedEvidence(response.body);
    if (!parsed.data || parsed.data.episodes.length === 0)
      return { status: 'verification_pending', reason: 'invalid_feed' };
    if (!hops.length)
      return {
        status: parsed.moveHints.length ? 'verification_pending' : 'unchanged',
        reason: parsed.moveHints.length
          ? 'publisher_hint_requires_review'
          : 'no_move',
      };
    if (hops.some((entry) => ![301, 308].includes(entry.status)))
      return { status: 'verification_pending', reason: 'temporary_redirect' };
    if (new URL(url).search)
      return {
        status: 'verification_pending',
        reason: 'delivery_parameters_require_review',
      };
    if (
      [...parsed.selfLinks, ...parsed.moveHints].some(
        (hint) => new URL(hint, url).href !== url,
      )
    )
      return {
        status: 'verification_pending',
        reason: 'conflicting_feed_hint',
      };
    const details = {
      hops,
      bodyHash: createHash('sha256').update(response.body).digest('hex'),
      verifiedAt: new Date().toISOString(),
      policy: 'public-permanent-v1',
    };
    const reference = createHash('sha256')
      .update(JSON.stringify(details))
      .digest('hex');
    return {
      status: 'verified',
      evidence: {
        requestedUrl,
        canonicalFeedUrl: url,
        aliases: [...seen],
        reference,
        details,
      },
    };
  }
  return { status: 'verification_pending', reason: 'redirect_limit' };
}

export async function resolvePublicFeedMove(
  sql: postgres.Sql,
  podcastId: number,
  verify = verifyPublicFeedMove,
) {
  const [source] =
    await sql`SELECT feed_url FROM podcasts WHERE id = ${podcastId} AND owner_user_id IS NULL`;
  if (!source) return { status: 'unavailable' as const };
  const result = await verify(source.feed_url);
  if (result.status !== 'verified') return result;
  if (result.evidence.requestedUrl !== source.feed_url)
    throw new PodcastIdentityConflict(
      'Move evidence identifies another source',
    );
  try {
    await registerPublicAliases(sql, {
      podcastId,
      expectedFeedUrl: source.feed_url,
      aliases: result.evidence.aliases,
      canonicalFeedUrl: result.evidence.canonicalFeedUrl,
      evidence: {
        type: 'permanent_redirect',
        reference: result.evidence.reference,
        details: result.evidence.details,
      },
    });
    return { status: 'resolved' as const, podcastId };
  } catch (error) {
    if (error instanceof PodcastIdentityBusy)
      return { status: 'verification_pending' as const, reason: 'source_busy' };
    if (error instanceof PodcastIdentityConflict)
      return { status: 'identity_conflict' as const };
    if (error instanceof PodcastAccessDenied)
      return { status: 'unavailable' as const };
    throw error;
  }
}
