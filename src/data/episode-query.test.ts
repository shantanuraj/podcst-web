import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import {
  type InfiniteData,
  InfiniteQueryObserver,
  QueryClient,
} from '@tanstack/react-query';
import type { AccountUser } from '@/shared/auth/account';
import { AccountSession } from '@/shared/auth/account-session';
import type { FeedFreshness } from '@/shared/feed-contract';
import type { IEpisodeInfo, IPaginatedEpisodes } from '@/types';
import { episodesQueryOptions } from './episode-query';
import { feedRefreshOptions } from './feed-refresh';

const clients: QueryClient[] = [];
const spies: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>[] = [];
const fresh: FeedFreshness = {
  content: 'cached',
  state: 'fresh',
  checkedAtMs: 1000,
  retryAtMs: null,
};
const owner: AccountUser = {
  id: 'owner',
  email: 'owner@example.invalid',
  name: null,
  image: null,
  hasPasskey: false,
};

function fixture(user: AccountUser | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const identity = { user };
  const session = new AccountSession(client, user, {
    resetPlayer() {},
    reload() {},
    publish() {},
    readSession: async () => identity.user,
  });
  return { client, session, identity };
}

function page(start = 0, count = 20, total = 1678): IPaginatedEpisodes {
  return {
    freshness: fresh,
    episodes: Array.from({ length: count }, (_, index) => ({
      id: String(start + index + 1),
      podcastId: '1',
      guid: String(start + index + 1),
      title: `Episode ${start + index + 1}`,
    })) as IEpisodeInfo[],
    total,
    hasMore: start + count < total,
    nextCursor: start + count < total ? start + count : undefined,
  };
}

function respond(
  operation: (...args: Parameters<typeof fetch>) => Promise<Response>,
) {
  const spy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(operation, { preconnect() {} }),
  );
  spies.push(spy);
  return spy;
}

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  for (const client of clients.splice(0)) client.clear();
});

test('first-page content is ready while refresh is unresolved and older pages remain unfetched', async () => {
  const { client, session } = fixture();
  const refresh = Promise.withResolvers<Response>();
  const routeRefresh = mock();
  const spy = respond(async (input) =>
    String(input).endsWith('/feed/refresh')
      ? refresh.promise
      : Response.json(page()),
  );
  const refreshWork = client.fetchQuery(
    feedRefreshOptions(session, '1', routeRefresh),
  );
  const options = episodesQueryOptions(session, { podcastId: '1' });
  const data = await client.fetchInfiniteQuery(options);
  expect(data.pages[0].episodes).toHaveLength(20);
  expect(data.pages[0].total).toBe(1678);
  expect(
    spy.mock.calls.map(([input]) => {
      const url = new URL(String(input));
      return url.pathname + url.search;
    }),
  ).toEqual(['/api/feed/refresh', '/api/feed/episodes?podcastId=1&limit=20']);
  expect(routeRefresh).not.toHaveBeenCalled();
  refresh.resolve(Response.json({ podcastId: '1', freshness: fresh }));
  await refreshWork;
  expect(
    client.getQueryData<InfiniteData<IPaginatedEpisodes>>(options.queryKey),
  ).toEqual(data);
});

test('failed next-page loading keeps playable rows and retries only the requested cursor', async () => {
  const { client, session } = fixture();
  let failing = true;
  const spy = respond(async (input) => {
    const cursor = new URL(String(input)).searchParams.get('cursor');
    return cursor === null
      ? Response.json(page())
      : failing
        ? Response.json({ message: 'Temporary failure' }, { status: 503 })
        : Response.json(page(20, 5, 25));
  });
  const observer = new InfiniteQueryObserver(client, {
    ...episodesQueryOptions(session, { podcastId: '1' }),
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  await observer.fetchNextPage();
  const failed = observer.getCurrentResult();
  expect(failed.isFetchNextPageError).toBe(true);
  expect(failed.data?.pages[0].episodes).toHaveLength(20);
  expect(failed.hasNextPage).toBe(true);
  failing = false;
  await observer.fetchNextPage();
  expect(
    observer.getCurrentResult().data?.pages.map((p) => p.episodes.length),
  ).toEqual([20, 5]);
  expect(observer.getCurrentResult().hasNextPage).toBe(false);
  expect(
    spy.mock.calls.map(([input]) =>
      new URL(String(input)).searchParams.get('cursor'),
    ),
  ).toEqual([null, '20', '20']);
  unsubscribe();
  observer.destroy();
});

test('full-archive search and sort replace old results even when their request finishes later', async () => {
  const { client, session } = fixture(owner);
  const old = Promise.withResolvers<Response>();
  let oldSignal: AbortSignal | null | undefined;
  const spy = respond(async (input, init) => {
    const url = new URL(String(input));
    if (!url.searchParams.has('search')) {
      oldSignal = init?.signal;
      return old.promise;
    }
    return Response.json(page(800, 1, 1));
  });
  const observer = new InfiniteQueryObserver(client, {
    ...episodesQueryOptions(session, { podcastId: '1' }),
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  observer.setOptions({
    ...episodesQueryOptions(session, {
      podcastId: '1',
      search: 'archive',
      sortBy: 'duration',
      sortDir: 'asc',
      unplayed: true,
    }),
    retry: false,
  });
  await observer.refetch();
  expect(oldSignal?.aborted).toBe(true);
  old.resolve(Response.json(page()));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const result = observer.getCurrentResult();
  expect(result.data?.pages[0].episodes[0].id).toBe('801');
  const query = new URL(String(spy.mock.calls[1][0])).searchParams;
  expect(Object.fromEntries(query)).toEqual({
    podcastId: '1',
    limit: '20',
    search: 'archive',
    sortBy: 'duration',
    sortDir: 'asc',
    unplayed: 'true',
  });
  unsubscribe();
  observer.destroy();
});

test('account changes discard a pending page even when transport ignores cancellation', async () => {
  const { client, session, identity } = fixture(owner);
  const gate = Promise.withResolvers<Response>();
  let signal: AbortSignal | null | undefined;
  respond(async (_, init) => {
    signal = init?.signal;
    return gate.promise;
  });
  const options = episodesQueryOptions(session, { podcastId: '1' });
  const work = client.fetchInfiniteQuery(options).catch((error) => error);
  session.beginAuthChange();
  identity.user = null;
  await session.refresh();
  expect(signal?.aborted).toBe(true);
  gate.resolve(Response.json(page()));
  expect(await work).toBeInstanceOf(Error);
  expect(client.getQueryData(options.queryKey)).toBeUndefined();
});

test('missing-content responses preserve loaded rows but cannot erase them with an empty page', async () => {
  const { client, session } = fixture();
  const options = episodesQueryOptions(session, { podcastId: '1' });
  client.setQueryData<InfiniteData<IPaginatedEpisodes>>(options.queryKey, {
    pages: [page(), page(20)],
    pageParams: [undefined, 20],
  });
  respond(async () =>
    Response.json({
      episodes: [],
      total: 0,
      hasMore: false,
      freshness: {
        content: 'missing',
        state: 'pending',
        checkedAtMs: null,
        retryAtMs: 5000,
      },
    }),
  );
  const data = await client.fetchInfiniteQuery({ ...options, staleTime: 0 });
  expect(data.pages).toHaveLength(1);
  expect(data.pages[0].episodes).toHaveLength(40);
  expect(data.pages[0].freshness?.state).toBe('pending');
});

test.each([
  20, 0, -1, 20.5,
])('pagination stops instead of looping when the next cursor is %s', async (nextCursor) => {
  const { client, session } = fixture();
  const spy = respond(async (input) =>
    Response.json(
      new URL(String(input)).searchParams.has('cursor')
        ? { ...page(20), nextCursor }
        : page(),
    ),
  );
  const observer = new InfiniteQueryObserver(
    client,
    episodesQueryOptions(session, { podcastId: '1' }),
  );
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  await observer.fetchNextPage();
  expect(observer.getCurrentResult().hasNextPage).toBe(false);
  await observer.fetchNextPage();
  expect(spy).toHaveBeenCalledTimes(2);
  expect(observer.getCurrentResult().data?.pages).toHaveLength(2);
  unsubscribe();
  observer.destroy();
});
