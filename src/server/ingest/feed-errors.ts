export const FEED_ERROR_KINDS = [
  'http_client',
  'http_auth',
  'http_gone',
  'http_rate_limit',
  'http_server',
  'network',
  'timeout',
  'redirect',
  'too_large',
  'invalid_feed',
] as const;

export type FeedErrorKind = (typeof FEED_ERROR_KINDS)[number];

export interface FeedFailure {
  kind: FeedErrorKind;
  status: number | null;
  retryAfterSeconds: number | null;
}

export class FeedFetchError extends Error {
  constructor(
    message: string,
    public readonly kind: FeedErrorKind,
    public readonly status: number | null = null,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

export class FeedUnavailableError extends FeedFetchError {
  constructor(
    message: string,
    kind: FeedErrorKind = 'invalid_feed',
    status: number | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message, kind, status, retryAfterSeconds);
  }
}

export const TRANSIENT_FEED_ERROR_KINDS = new Set<FeedErrorKind>([
  'network',
  'timeout',
  'http_server',
  'http_rate_limit',
  'redirect',
]);

export function isTransientFeedError(kind: FeedErrorKind) {
  return TRANSIENT_FEED_ERROR_KINDS.has(kind);
}

export function classifyFeedError(error: unknown): FeedFailure {
  if (error instanceof FeedFetchError) {
    return {
      kind: error.kind,
      status: error.status,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  if (
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return { kind: 'timeout', status: null, retryAfterSeconds: null };
  }
  if (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return { kind: 'timeout', status: null, retryAfterSeconds: null };
  }
  return { kind: 'network', status: null, retryAfterSeconds: null };
}
