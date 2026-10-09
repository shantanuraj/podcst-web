import Ajv, { type ValidateFunction } from 'ajv';
import limits from '../../contracts/feeds/limits.json';
import schema from '../../contracts/feeds/schema.json';
import stateSchema from '../../contracts/state/schema.json';

export const FEED_LIMITS = limits;

export interface FeedFreshness {
  content: 'cached' | 'missing';
  state: 'fresh' | 'stale' | 'pending' | 'backoff' | 'unavailable';
  checkedAtMs: number | null;
  retryAtMs: number | null;
}

export function feedRecheckDelay(
  freshness: FeedFreshness | undefined,
  startedAt: number,
  now = Date.now(),
): number | false {
  if (!freshness || !['pending', 'backoff'].includes(freshness.state))
    return false;
  const remaining =
    FEED_LIMITS.client.pollWindowSeconds * 1000 - (now - startedAt);
  const delay = Math.max(
    FEED_LIMITS.client.recheckSeconds * 1000,
    (freshness.retryAtMs ?? now + FEED_LIMITS.client.recheckSeconds * 1000) -
      now,
  );
  return delay < remaining ? delay : false;
}

export function requireFreshness<T>(
  value: T,
): T & { freshness: FeedFreshness } {
  if (
    !value ||
    typeof value !== 'object' ||
    !('freshness' in value) ||
    !feedValidator('freshness')(value.freshness)
  )
    throw new TypeError('Invalid feed freshness');
  return value as T & { freshness: FeedFreshness };
}

export interface FeedRefreshRequest {
  podcastId: string;
}

export interface FeedRefreshResponse extends FeedRefreshRequest {
  freshness: FeedFreshness;
}

export type FeedResolutionItem = {
  index: number;
} & (
  | { status: 'resolved'; podcastId: string; retryAfterSeconds: null }
  | { status: 'retry'; podcastId: null; retryAfterSeconds: number }
  | { status: 'unavailable'; podcastId: null; retryAfterSeconds: null }
);

interface FeedShapes {
  freshness: FeedFreshness;
  refreshRequest: FeedRefreshRequest;
  refreshResponse: FeedRefreshResponse;
  resolutionItem: FeedResolutionItem;
}

const ajv = new Ajv({ strict: true });
ajv.addSchema(stateSchema);
ajv.addSchema(schema);

export function feedValidator<K extends keyof FeedShapes>(shape: K) {
  const validate = ajv.getSchema<FeedShapes[K]>(
    `${schema.$id}#/definitions/${shape}`,
  );
  if (!validate) throw new Error('Unknown feed schema');
  return validate as ValidateFunction<FeedShapes[K]>;
}
