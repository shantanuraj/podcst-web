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
