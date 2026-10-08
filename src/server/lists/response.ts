import type { ListSnapshot } from '@/shared/lists';
import { permitsMutation } from '../auth/request';
import { stateResponse } from '../state/http';
import { readStateBody, StateError } from '../state/protocol';
import {
  isListId,
  LIST_PAGE_LIMIT,
  parseListBatch,
  parseListCursor,
  parseListMigration,
} from './input';
import type { EpisodeListService } from './service';

export function createListHandlers(
  service: EpisodeListService,
  authenticate: () => Promise<string | null>,
  beforeChange?: (userId: string) => Promise<void>,
  scheduleRecovery?: (userId: string, listId: string) => void,
) {
  const recover = <T extends ListSnapshot>(userId: string, result: T) => {
    if (
      result.items.some(
        ({ availability }) => availability === 'content_missing',
      )
    )
      scheduleRecovery?.(userId, result.listId);
    return result;
  };
  const respond = (operation: (userId: string) => Promise<unknown>) =>
    stateResponse(async () => {
      const userId = await authenticate();
      if (!userId) throw new StateError('unauthenticated', 'Unauthorized');
      return operation(userId);
    });
  const identify = (id: string) => {
    if (!isListId(id))
      throw new StateError('invalid_request', 'Invalid list ID');
    return id.toLowerCase();
  };
  const mutation = (request: Request) => {
    if (!permitsMutation(request))
      throw new StateError('request_forbidden', 'Request not permitted');
  };
  const account = (userId: string, expected: string) => {
    if (userId !== expected)
      throw new StateError('account_mismatch', 'Account changed');
  };

  return {
    lists: () => respond((userId) => service.lists(userId)),
    items: (request: Request, id: string) =>
      respond(async (userId) => {
        const listId = identify(id);
        const params = new URL(request.url).searchParams;
        for (const key of params.keys()) {
          if (
            !['view', 'limit', 'cursor'].includes(key) ||
            params.getAll(key).length !== 1
          )
            throw new StateError('invalid_request', 'Invalid list query');
        }
        const view = params.get('view') ?? 'episodes';
        if (view === 'membership') {
          if (params.has('limit') || params.has('cursor'))
            throw new StateError(
              'invalid_request',
              'Membership snapshots cannot be paginated',
            );
          return recover(userId, await service.membership(userId, listId));
        }
        if (view !== 'episodes')
          throw new StateError('invalid_request', 'Invalid list view');
        const limit = params.get('limit') ?? '100';
        if (!/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > LIST_PAGE_LIMIT)
          throw new StateError('invalid_request', 'Invalid list page size');
        const cursor = params.has('cursor')
          ? parseListCursor(params.get('cursor') ?? '', listId)
          : undefined;
        if (cursor === null)
          throw new StateError('invalid_request', 'Invalid list cursor');
        return recover(
          userId,
          await service.episodes(userId, listId, {
            limit: Number(limit),
            cursor,
          }),
        );
      }),
    changes: (request: Request, id: string) =>
      respond(async (userId) => {
        mutation(request);
        const listId = identify(id);
        const batch = parseListBatch(await readStateBody(request));
        if (!batch)
          throw new StateError('invalid_request', 'Invalid list changes');
        account(userId, batch.accountId);
        await beforeChange?.(userId);
        const result = await service.change(userId, listId, batch);
        if (
          batch.changes.some(
            (change, index) =>
              change.op === 'add' &&
              result.results[index].status !== 'not_found',
          )
        )
          scheduleRecovery?.(userId, listId);
        return result;
      }),
    migration: (request: Request, id: string) =>
      respond(async (userId) => {
        mutation(request);
        const listId = identify(id);
        const input = parseListMigration(await readStateBody(request));
        if (!input)
          throw new StateError(
            'invalid_request',
            'Invalid legacy list changes',
          );
        account(userId, input.scope.accountId);
        await beforeChange?.(userId);
        const result = await service.migrate(
          userId,
          listId,
          input.scope,
          input.batch,
        );
        if (
          input.batch.changes.some(
            (change, index) =>
              change.op === 'add' &&
              result.results[index].status !== 'not_found',
          )
        )
          scheduleRecovery?.(userId, listId);
        return result;
      }),
  };
}
