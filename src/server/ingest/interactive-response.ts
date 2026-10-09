import { FEED_LIMITS } from '@/shared/feed-contract';
import { BodyError, readJsonBody } from '../http/json-body';
import { privateFeedHeaders as headers } from '../podcast-access';
import { StateError } from '../state/protocol';
import { FeedAdmissionError } from './feed-demand';
import { FeedUnavailableError } from './feed-errors';
import {
  PodcastAccessDenied,
  PodcastIdentityConflict,
} from './podcast-identity';

export async function readFeedBody(request: Request) {
  const body = await readJsonBody(
    request,
    FEED_LIMITS.bodyBytes,
    FEED_LIMITS.bodyTimeoutMs,
  );
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BodyError(400);
  return body as Record<string, unknown>;
}

export function feedError(error: unknown) {
  const status =
    error instanceof FeedAdmissionError
      ? error.code === 'rate_limited'
        ? 429
        : 503
      : error instanceof StateError || error instanceof BodyError
        ? error.status
        : error instanceof TypeError
          ? 400
          : error instanceof PodcastIdentityConflict
            ? 409
            : error instanceof PodcastAccessDenied ||
                error instanceof FeedUnavailableError
              ? 404
              : 503;
  const code =
    error instanceof StateError
      ? error.code
      : status === 429
        ? 'rate_limited'
        : status === 400
          ? 'invalid_request'
          : status === 413
            ? 'request_too_large'
            : status === 408
              ? 'request_timeout'
              : 'unavailable';
  return Response.json(
    { code, message: 'Feed unavailable' },
    {
      status,
      headers: {
        ...headers,
        ...([429, 503].includes(status)
          ? {
              'Retry-After': String(
                error instanceof FeedAdmissionError
                  ? error.retryAfterSeconds
                  : FEED_LIMITS.client.recheckSeconds,
              ),
            }
          : {}),
      },
    },
  );
}
