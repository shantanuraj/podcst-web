import { isCanonicalId, migrateStoredId } from '@/shared/canonical-id';
import { ITUNES_API } from '../../data/constants';
import { feedUrl } from '../../shared/feed-url';
import { readJsonBody } from '../http/json-body';
import { MAX_FEED_BYTES } from './feed-limits';
import {
  type AppleListingVerification,
  PodcastIdentityConflict,
} from './podcast-identity';

export interface AppleListing extends AppleListingVerification {
  itunesId: string;
  feedUrl: string;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function appleFeedForId(
  results: unknown[],
  itunesId: string,
): string | null {
  const feeds = new Set<string | null>();
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const row = result as {
      kind?: unknown;
      collectionId?: unknown;
      feedUrl?: unknown;
    };
    const identity = migrateStoredId(row.collectionId);
    if (
      row.kind !== 'podcast' ||
      !('canonicalId' in identity) ||
      identity.canonicalId !== itunesId
    )
      continue;
    if (row.feedUrl === undefined || row.feedUrl === null || row.feedUrl === '')
      feeds.add(null);
    else if (typeof row.feedUrl === 'string') {
      try {
        feeds.add(feedUrl(row.feedUrl));
      } catch {
        throw new PodcastIdentityConflict(
          `Apple returned invalid feed metadata for podcast ${itunesId}`,
        );
      }
    } else
      throw new PodcastIdentityConflict(
        `Apple returned invalid feed metadata for podcast ${itunesId}`,
      );
  }
  if (feeds.size > 1)
    throw new PodcastIdentityConflict(
      `Apple returned ambiguous feed associations for podcast ${itunesId}`,
    );
  return feeds.values().next().value ?? null;
}

export function assertFreshAppleListing(listing: AppleListing) {
  const age = Date.now() - Date.parse(listing.verifiedAt);
  if (
    !isCanonicalId(listing.itunesId) ||
    !/^[a-z]{2}$/.test(listing.country) ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 10 * 60 * 1000
  )
    throw new PodcastIdentityConflict(
      'Fresh Apple listing verification required',
    );
  try {
    if (feedUrl(listing.feedUrl) !== listing.feedUrl)
      throw new Error('Inexact locator');
  } catch {
    throw new PodcastIdentityConflict('Invalid verified Apple feed locator');
  }
}

export async function lookupAppleListing(
  itunesId: string,
  country: string,
  request: Fetch = fetch,
  callerSignal?: AbortSignal,
): Promise<AppleListing | null> {
  if (!isCanonicalId(itunesId))
    throw new TypeError('itunes_id must be a positive integer');
  if (!/^[a-z]{2}$/.test(country))
    throw new TypeError('Invalid Apple storefront');
  const url = new URL('/lookup', ITUNES_API);
  url.search = new URLSearchParams({
    id: String(itunesId),
    entity: 'podcast',
    country,
  }).toString();
  const deadline = AbortSignal.timeout(30_000);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, deadline])
    : deadline;
  signal.throwIfAborted();
  const response = await request(url.href, { signal, redirect: 'error' });
  if (!response.ok) throw new Error('Apple lookup unavailable');
  const data = await readJsonBody(
    { body: response.body, headers: response.headers, signal },
    MAX_FEED_BYTES,
    30_000,
  );
  if (
    !data ||
    typeof data !== 'object' ||
    !('results' in data) ||
    !Array.isArray(data.results)
  )
    throw new Error('Apple returned an invalid lookup response');
  signal.throwIfAborted();
  const feed = appleFeedForId(data.results, itunesId);
  return feed
    ? { itunesId, feedUrl: feed, country, verifiedAt: new Date().toISOString() }
    : null;
}
