import Ajv, { type ValidateFunction } from 'ajv';
import schema from '../../contracts/state/schema.json';

export interface StateScope {
  protocol: 1;
  accountId: string;
  generation: string;
}

export interface StateStream extends StateScope {
  clientId: string;
  sequence: string;
}

export interface ProgressChange {
  episodeId: string;
  positionSeconds: number;
  completed: boolean;
}

export interface FollowChange {
  podcastId: string;
  followed: boolean;
}

export interface ProgressBatch extends StateStream {
  changes: ProgressChange[];
}

export interface FollowBatch extends StateStream {
  changes: FollowChange[];
}

export type StateResult = 'applied' | 'unchanged' | 'not_found';

export interface ProgressAcknowledgement extends StateStream {
  revision: string;
  results: { episodeId: string; status: StateResult }[];
}

export interface FollowAcknowledgement extends StateStream {
  revision: string;
  results: { podcastId: string; status: StateResult }[];
}

export interface ProgressSnapshot extends StateScope {
  revision: string;
  items: {
    episodeId: string;
    progress: {
      positionSeconds: number;
      completed: boolean;
      revision: string;
      updatedAtMs: number | null;
    } | null;
  }[];
}

export interface FollowSnapshot extends StateScope {
  revision: string;
  items: {
    podcastId: string;
    revision: string;
    followedAtMs: number | null;
    availability: 'available' | 'unavailable';
  }[];
}

export const stateErrorStatus = {
  invalid_request: 400,
  unauthenticated: 401,
  request_forbidden: 403,
  account_mismatch: 409,
  sequence_conflict: 409,
  recovery_required: 409,
  update_required: 426,
  request_too_large: 413,
  request_timeout: 408,
  rate_limited: 429,
  unavailable: 503,
} as const;

export type StateErrorCode = keyof typeof stateErrorStatus;
export interface StateErrorBody {
  code: StateErrorCode;
  message: string;
}

interface StateShapes {
  id: string;
  revision: string;
  uuid: string;
  progressBatch: ProgressBatch;
  followBatch: FollowBatch;
  progressAcknowledgement: ProgressAcknowledgement;
  followAcknowledgement: FollowAcknowledgement;
  progressSnapshot: ProgressSnapshot;
  followSnapshot: FollowSnapshot;
  error: StateErrorBody;
}

const ajv = new Ajv({ strict: true, allErrors: false });
ajv.addSchema(schema);

export function stateValidator<K extends keyof StateShapes>(shape: K) {
  const validate = ajv.getSchema<StateShapes[K]>(
    `${schema.$id}#/definitions/${shape}`,
  );
  if (!validate) throw new Error('Unknown state schema');
  return validate as ValidateFunction<StateShapes[K]>;
}

export const STATE_BATCH_LIMIT =
  schema.definitions.progressBatch.properties.changes.maxItems;
export const STATE_READ_LIMIT =
  schema.definitions.progressSnapshot.properties.items.maxItems;
export const STATE_BODY_LIMIT = 64 * 1024;
