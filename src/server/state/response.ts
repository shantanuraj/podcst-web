import {
  type FollowAcknowledgement,
  type FollowBatch,
  type ProgressAcknowledgement,
  type ProgressBatch,
  stateValidator,
} from '@/shared/state-contract';
import { permitsMutation } from '../auth/request';
import { privateFeedHeaders as headers } from '../podcast-access';
import { readStateBatch, StateError } from './protocol';

export interface StateChanges {
  progress(
    accountId: string,
    batch: ProgressBatch,
  ): Promise<ProgressAcknowledgement>;
  follows(
    accountId: string,
    batch: FollowBatch,
  ): Promise<FollowAcknowledgement>;
}

export function createStateChangeHandlers(
  service: StateChanges,
  authenticate: () => Promise<string | null>,
  beforeChange: (accountId: string) => Promise<void>,
) {
  const change = async (request: Request, resource: 'progress' | 'follows') => {
    try {
      if (!permitsMutation(request))
        throw new StateError('request_forbidden', 'Request not permitted');
      const accountId = await authenticate();
      if (!accountId)
        throw new StateError('unauthenticated', 'Authentication required');
      const batch = await readStateBatch(request, resource);
      if (accountId !== batch.accountId)
        throw new StateError('account_mismatch', 'Account changed');
      await beforeChange(accountId);
      const result =
        resource === 'progress'
          ? await service.progress(accountId, batch as ProgressBatch)
          : await service.follows(accountId, batch as FollowBatch);
      const validate = stateValidator(
        resource === 'progress'
          ? 'progressAcknowledgement'
          : 'followAcknowledgement',
      );
      if (
        !validate(result) ||
        result.accountId !== batch.accountId ||
        result.generation !== batch.generation ||
        result.clientId !== batch.clientId ||
        result.sequence !== batch.sequence ||
        result.results.length !== batch.changes.length ||
        result.results.some((item, index) =>
          'episodeId' in item
            ? item.episodeId !==
              (batch as ProgressBatch).changes[index].episodeId
            : item.podcastId !==
              (batch as FollowBatch).changes[index].podcastId,
        )
      )
        throw new StateError('unavailable', 'State unavailable');
      return Response.json(result, { headers });
    } catch (error) {
      const failure =
        error instanceof StateError
          ? error
          : new StateError('unavailable', 'State unavailable');
      return Response.json(
        { code: failure.code, message: failure.message },
        {
          status: failure.status,
          headers: {
            ...headers,
            ...(failure.retryAfter
              ? { 'Retry-After': String(failure.retryAfter) }
              : {}),
          },
        },
      );
    }
  };
  return {
    progress: (request: Request) => change(request, 'progress'),
    follows: (request: Request) => change(request, 'follows'),
  };
}
