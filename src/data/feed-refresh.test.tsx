import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { AccountSession } from '@/shared/auth/account-session';
import { type FeedFreshness, feedRecheckDelay } from '@/shared/feed-contract';
import { ApiError } from './api';
import { feedRefreshOptions } from './feed-refresh';

const clients: QueryClient[] = [];
const spies: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>[] = [];
const fresh: FeedFreshness = {
  content: 'cached',
  state: 'fresh',
  checkedAtMs: 1000,
  retryAtMs: null,
};
const pending: FeedFreshness = {
  content: 'missing',
  state: 'pending',
  checkedAtMs: null,
  retryAtMs: 5000,
};
function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const session = new AccountSession(client, null, {
    resetPlayer() {},
    reload() {},
    publish() {},
    readSession: async () => null,
  });
  const refresh = mock();
  return {
    client,
    session,
    refresh,
    options: feedRefreshOptions(session, '1', refresh),
  };
}
function respond(body: unknown, status = 200) {
  const spy = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json(body, { status }),
  );
  spies.push(spy);
  return spy;
}
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  for (const client of clients.splice(0)) client.clear();
});

test('fresh admission preserves cached episodes and does not replay on observer mount', async () => {
  const spy = respond({ podcastId: '1', freshness: fresh });
  const { client, refresh, options } = fixture();
  const key = ['account', null, 'episodes', '1'];
  client.setQueryData(key, { retained: true });
  expect((await client.fetchQuery(options)).freshness).toEqual(fresh);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  await client.fetchQuery(options);
  unsubscribe();
  expect(spy).toHaveBeenCalledTimes(1);
  expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({
    podcastId: '1',
  });
  expect(refresh).not.toHaveBeenCalled();
  expect(client.getQueryData<{ retained: boolean }>(key)).toEqual({
    retained: true,
  });
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
});

test('202 is accepted demand, then rechecks use GET and reconcile changed content once', async () => {
  const spy = respond({ podcastId: '1', freshness: pending }, 202);
  const { client, options, refresh } = fixture();
  const own = ['account', null, 'episodes', '1'];
  const other = ['account', 'other', 'episodes', '1'];
  client.setQueryData(own, { retained: true });
  client.setQueryData(other, { retained: true });
  expect((await client.fetchQuery(options)).freshness).toEqual(pending);
  expect(refresh).not.toHaveBeenCalled();
  spy.mockImplementation(
    Object.assign(
      async () =>
        Response.json({
          episodes: [],
          total: 0,
          hasMore: false,
          freshness: fresh,
        }),
      { preconnect() {} },
    ),
  );
  expect(
    (await client.fetchQuery({ ...options, staleTime: 0 })).freshness,
  ).toEqual(fresh);
  expect(String(spy.mock.calls[1][0])).toContain('/api/feed/episodes?');
  expect(spy.mock.calls[1][1]?.method).toBeUndefined();
  expect(client.getQueryState(own)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  expect(refresh).toHaveBeenCalledTimes(1);
  await client.fetchQuery({ ...options, staleTime: 0 });
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('failed admission retains content and never invents pending or repeats POST automatically', async () => {
  respond({ code: 'unavailable', message: 'Feed unavailable' }, 503);
  const { client, options, refresh } = fixture();
  const key = ['account', null, 'episodes', '1'];
  client.setQueryData(key, { retained: true });
  await expect(client.fetchQuery(options)).rejects.toBeInstanceOf(ApiError);
  expect(options.retry).toBe(false);
  expect(client.getQueryData(options.queryKey)).toBeUndefined();
  expect(client.getQueryData<{ retained: boolean }>(key)).toEqual({
    retained: true,
  });
  expect(refresh).not.toHaveBeenCalled();
});

test('recheck advice is honored and a two-minute window never restarts from newer advice', () => {
  expect(feedRecheckDelay(pending, 0, 0)).toBe(5000);
  expect(feedRecheckDelay(fresh, 0, 0)).toBe(false);
  expect(feedRecheckDelay({ ...pending, retryAtMs: 120000 }, 0, 115000)).toBe(
    false,
  );
  expect(
    feedRecheckDelay({ ...pending, state: 'backoff', retryAtMs: 900000 }, 0, 0),
  ).toBe(false);
  expect(feedRecheckDelay(pending, 0, 120000)).toBe(false);
});

test('a retired request cannot refresh the route even when transport ignores cancellation', async () => {
  const gate = Promise.withResolvers<Response>();
  const spy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(async () => gate.promise, { preconnect() {} }),
  );
  spies.push(spy);
  const { client, session, refresh, options } = fixture();
  const work = client.fetchQuery(options).catch((error) => error);
  session.beginAuthChange();
  gate.resolve(Response.json({ podcastId: '1', freshness: fresh }));
  expect(await work).toBeInstanceOf(Error);
  expect(refresh).not.toHaveBeenCalled();
});
