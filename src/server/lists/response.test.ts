import { describe, expect, mock, test } from 'bun:test';
import type { ListAcknowledgement, ListSnapshot } from '@/shared/lists';
import { encodeListCursor, LIST_BODY_LIMIT } from './input';
import { createListHandlers } from './response';
import { type EpisodeListService, ListError } from './service';

const id = '0c339753-cb50-477c-843e-e641b414a060';
const scope = {
  protocol: 1 as const,
  accountId: 'owner',
  generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
};
const batch = {
  ...scope,
  clientId: 'a7a2e014-b64f-4487-9c92-71cd59fc0cf7',
  sequence: '1',
  changes: [{ op: 'add', episodeId: '123' }],
};
const request = (query = '', body?: string) =>
  new Request(
    `https://example.invalid/api/lists/${id}/items${query}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
            'X-Podcst-Client': 'native',
          },
        },
  );
function fixture(user: string | null = 'owner') {
  const snapshot: ListSnapshot = {
    ...scope,
    listId: id,
    revision: '0',
    items: [],
  };
  const ack: ListAcknowledgement = {
    ...scope,
    clientId: batch.clientId,
    sequence: '1',
    listId: id,
    revision: '1',
    results: [{ episodeId: '123', status: 'applied' }],
  };
  const service = {
    lists: mock(async () => ({ ...scope, lists: [] })),
    membership: mock(async () => snapshot),
    episodes: mock(async () => ({ ...snapshot, items: [], nextCursor: null })),
    change: mock(async () => ack),
    migrate: mock(async () => ack),
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
  test('requires a session before validation or reads on all routes', async () => {
    const { handlers, service, limit } = fixture(null);
    for (const response of await Promise.all([
      handlers.lists(),
      handlers.items(request(), 'invalid'),
      handlers.changes(request('', '{}'), 'invalid'),
      handlers.migration(request('', '{}'), 'invalid'),
    ])) {
      expect(response.status).toBe(401);
      privateResponse(response);
    }
    for (const operation of Object.values(service))
      expect(operation).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });
  test('returns private scoped summaries and complete membership', async () => {
    const { handlers, service } = fixture();
    const lists = await handlers.lists();
    expect(await lists.json()).toEqual({ ...scope, lists: [] });
    privateResponse(lists);
    const snapshot = await handlers.items(
      request('?view=membership'),
      id.toUpperCase(),
    );
    expect(await snapshot.json()).toEqual({
      ...scope,
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
  ])('rejects malformed query %s', async (query) => {
    const { handlers, service } = fixture();
    const response = await handlers.items(request(query), id);
    expect(response.status).toBe(400);
    privateResponse(response);
    expect(service.membership).not.toHaveBeenCalled();
    expect(service.episodes).not.toHaveBeenCalled();
  });
  test('accepts bounded pages and exact list-bound cursors', async () => {
    const { handlers, service } = fixture();
    expect((await handlers.items(request(), id)).status).toBe(200);
    expect(service.episodes).toHaveBeenCalledWith('owner', id, {
      limit: 100,
      cursor: undefined,
    });
    const cursor = {
      listId: id,
      addedAt: 1770000000000,
      episodeId: '9007199254740993',
    };
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
  test('schedules missing-content recovery without waiting for feeds', async () => {
    const { service } = fixture();
    const recover = mock(() => {});
    const handlers = createListHandlers(
      service,
      async () => 'owner',
      undefined,
      recover,
    );
    service.membership.mockImplementation(async () => ({
      ...scope,
      listId: id,
      revision: '1',
      items: [
        { episodeId: '123', addedAt: 1, availability: 'content_missing' },
      ],
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
  test('rejects invalid list IDs on reads and writes', async () => {
    const { handlers } = fixture();
    expect((await handlers.items(request(), '12')).status).toBe(400);
    expect(
      (await handlers.changes(request('', JSON.stringify(batch)), '12')).status,
    ).toBe(400);
  });
  test.each([
    'null',
    '[]',
    'not json',
    JSON.stringify({ ...batch, changes: [{ op: 'toggle', episodeId: '123' }] }),
  ])('rejects malformed actions: %s', async (body) => {
    const { handlers, service } = fixture();
    const response = await handlers.changes(request('', body), id);
    expect(response.status).toBe(400);
    privateResponse(response);
    expect(service.change).not.toHaveBeenCalled();
  });
  test('fences account assertions, obsolete writers and cross-origin requests', async () => {
    const { handlers, service, limit } = fixture();
    const switched = await handlers.changes(
      request('', JSON.stringify({ ...batch, accountId: 'other' })),
      id,
    );
    expect(switched.status).toBe(409);
    expect((await switched.json()).code).toBe('account_mismatch');
    const obsolete = await handlers.changes(request('', '{}'), id);
    expect(obsolete.status).toBe(426);
    const foreign = request('', JSON.stringify(batch));
    foreign.headers.set('Origin', 'https://foreign.example.invalid');
    expect((await handlers.changes(foreign, id)).status).toBe(403);
    expect(limit).not.toHaveBeenCalled();
    expect(service.change).not.toHaveBeenCalled();
  });
  test('bounds body bytes without trusting Content-Length', async () => {
    const { handlers, service } = fixture();
    const response = await handlers.changes(
      request('', ' '.repeat(LIST_BODY_LIMIT + 1)),
      id,
    );
    expect(response.status).toBe(413);
    privateResponse(response);
    expect(service.change).not.toHaveBeenCalled();
  });
  test('passes validated canonical work and preserves numeric legacy batches separately', async () => {
    const { handlers, service, limit } = fixture();
    expect(
      (await handlers.changes(request('', JSON.stringify(batch)), id)).status,
    ).toBe(200);
    expect(service.change).toHaveBeenCalledWith('owner', id, batch);
    const legacy = {
      clientId: batch.clientId,
      sequence: '1',
      changes: [{ op: 'add', episodeId: 123 }],
    };
    expect(
      (
        await handlers.migration(
          request('', JSON.stringify({ ...scope, batch: legacy })),
          id,
        )
      ).status,
    ).toBe(200);
    expect(service.migrate).toHaveBeenCalledWith('owner', id, scope, legacy);
    expect(limit).toHaveBeenCalledTimes(2);
  });
  test.each([
    404, 409, 429,
  ])('keeps domain errors private: %s', async (status) => {
    const { service, handlers } = fixture();
    service.change.mockImplementation(async () => {
      throw new ListError(status, 'Synthetic refusal');
    });
    const response = await handlers.changes(
      request('', JSON.stringify(batch)),
      id,
    );
    expect(response.status).toBe(status);
    privateResponse(response);
    if (status === 429) expect(response.headers.get('Retry-After')).toBe('60');
  });
  test('hides storage/session failures behind a retryable private error', async () => {
    const { service, handlers } = fixture();
    service.lists.mockImplementation(async () => {
      throw new Error('private database detail');
    });
    const response = await handlers.lists();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'unavailable',
      message: 'State unavailable',
    });
    privateResponse(response);
    const broken = createListHandlers(service, async () => {
      throw new Error('private session detail');
    });
    expect((await broken.lists()).status).toBe(503);
  });
});
