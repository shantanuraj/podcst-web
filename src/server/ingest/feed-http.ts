import type { PublicResolver } from '../http/public-destination';
import { FeedUnavailableError } from './feed-errors';
import {
  type FeedResponse,
  type FeedValidators,
  feedConditions,
  feedDestination,
  requestFeed,
} from './feed-request';

export async function fetchFeedResponse(
  input: string,
  validators: FeedValidators = {},
  {
    resolve,
    maxBytes,
    timeoutMs = 30_000,
    signal: externalSignal,
    transport = requestFeed,
  }: {
    resolve?: PublicResolver;
    maxBytes?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    transport?: typeof requestFeed;
  } = {},
): Promise<FeedResponse & { redirected: boolean }> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, deadline])
    : deadline;
  signal.throwIfAborted();
  let url = feedDestination(input);
  let conditions = validators;
  for (let redirects = 0; ; redirects++) {
    const response = await transport(url.href, {
      signal,
      resolve,
      maxBytes,
      validators: conditions,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirects >= 5)
        throw new FeedUnavailableError('Feed redirect limit');
      let next: URL;
      try {
        next = feedDestination(new URL(response.location, url).href);
      } catch {
        throw new FeedUnavailableError('Unsafe feed redirect');
      }
      if (url.protocol === 'https:' && next.protocol !== 'https:')
        throw new FeedUnavailableError('Unsafe feed redirect downgrade');
      if (url.origin !== next.origin) conditions = {};
      url = next;
      continue;
    }
    if (
      response.status === 304 &&
      !Object.keys(feedConditions(conditions)).length
    )
      throw new Error('Unexpected feed HTTP 304');
    return { ...response, redirected: redirects > 0 };
  }
}
