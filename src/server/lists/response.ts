import type { ListSnapshot } from '@/shared/lists';
import { privateFeedHeaders as headers } from '../podcast-access';
import {
  isListId,
  LIST_BODY_LIMIT,
  LIST_PAGE_LIMIT,
  parseListBatch,
  parseListCursor,
} from './input';
import { type EpisodeListService, ListError } from './service';

async function readBatch(request: Request) {
  if (Number(request.headers.get('content-length')) > LIST_BODY_LIMIT)
    throw new ListError(413, 'List request too large');
  const reader = request.body?.getReader();
  if (!reader) throw new ListError(400, 'List changes required');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIST_BODY_LIMIT) {
        await reader.cancel();
        throw new ListError(413, 'List request too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const batch = parseListBatch(JSON.parse(text));
    if (!batch) throw new ListError(400, 'Invalid list changes');
    return batch;
  } catch (error) {
    if (error instanceof ListError) throw error;
    throw new ListError(400, 'Invalid list changes');
  } finally {
    reader.releaseLock();
  }
}

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
  const respond = async (operation: (userId: string) => Promise<unknown>) => {
    try {
      const userId = await authenticate();
      if (!userId) throw new ListError(401, 'Unauthorized');
      return Response.json(await operation(userId), { headers });
    } catch (error) {
      return Response.json(
        {
          message:
            error instanceof ListError ? error.message : 'Lists unavailable',
        },
        {
          status: error instanceof ListError ? error.status : 503,
          headers: {
            ...headers,
            ...(error instanceof ListError && error.status === 429
              ? { 'Retry-After': '60' }
              : {}),
          },
        },
      );
    }
  };
  const identify = (id: string) => {
    if (!isListId(id)) throw new ListError(400, 'Invalid list ID');
    return id.toLowerCase();
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
            throw new ListError(400, 'Invalid list query');
        }
        const view = params.get('view') ?? 'episodes';
        if (view === 'membership') {
          if (params.has('limit') || params.has('cursor'))
            throw new ListError(
              400,
              'Membership snapshots cannot be paginated',
            );
          return recover(userId, await service.membership(userId, listId));
        }
        if (view !== 'episodes') throw new ListError(400, 'Invalid list view');
        const limit = params.get('limit') ?? '100';
        if (!/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > LIST_PAGE_LIMIT)
          throw new ListError(400, 'Invalid list page size');
        const cursor = params.has('cursor')
          ? parseListCursor(params.get('cursor') ?? '', listId)
          : undefined;
        if (cursor === null) throw new ListError(400, 'Invalid list cursor');
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
        const listId = identify(id);
        const batch = await readBatch(request);
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
  };
}
