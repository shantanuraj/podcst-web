import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  dehydrate,
  InfiniteQueryObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query';
import { ApiError } from '@/data/api';
import { episodesQueryKey } from '@/data/episode-query';
import { restoreAccountProgress } from '@/shared/player/playback-state';
import { getCurrentEpisode, usePlayer } from '@/shared/player/usePlayer';
import type { IEpisodeInfo } from '@/types';
import { type AccountUser, accountQueryKey } from './account';
import { ACCOUNT_EVENT, connectAccountEvents } from './account-events';
import { AccountSession } from './account-session';

const owner: AccountUser = {
  id: 'owner-a',
  email: 'a@example.invalid',
  name: null,
  image: null,
  hasPasskey: false,
};
const other: AccountUser = {
  ...owner,
  id: 'other-b',
  email: 'b@example.invalid',
};
const episode = {
  id: '4242',
  podcastId: '42',
  guid: 'private-fixture',
  isPrivate: true,
  title: 'Owner-only fixture',
  cover: '',
  file: { url: 'https://audio.example.invalid/private' },
} as IEpisodeInfo;
const clients: QueryClient[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(user: AccountUser | null | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const identity = { user: user ?? null };
  const reload = mock();
  const publish = mock();
  const session = new AccountSession(client, user, {
    readSession: async () => identity.user,
    resetPlayer: (scope, revision) =>
      usePlayer.getState().setAccount(scope, revision),
    reload,
    publish,
  });
  session.synchronizePlayer();
  return { client, session, identity, reload, publish };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  usePlayer
    .getState()
    .setAccount(undefined, usePlayer.getState().accountRevision + 1);
});

describe('web account boundary', () => {
  test('deletion suspends writes while retaining proof identity and clears only matching account caches', async () => {
    const f = fixture(owner);
    const token = f.session.token();
    f.client.setQueryData(['account', owner.id, 'private'], 'owner');
    f.client.setQueryData(['account', other.id, 'private'], 'other');
    f.client.setQueryData(['account', null, 'library'], 'guest');
    f.session.suspendForDeletion(owner.id);
    expect(f.session.verifiedAccount).toBe(owner.id);
    expect(f.session.getSnapshot().ready).toBe(false);
    expect(f.session.current(token)).toBe(false);
    f.session.forgetDeletedAccount(owner.id);
    expect(f.session.scope).toBeNull();
    expect(
      f.client.getQueryData<string>(['account', owner.id, 'private']),
    ).toBeUndefined();
    expect(
      f.client.getQueryData<string>(['account', other.id, 'private']),
    ).toBe('other');
    expect(f.client.getQueryData<string>(['account', null, 'library'])).toBe(
      'guest',
    );
    expect(f.publish).toHaveBeenCalledTimes(1);
  });

  test('resuming old-account deletion preserves the current account and requires all cleanup stores', async () => {
    const f = fixture(other);
    const token = f.session.token();
    f.session.forgetDeletedAccount(owner.id);
    expect(f.session.scope).toBe(other.id);
    expect(f.session.current(token)).toBe(true);
    expect(f.publish).not.toHaveBeenCalled();
    await expect(f.session.eraseConfirmedAccount(owner.id)).rejects.toThrow(
      'not initialized',
    );
    const erased: string[] = [];
    for (const kind of ['queue', 'stars', 'state'])
      f.session.registerLifecycle(kind, {
        suspend: async () => {},
        erase: async (account) => {
          erased.push(`${kind}:${account}`);
        },
      });
    await f.session.eraseConfirmedAccount(owner.id);
    expect(erased).toEqual(['queue:owner-a', 'stars:owner-a', 'state:owner-a']);
    expect(f.session.current(token)).toBe(true);
  });

  test('an unresolved account cannot start guest queries or activate guest playback', async () => {
    const f = fixture(undefined);
    const operation = mock(async () => 'guest data');
    expect(f.session.getSnapshot().user).toBeNull();
    expect(f.session.getSnapshot().ready).toBe(false);
    expect(f.session.query('feed', 42, operation).enabled).toBe(false);
    await expect(
      f.session.run(f.session.token(), 42, operation),
    ).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
    expect(usePlayer.getState().accountScope).toBeUndefined();
  });

  test.each([
    null,
    owner,
  ])('initial identity resolution preserves the revision and page for %j', async (user) => {
    const f = fixture(undefined);
    f.identity.user = user;
    f.client.setQueryData(['top', 'us'], ['public chart']);
    await f.session.refresh();
    expect(f.session.getSnapshot()).toMatchObject({
      user,
      ready: true,
      revision: 0,
    });
    expect(usePlayer.getState().accountScope).toBe(user?.id ?? null);
    expect(usePlayer.getState().accountRevision).toBe(0);
    expect(f.session.current(f.session.token())).toBe(true);
    expect(f.client.getQueryData<string[]>(['top', 'us'])).toEqual([
      'public chart',
    ]);
    expect(f.reload).not.toHaveBeenCalled();
  });

  test.each([
    'offline',
    'invalid',
  ])('a failed %s bootstrap remains unresolved and can retry', async (failure) => {
    const f = fixture(undefined);
    let attempt = 0;
    const session = new AccountSession(f.client, undefined, {
      readSession: async () => {
        if (++attempt > 1) return owner;
        if (failure === 'offline') throw new Error('Offline');
        return {} as AccountUser;
      },
      resetPlayer: (scope, revision) =>
        usePlayer.getState().setAccount(scope, revision),
      reload: f.reload,
      publish() {},
    });
    await session.refresh();
    expect(session.getSnapshot().ready).toBe(false);
    expect(session.current(session.token())).toBe(false);
    expect(usePlayer.getState().accountScope).toBeUndefined();
    await session.refresh();
    expect(session.getSnapshot()).toMatchObject({
      user: owner,
      ready: true,
      revision: 0,
    });
    expect(f.reload).not.toHaveBeenCalled();
  });

  test('identity changes after bootstrap retire private state even when readiness was already suspended', async () => {
    const f = fixture(undefined);
    f.identity.user = owner;
    await f.session.refresh();
    const token = f.session.token();
    const key = accountQueryKey(owner.id, 'podcast', 42);
    f.client.setQueryData(key, episode);
    usePlayer.getState().restoreEpisode(episode, 19);
    f.session.beginAuthChange();
    expect(f.client.getQueryData(key)).toBeUndefined();
    expect(getCurrentEpisode(usePlayer.getState())).toBeUndefined();
    f.identity.user = other;
    await f.session.refresh();
    expect(f.session.scope).toBe(other.id);
    expect(f.session.getSnapshot().revision).toBe(1);
    expect(f.session.current(token)).toBe(false);
    expect(f.reload).toHaveBeenCalledTimes(1);
  });

  test('an explicit reload is honored during initial identity resolution', async () => {
    const f = fixture(undefined);
    await f.session.refresh(true);
    expect(f.session.getSnapshot().ready).toBe(true);
    expect(f.reload).toHaveBeenCalledTimes(1);
  });

  test('all private-capable keys include distinct owner and guest scopes', () => {
    for (const kind of [
      'feed',
      'podcast',
      'podcast-info',
      'episodes',
      'feed-refresh',
      'playback',
      'subscriptions',
    ]) {
      expect(accountQueryKey('a', kind, 42)).not.toEqual(
        accountQueryKey('b', kind, 42),
      );
      expect(accountQueryKey(null, kind, 42)).not.toEqual(
        accountQueryKey('guest', kind, 42),
      );
    }
    expect(episodesQueryKey('a', '42')[1]).toBe('a');
  });

  test.each([
    401, 403, 404,
  ])('A to B with denied refetch %i purges private data, hydration and player state', async (status) => {
    const f = fixture(owner);
    const options = {
      ...f.session.query('episodes', 42, async () => {
        throw new ApiError(status, 'Unavailable');
      }),
      queryKey: episodesQueryKey(owner.id, '42'),
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
      staleTime: Infinity,
    };
    f.client.setQueryData(options.queryKey, {
      pages: [{ episodes: [episode], total: 1, hasMore: false }],
      pageParams: [undefined],
    });
    f.client.setQueryData(accountQueryKey(owner.id, 'podcast-info', 42), {
      isPrivate: true,
      title: 'Private metadata',
    });
    f.client.setQueryData(['top', 'us'], ['public chart']);
    f.client.setQueryData(['catalog-search', 'science'], ['public catalogue']);
    usePlayer.getState().restoreEpisode(episode, 123);
    const observer = new InfiniteQueryObserver(f.client, options);
    const unsubscribe = observer.subscribe(() => {});
    f.identity.user = other;
    await observer.refetch();
    await f.session.refresh();
    expect(f.session.scope).toBe(other.id);
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(f.client.getQueryData(options.queryKey)).toBeUndefined();
    expect(
      dehydrate(f.client).queries.some(
        (q) => q.queryKey[0] === 'account' && q.queryKey[1] === owner.id,
      ),
    ).toBe(false);
    expect(usePlayer.getState().queue).toEqual([]);
    expect(getCurrentEpisode(usePlayer.getState())).toBeUndefined();
    expect(usePlayer.getState().accountScope).toBe(other.id);
    expect(f.client.getQueryData<string[]>(['top', 'us'])).toEqual([
      'public chart',
    ]);
    expect(
      f.client.getQueryData<string[]>(['catalog-search', 'science']),
    ).toEqual(['public catalogue']);
    expect(f.reload).toHaveBeenCalledTimes(1);
    unsubscribe();
    observer.destroy();
  });

  test('a same-account denial clears stale data and disables that resource without a refetch loop', async () => {
    const f = fixture(owner);
    const options = f.session.query('podcast-info', 42, async () => {
      throw new ApiError(404, 'Unavailable');
    });
    f.client.setQueryData(options.queryKey, { isPrivate: true });
    const observer = new QueryObserver(f.client, {
      ...options,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    await f.session.refresh();
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(f.client.getQueryData(options.queryKey)).toBeUndefined();
    expect(f.session.getSnapshot().denied.has(42)).toBe(true);
    expect(f.session.query('podcast-info', 42, async () => null).enabled).toBe(
      false,
    );
    expect(f.reload).not.toHaveBeenCalled();
    unsubscribe();
    observer.destroy();
  });

  test('delayed responses that ignore abort cannot repopulate retired account queries', async () => {
    const f = fixture(owner);
    const response = deferred<typeof episode>();
    const options = f.session.query(
      'podcast',
      42,
      async () => response.promise,
    );
    const request = f.client.fetchQuery(options).catch(() => null);
    f.identity.user = other;
    await f.session.refresh();
    response.resolve(episode);
    await request;
    expect(f.client.getQueryData(options.queryKey)).toBeUndefined();
    expect(
      f.client.getQueryData(accountQueryKey(other.id, 'podcast', 42)),
    ).toBeUndefined();
  });

  test('a delayed A denial does not erase the new B account', async () => {
    const f = fixture(owner);
    const response = deferred<never>();
    const request = f.client
      .fetchQuery(f.session.query('podcast', 42, () => response.promise))
      .catch(() => null);
    f.identity.user = other;
    await f.session.refresh();
    f.client.setQueryData(accountQueryKey(other.id, 'podcast', 88), {
      title: 'B data',
    });
    const revision = f.session.getSnapshot().revision;
    response.reject(new ApiError(401, 'Old denial'));
    await request;
    expect(f.session.getSnapshot().revision).toBe(revision);
    expect(
      f.client.getQueryData<{ title: string }>(
        accountQueryKey(other.id, 'podcast', 88),
      ),
    ).toEqual({ title: 'B data' });
  });

  test('progress restoration is generation-fenced even across A to B to A', async () => {
    const f = fixture(owner);
    const token = f.session.token();
    f.identity.user = other;
    await f.session.refresh();
    expect(
      restoreAccountProgress(f.session, token, { episode, position: 33 }),
    ).toBe(false);
    f.identity.user = owner;
    await f.session.refresh();
    expect(
      restoreAccountProgress(f.session, token, { episode, position: 33 }),
    ).toBe(false);
    expect(getCurrentEpisode(usePlayer.getState())).toBeUndefined();
    expect(
      restoreAccountProgress(f.session, f.session.token(), {
        episode,
        position: 44,
      }),
    ).toBe(true);
    expect(usePlayer.getState().seekPosition).toBe(44);
  });

  test('expiry and explicit logout retire owner queries while preserving public caches', async () => {
    const f = fixture(owner);
    const key = accountQueryKey(owner.id, 'playback', 'playback');
    f.client.setQueryData(key, { episode, position: 99 });
    usePlayer.getState().restoreEpisode(episode, 99);
    f.identity.user = null;
    await f.session.refresh();
    expect(f.session.scope).toBeNull();
    expect(f.client.getQueryData(key)).toBeUndefined();
    expect(getCurrentEpisode(usePlayer.getState())).toBeUndefined();
    f.session.beginAuthChange();
    expect(f.session.getSnapshot().ready).toBe(false);
    await f.session.finishAuthChange(true);
    expect(f.publish).toHaveBeenCalledTimes(2);
  });

  test('failed revalidation never restores an externally retired private account', async () => {
    const f = fixture(owner);
    const key = accountQueryKey(owner.id, 'podcast', 42);
    const session = new AccountSession(f.client, owner, {
      readSession: async () => {
        throw new Error('Offline');
      },
      resetPlayer: (scope, revision) =>
        usePlayer.getState().setAccount(scope, revision),
      reload() {},
      publish() {},
    });
    f.client.setQueryData(key, { isPrivate: true });
    await session.refresh();
    expect(session.getSnapshot().ready).toBe(true);
    expect(f.client.getQueryData<{ isPrivate: boolean }>(key)?.isPrivate).toBe(
      true,
    );
    session.externalChange();
    await session.refresh();
    expect(session.getSnapshot().ready).toBe(false);
    expect(f.client.getQueryData(key)).toBeUndefined();
  });

  test('a superseded session lookup cannot adopt an obsolete identity', async () => {
    const f = fixture(owner);
    const old = deferred<AccountUser | null>();
    let calls = 0;
    const session = new AccountSession(f.client, owner, {
      readSession: async () => (++calls === 1 ? old.promise : other),
      resetPlayer() {},
      reload() {},
      publish() {},
    });
    const first = session.refresh();
    await Promise.resolve();
    session.externalChange();
    await session.refresh();
    old.resolve(owner);
    await first;
    expect(session.scope).toBe(other.id);
  });
});

class BrowserEvents extends EventTarget {
  document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  localStorage = { setItem: mock() };
  tick?: () => void;
  setInterval(callback: () => void) {
    this.tick = callback;
    return 1;
  }
  clearInterval() {
    this.tick = undefined;
  }
}

describe('central browser session detection', () => {
  test('the existing browser connection deduplicates an unresolved bootstrap and concurrent revalidation', async () => {
    const f = fixture(undefined);
    const result = deferred<AccountUser | null>();
    const readSession = mock(async () => result.promise);
    const session = new AccountSession(f.client, undefined, {
      readSession,
      resetPlayer: (scope, revision) =>
        usePlayer.getState().setAccount(scope, revision),
      reload: f.reload,
      publish() {},
    });
    const browser = new BrowserEvents();
    const connection = connectAccountEvents(
      session,
      browser as unknown as Window,
    );
    try {
      const pending = session.refresh();
      browser.dispatchEvent(new Event('focus'));
      browser.tick?.();
      expect(session.refresh()).toBe(pending);
      await Promise.resolve();
      expect(readSession).toHaveBeenCalledTimes(1);
      expect(usePlayer.getState().accountScope).toBeUndefined();
      result.resolve(owner);
      await pending;
      expect(session.scope).toBe(owner.id);
      expect(usePlayer.getState().accountScope).toBe(owner.id);
      expect(f.reload).not.toHaveBeenCalled();
    } finally {
      connection.close();
    }
  });

  test('real storage-event shape retires private state in the receiving tab', async () => {
    const f = fixture(owner);
    const browser = new BrowserEvents();
    const connection = connectAccountEvents(
      f.session,
      browser as unknown as Window,
    );
    await f.session.refresh();
    const key = accountQueryKey(
      owner.id,
      'feed',
      'https://example.invalid/private',
    );
    f.client.setQueryData(key, { isPrivate: true });
    usePlayer.getState().restoreEpisode(episode, 3);
    f.identity.user = other;
    const event = Object.assign(new Event('storage'), {
      key: ACCOUNT_EVENT,
      newValue: JSON.stringify({ id: 'cross-tab-fixture' }),
    });
    browser.dispatchEvent(event);
    expect(f.client.getQueryData(key)).toBeUndefined();
    expect(usePlayer.getState().queue).toEqual([]);
    expect(f.session.getSnapshot().ready).toBe(false);
    await f.session.refresh();
    expect(f.session.scope).toBe(other.id);
    const revision = f.session.getSnapshot().revision;
    browser.dispatchEvent(event);
    expect(f.session.getSnapshot().revision).toBe(revision);
    connection.close();
  });

  test('broadcast and storage notifications deduplicate without trusting supplied identity', async () => {
    const f = fixture(owner);
    const browser = new BrowserEvents();
    const channel = Object.assign(new EventTarget(), {
      postMessage: mock((_value: { id: string }) => {}),
      close: mock(),
    });
    const connection = connectAccountEvents(
      f.session,
      browser as unknown as Window,
      channel as unknown as BroadcastChannel,
    );
    await f.session.refresh();
    f.identity.user = other;
    const value = {
      id: 'broadcast-fixture',
      user: { id: 'untrusted-identity' },
    };
    channel.dispatchEvent(new MessageEvent('message', { data: value }));
    await f.session.refresh();
    expect(f.session.scope).toBe(other.id);
    const revision = f.session.getSnapshot().revision;
    browser.dispatchEvent(
      Object.assign(new Event('storage'), {
        key: ACCOUNT_EVENT,
        newValue: JSON.stringify(value),
      }),
    );
    expect(f.session.getSnapshot().revision).toBe(revision);
    connection.publish();
    expect(channel.postMessage).toHaveBeenCalledTimes(1);
    expect(Object.keys(channel.postMessage.mock.calls[0][0])).toEqual(['id']);
    connection.close();
    expect(channel.close).toHaveBeenCalledTimes(1);
    channel.dispatchEvent(
      new MessageEvent('message', { data: { id: 'after-close' } }),
    );
    expect(f.session.getSnapshot().revision).toBe(revision);
  });

  test('focus, periodic expiry checks and persisted pageshow revalidate centrally', async () => {
    const f = fixture(owner);
    const browser = new BrowserEvents();
    const connection = connectAccountEvents(
      f.session,
      browser as unknown as Window,
    );
    await f.session.refresh();
    f.identity.user = other;
    browser.dispatchEvent(new Event('focus'));
    await f.session.refresh();
    expect(f.session.scope).toBe(other.id);
    f.identity.user = null;
    browser.document.visibilityState = 'hidden';
    browser.tick?.();
    await f.session.refresh();
    expect(f.session.scope).toBeNull();
    f.identity.user = owner;
    browser.dispatchEvent(
      Object.assign(new Event('pageshow'), { persisted: true }),
    );
    await f.session.refresh();
    expect(f.session.scope).toBe(owner.id);
    connection.close();
    expect(browser.tick).toBeUndefined();
  });
});
