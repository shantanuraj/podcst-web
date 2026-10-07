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

export async function readStateBatch(
  request: Request,
  resource: 'progress' | 'follows',
  timeoutMs = 5000,
) {
  if (Number(request.headers.get('content-length')) > STATE_BODY_LIMIT)
    throw new StateError('request_too_large', 'State request too large');
  const reader = request.body?.getReader();
  if (!reader)
    throw new StateError('invalid_request', 'State changes required');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new StateError('request_timeout', 'State request timed out'));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > STATE_BODY_LIMIT) {
        void reader.cancel().catch(() => {});
        throw new StateError('request_too_large', 'State request too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    const body: unknown = JSON.parse(text + decoder.decode());
    if (
      body &&
      typeof body === 'object' &&
      'protocol' in body &&
      body.protocol !== 1
    )
      throw new StateError('update_required', 'State protocol update required');
    const validate = stateValidator(
      resource === 'progress' ? 'progressBatch' : 'followBatch',
    );
    if (!validate(body))
      throw new StateError('invalid_request', 'Invalid state changes');
    return body;
  } catch (error) {
    if (error instanceof StateError) throw error;
    throw new StateError('invalid_request', 'Invalid state changes');
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
