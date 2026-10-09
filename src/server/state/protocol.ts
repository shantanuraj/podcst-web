import { createHash } from 'node:crypto';
import {
  type FollowBatch,
  type ProgressBatch,
  STATE_BODY_LIMIT,
  type StateErrorCode,
  type StateScope,
  stateErrorStatus,
  stateValidator,
} from '@/shared/state-contract';
import { BodyError, readJsonBody } from '../http/json-body';

export class StateError extends Error {
  constructor(
    readonly code: StateErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }

  get status() {
    return stateErrorStatus[this.code];
  }
}

export function stateRequestHash(
  resource: 'progress' | 'follows',
  batch: ProgressBatch | FollowBatch,
) {
  const changes =
    resource === 'progress'
      ? (batch as ProgressBatch).changes.map(
          ({ episodeId, positionSeconds, completed }) => ({
            episodeId,
            positionSeconds,
            completed,
          }),
        )
      : (batch as FollowBatch).changes.map(({ podcastId, followed }) => ({
          podcastId,
          followed,
        }));
  return createHash('sha256')
    .update(
      JSON.stringify({
        protocol: batch.protocol,
        resource,
        accountId: batch.accountId,
        generation: batch.generation,
        clientId: batch.clientId,
        sequence: batch.sequence,
        changes,
      }),
    )
    .digest('hex');
}

export function assertStateScope(
  accountId: string,
  generation: string,
  batch: Pick<StateScope, 'accountId' | 'generation'>,
) {
  if (batch.accountId !== accountId)
    throw new StateError('account_mismatch', 'Account changed');
  if (batch.generation !== generation)
    throw new StateError('recovery_required', 'State reconciliation required');
}

export function stateReplay(
  sequence: string,
  hash: string,
  previous: { sequence: string; hash: string | null },
) {
  if (sequence === previous.sequence && hash === previous.hash) return true;
  if (BigInt(sequence) !== BigInt(previous.sequence) + 1n)
    throw new StateError('sequence_conflict', 'State stream is blocked');
  return false;
}

export async function readStateBody(request: Request, timeoutMs = 5000) {
  try {
    const body = await readJsonBody(request, STATE_BODY_LIMIT, timeoutMs);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new StateError('invalid_request', 'Invalid state changes');
    if (!('protocol' in body) || body.protocol !== 1)
      throw new StateError('update_required', 'State protocol update required');
    return body;
  } catch (error) {
    if (error instanceof StateError) throw error;
    if (error instanceof BodyError && error.status === 413)
      throw new StateError('request_too_large', 'State request too large');
    if (error instanceof BodyError && error.status === 408)
      throw new StateError('request_timeout', 'State request timed out');
    throw new StateError('invalid_request', 'Invalid state changes');
  }
}

export async function readStateBatch(
  request: Request,
  resource: 'progress' | 'follows',
  timeoutMs = 5000,
) {
  const body = await readStateBody(request, timeoutMs);
  const validate = stateValidator(
    resource === 'progress' ? 'progressBatch' : 'followBatch',
  );
  if (!validate(body))
    throw new StateError('invalid_request', 'Invalid state changes');
  return body;
}
