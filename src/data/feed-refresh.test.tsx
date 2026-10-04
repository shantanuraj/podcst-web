import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import {
  hydrate,
  type InfiniteData,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query';
import { AccountSession } from '@/shared/auth/account-session';
import type { IPaginatedEpisodes } from '@/types';
import { EpisodesHydration } from '@/ui/EpisodesList/EpisodesHydration';
import { episodesQueryKey as scopedEpisodesQueryKey } from './episode-query';
import { feedRefreshOptions as scopedFeedRefreshOptions } from './feed-refresh';

const sessions = new WeakMap<QueryClient, AccountSession>();
const episodesQueryKey = (
  id: number,
  search?: string,
  sort?: string,
  direction?: string,
) => scopedEpisodesQueryKey(null, id, search, sort, direction);
const feedRefreshOptions = (
  client: QueryClient,
  id: number,
  refresh: () => void,
  empty = false,
) => {
  const session = sessions.get(client);
  if (!session) throw new Error('Missing fixture account');
  return scopedFeedRefreshOptions(session, id, refresh, empty);
};

const clients: QueryClient[] = [];
const fetchSpies: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>[] = [];

function client() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(queryClient);
  sessions.set(
    queryClient,
    new AccountSession(queryClient, null, {
      resetPlayer() {},
      reload() {},
      publish() {},
      readSession: async () => null,
    }),
  );
  return queryClient;
}

function respond(status: string, code = 200) {
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ status }, { status: code }),
  );
  fetchSpies.push(fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  for (const fetchSpy of fetchSpies.splice(0)) fetchSpy.mockRestore();
  for (const queryClient of clients.splice(0)) queryClient.clear();
});

describe('feed refresh', () => {
  for (const status of ['skipped', 'not_modified']) {
    test(`${status} preserves the route and cached episodes`, async () => {
      respond(status);
      const queryClient = client();
      const refresh = mock();
      const queryKey = episodesQueryKey(1);
      queryClient.setQueryData(queryKey, { pages: [] });

      await queryClient.fetchQuery(feedRefreshOptions(queryClient, 1, refresh));

      expect(refresh).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
    });
  }

  test('cached success does not replay refresh when an observer mounts', async () => {
    const fetchSpy = respond('updated');
    const queryClient = client();
    const refresh = mock();
    await queryClient.fetchQuery(feedRefreshOptions(queryClient, 1, refresh));

    const remountedRefresh = mock();
    const observer = new QueryObserver(
      queryClient,
      feedRefreshOptions(queryClient, 1, remountedRefresh),
    );
    const unsubscribe = observer.subscribe(() => {});
    await queryClient.fetchQuery(
      feedRefreshOptions(queryClient, 1, remountedRefresh),
    );
    unsubscribe();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(remountedRefresh).not.toHaveBeenCalled();
  });

  test('updated feed hydrates the default list and refetches active filters once', async () => {
    respond('updated');
    const queryClient = client();
    const queryKey = episodesQueryKey(1);
    const oldPage: IPaginatedEpisodes = {
      episodes: [],
      total: 40,
      hasMore: true,
      nextCursor: 20,
    };
    queryClient.setQueryData<InfiniteData<IPaginatedEpisodes>>(
      queryKey,
      { pages: [oldPage, oldPage], pageParams: [undefined, 20] },
      { updatedAt: 1 },
    );
    const fetchDefault = mock(async () => ({
      pages: [oldPage],
      pageParams: [undefined],
    }));
    const defaultObserver = new QueryObserver(queryClient, {
      queryKey,
      queryFn: fetchDefault,
      staleTime: Infinity,
    });
    const unsubscribeDefault = defaultObserver.subscribe(() => {});
    const filteredKey = episodesQueryKey(1, 'climate', 'title', 'asc');
    queryClient.setQueryData(filteredKey, { total: 2 });
    const fetchFiltered = mock(async () => ({ total: 3 }));
    const filteredObserver = new QueryObserver(queryClient, {
      queryKey: filteredKey,
      queryFn: fetchFiltered,
      staleTime: Infinity,
    });
    const unsubscribeFiltered = filteredObserver.subscribe(() => {});
    const otherKey = episodesQueryKey(2);
    queryClient.setQueryData(otherKey, { total: 9 });
    const refresh = mock();

    await queryClient.fetchQuery(feedRefreshOptions(queryClient, 1, refresh));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchDefault).not.toHaveBeenCalled();
    expect(fetchFiltered).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<{ total: number }>(filteredKey)).toEqual({
      total: 3,
    });
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);

    const nextPage = { ...oldPage, total: 41 };
    const boundary = EpisodesHydration({
      scope: null,
      podcastId: 1,
      initialData: nextPage,
      children: null,
    });
    hydrate(queryClient, boundary.props.state);

    expect(
      queryClient.getQueryData<InfiniteData<IPaginatedEpisodes>>(queryKey),
    ).toEqual({
      pages: [nextPage],
      pageParams: [undefined],
    });
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
    expect(fetchDefault).not.toHaveBeenCalled();
    unsubscribeDefault();
    unsubscribeFiltered();
  });

  test('an empty server snapshot reconciles after a skipped check', async () => {
    respond('skipped');
    const queryClient = client();
    const refresh = mock();

    await queryClient.fetchQuery(
      feedRefreshOptions(queryClient, 1, refresh, true),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a busy refresh reconciles once after another request completes', async () => {
    const fetchSpy = respond('skipped');
    fetchSpy.mockResolvedValueOnce(
      Response.json({ status: 'busy' }, { status: 202 }),
    );
    const queryClient = client();
    const refresh = mock();

    await queryClient.fetchQuery({
      ...feedRefreshOptions(queryClient, 1, refresh),
      retryDelay: 0,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a failed refresh leaves the route and cache intact', async () => {
    respond('error', 502);
    const queryClient = client();
    const refresh = mock();
    const queryKey = episodesQueryKey(1);
    queryClient.setQueryData(queryKey, { pages: [] });

    await expect(
      queryClient.fetchQuery({
        ...feedRefreshOptions(queryClient, 1, refresh),
        retry: false,
      }),
    ).rejects.toThrow('Feed refresh unavailable');

    expect(refresh).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });
});
