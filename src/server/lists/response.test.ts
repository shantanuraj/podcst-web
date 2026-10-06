import { describe, expect, mock, test } from 'bun:test';
import type { ListSnapshot } from '@/shared/lists';
import { encodeListCursor, LIST_BODY_LIMIT } from './input';
import { createListHandlers } from './response';
import { type EpisodeListService, ListError } from './service';

const id = '0c339753-cb50-477c-843e-e641b414a060';
const batch = {
  clientId: 'a7a2e014-b64f-4487-9c92-71cd59fc0cf7',
  sequence: '1',
  changes: [{ op: 'add', episodeId: 123 }],
};
const request = (query = '', body?: string) =>
  new Request(
    `https://example.invalid/api/lists/${id}/items${query}`,
    body === undefined ? {} : { method: 'POST', body },
  );

function fixture(user: string | null = 'owner') {
  const snapshot: ListSnapshot = { listId: id, revision: '0', items: [] };
  const service = {
    lists: mock(async () => ({ lists: [] })),
    membership: mock(async () => snapshot),
    episodes: mock(async () => ({ ...snapshot, items: [], nextCursor: null })),
    change: mock(async () => ({
      clientId: batch.clientId,
      sequence: '1',
      listId: id,
      revision: '1',
      results: [{ episodeId: 123, status: 'applied' as const }],
    })),
  } satisfies EpisodeListService;
  const limit = mock(async () => {});
  return {
    service,
    limit,
    handlers: createListHandlers(service, async () => user, limit),
  };
}

function privateResponse(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('Vary')).toBe('Cookie');
}

describe('episode list HTTP handlers', () => {
  test('requires a session on every endpoint, before validation or reads', async () => {
    const { handlers, service, limit } = fixture(null);
    for (const response of await Promise.all([
      handlers.lists(),
      handlers.items(request(), 'invalid'),
      handlers.changes(request('', '{}'), 'invalid'),
    ])) {
      expect(response.status).toBe(401);
      privateResponse(response);
    }
    expect(service.lists).not.toHaveBeenCalled();
    expect(service.membership).not.toHaveBeenCalled();
    expect(service.episodes).not.toHaveBeenCalled();
    expect(service.change).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });

  test('returns private summaries and complete membership snapshots', async () => {
    const { handlers, service } = fixture();
    const lists = await handlers.lists();
    expect(await lists.json()).toEqual({ lists: [] });
    privateResponse(lists);
    const snapshot = await handlers.items(
      request('?view=membership'),
      id.toUpperCase(),
    );
    expect(await snapshot.json()).toEqual({
      listId: id,
      revision: '0',
      items: [],
    });
    expect(service.membership).toHaveBeenCalledWith('owner', id);
    privateResponse(snapshot);
  });

  test.each([
    '?view=membership&limit=100',
    '?view=membership&cursor=x',
    '?view=other',
    '?limit=0',
    '?limit=201',
    '?limit=-1',
    '?limit=1.5',
    '?limit=01',
    '?limit=foo',
    '?cursor=',
    '?cursor=invalid',
    '?limit=1&limit=2',
    '?offset=1',
    '?view=membership&view=episodes',
  ])('rejects malformed or misleading query %s', async (query) => {
    const { handlers, service } = fixture();
    const response = await handlers.items(request(query), id);
    expect(response.status).toBe(400);
    privateResponse(response);
    expect(service.membership).not.toHaveBeenCalled();
    expect(service.episodes).not.toHaveBeenCalled();
  });

  test('accepts bounded display pages and a list-bound cursor', async () => {
    const { handlers, service } = fixture();
    expect((await handlers.items(request(), id)).status).toBe(200);
    expect(service.episodes).toHaveBeenCalledWith('owner', id, {
      limit: 100,
      cursor: undefined,
    });
    const cursor = { listId: id, addedAt: 1770000000000, episodeId: 123 };
    expect(
      (
        await handlers.items(
          request(
            `?view=episodes&limit=200&cursor=${encodeListCursor(cursor)}`,
          ),
          id,
        )
      ).status,
    ).toBe(200);
    expect(service.episodes).toHaveBeenCalledWith('owner', id, {
      limit: 200,
      cursor,
    });
  });

  test('schedules missing-content recovery without fetching feeds in the response', async () => {
    const { service } = fixture();
    const recover = mock(() => {});
    const handlers = createListHandlers(
      service,
      async () => 'owner',
      undefined,
      recover,
    );
    service.membership.mockImplementation(async () => ({
      listId: id,
      revision: '1',
      items: [{ episodeId: 123, addedAt: 1, availability: 'content_missing' }],
    }));
    expect((await handlers.items(request('?view=membership'), id)).status).toBe(
      200,
    );
    expect(recover).toHaveBeenCalledWith('owner', id);
    expect(
      (await handlers.changes(request('', JSON.stringify(batch)), id)).status,
    ).toBe(200);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  test('rejects invalid list IDs', async () => {
    const { handlers } = fixture();
    expect((await handlers.items(request(), '12')).status).toBe(400);
    expect(
      (await handlers.changes(request('', JSON.stringify(batch)), '12')).status,
    ).toBe(400);
  });

  test.each([
    'null',
    '{}',
    '[]',
    'not json',
    JSON.stringify({ ...batch, changes: [{ op: 'toggle', episodeId: 123 }] }),
  ])('rejects invalid JSON or actions: %s', async (body) => {
    const { handlers, service } = fixture();
    const response = await handlers.changes(request('', body), id);
    expect(response.status).toBe(400);
    privateResponse(response);
    expect(service.change).not.toHaveBeenCalled();
  });

  test('limits body bytes without trusting Content-Length', async () => {
    const { handlers, service } = fixture();
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(LIST_BODY_LIMIT + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await handlers.changes(
      new Request('https://example.invalid', {
        method: 'POST',
        body,
        duplex: 'half',
      } as RequestInit),
      id,
    );
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    privateResponse(response);
    expect(service.change).not.toHaveBeenCalled();
  });

  test('passes only validated actions and the authenticated account to storage', async () => {
    const { handlers, service, limit } = fixture();
    const response = await handlers.changes(
      request('', JSON.stringify(batch)),
      id,
    );
    expect(response.status).toBe(200);
    privateResponse(response);
    expect(service.change).toHaveBeenCalledWith('owner', id, batch);
    expect(limit).toHaveBeenCalledWith('owner');
  });

  test.each([
    404, 409, 429,
  ])('keeps domain errors private: %s', async (status) => {
    const { handlers, service } = fixture();
    service.change.mockImplementation(async () => {
      throw new ListError(status, 'Unavailable');
    });
    const response = await handlers.changes(
      request('', JSON.stringify(batch)),
      id,
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ message: 'Unavailable' });
    privateResponse(response);
    if (status === 429) expect(response.headers.get('Retry-After')).toBe('60');
  });

  test('hides storage and session errors behind a retryable private response', async () => {
    const { service } = fixture();
    for (const authenticate of [
      async () => 'owner',
      async (): Promise<string | null> => {
        throw new Error('secret');
      },
    ]) {
      service.lists.mockImplementation(async () => {
        throw new Error('private SQL');
      });
      const response = await createListHandlers(service, authenticate).lists();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ message: 'Lists unavailable' });
      privateResponse(response);
    }
  });
});
