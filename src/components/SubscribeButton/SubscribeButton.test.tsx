import { expect, spyOn, test } from 'bun:test';
import * as queries from '@tanstack/react-query';
import { IDBFactory } from 'fake-indexeddb';
import { renderToStaticMarkup } from 'react-dom/server';
import { stateRuntime } from '@/data/state-browser';
import { accountState } from '@/data/state-storage';
import { AccountContext } from '@/shared/auth/AccountBoundary';
import {
  AccountSession,
  type AccountToken,
} from '@/shared/auth/account-session';
import { TranslationProvider } from '@/shared/i18n';
import type { StateScope } from '@/shared/state-contract';
import {
  acknowledgeFollows,
  freezeFollows,
  installFollows,
} from '@/shared/subscriptions/follow-outbox';
import type { IPodcastEpisodesInfo } from '@/types';
import { SubscribeButton } from './SubscribeButton';

const scope: StateScope = {
  protocol: 1,
  accountId: 'subscribe-fixture',
  generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
};
const podcast: IPodcastEpisodesInfo = {
  id: '7',
  feed: 'https://example.invalid/feed',
  title: 'Subscribe fixture',
  cover: '',
  description: '',
  link: null,
  author: '',
  explicit: false,
  keywords: [],
  published: null,
  episodes: [],
};
const unavailable = 'This podcast is no longer available.';

async function fixture(failures: string[] = []) {
  const indexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  globalThis.indexedDB = new IDBFactory();
  const client = new queries.QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const user = {
    id: scope.accountId,
    email: 'fixture@example.invalid',
    name: null,
    image: null,
    hasPasskey: false,
  };
  const session = new AccountSession(client, user, {
    resetPlayer() {},
    reload() {},
    publish() {},
    readSession: async () => user,
  });
  const sync = stateRuntime(session).sync;
  const refresh = spyOn(sync, 'refresh').mockResolvedValue();
  const snapshot = { ...scope, revision: '0', items: [] };
  await sync.storage.update((root) => {
    const state = accountState(root, scope.accountId);
    installFollows(state.follows, snapshot, scope.accountId);
    state.follows.failures = failures;
  });
  await sync.activate(scope.accountId);
  const observers = new Map<
    string,
    queries.MutationObserver<AccountToken, Error, string>
  >();
  const mutation = spyOn(queries, 'useMutation').mockImplementation(
    (options) => {
      const typed = options as queries.MutationObserverOptions<
        AccountToken,
        Error,
        string
      >;
      const key = String(typed.mutationKey?.[2]);
      let observer = observers.get(key);
      if (!observer) {
        observer = new queries.MutationObserver(client, typed);
        observers.set(key, observer);
      } else observer.setOptions(typed);
      const result = observer.getCurrentResult();
      return { ...result, mutateAsync: result.mutate } as never;
    },
  );
  const render = (info = podcast) =>
    renderToStaticMarkup(
      <queries.QueryClientProvider client={client}>
        <AccountContext.Provider value={session}>
          <TranslationProvider>
            <SubscribeButton info={info} />
          </TranslationProvider>
        </AccountContext.Provider>
      </queries.QueryClientProvider>,
    );
  return {
    session,
    sync,
    render,
    subscribe: async (id = '7') => {
      render();
      const observer = observers.get('subscribe');
      if (!observer) throw new Error('Subscribe observer missing');
      return observer.mutate(id);
    },
    reject: async () => {
      await sync.storage.update((root) => {
        const follows = root.accounts[scope.accountId].follows;
        freezeFollows(follows);
        if (!follows.flight) throw new Error('Follow attempt missing');
        const { changes, ...batch } = follows.flight.batch;
        acknowledgeFollows(follows, {
          ...batch,
          revision: snapshot.revision,
          results: changes.map(({ podcastId }) => ({
            podcastId,
            status: 'not_found',
          })),
        });
        installFollows(follows, snapshot, scope.accountId);
      });
      await sync.reload();
    },
    dispose: async () => {
      await sync.suspend();
      mutation.mockRestore();
      refresh.mockRestore();
      client.clear();
      if (indexedDB) Object.defineProperty(globalThis, 'indexedDB', indexedDB);
      else Reflect.deleteProperty(globalThis, 'indexedDB');
    },
  };
}

test('restored follow failures stay quiet until this button makes a rejected attempt', async () => {
  const f = await fixture(['7']);
  try {
    expect(f.render()).not.toContain(unavailable);
    expect(await f.subscribe()).toBe(f.session.token());
    expect(f.render()).not.toContain(unavailable);
    await f.reject();
    expect(f.render()).toContain(`<span role="status">${unavailable}</span>`);
    expect(f.render({ ...podcast, id: '8' })).not.toContain(unavailable);
    await f.subscribe();
    expect(f.render()).not.toContain(unavailable);
    expect(f.render()).toContain('Saved on this device. Waiting to sync…');
    expect(
      (await f.sync.storage.load()).accounts[scope.accountId].follows.failures,
    ).toEqual([]);
  } finally {
    await f.dispose();
  }
});

test('a failure for another podcast does not turn a new follow into an unavailable notice', async () => {
  const f = await fixture(['8']);
  try {
    await f.subscribe();
    expect(f.render()).not.toContain(unavailable);
  } finally {
    await f.dispose();
  }
});

test('an account retirement invalidates feedback from its completed follow attempt', async () => {
  const f = await fixture();
  try {
    await f.subscribe();
    await f.reject();
    expect(f.render()).toContain(unavailable);
    f.session.beginAuthChange();
    expect(f.render()).not.toContain(unavailable);
    await f.session.refresh();
    expect(f.render()).not.toContain(unavailable);
    f.session.beginAuthChange();
    await expect(f.subscribe()).rejects.toThrow('Session changed');
  } finally {
    await f.dispose();
  }
});

test('a currently followed podcast stays clean even when an older failure receipt remains', async () => {
  const f = await fixture();
  try {
    await f.subscribe();
    await f.reject();
    await f.sync.storage.update((root) => {
      installFollows(
        root.accounts[scope.accountId].follows,
        {
          ...scope,
          revision: '1',
          items: [
            {
              podcastId: '7',
              availability: 'available',
              followedAtMs: null,
              revision: '1',
            },
          ],
        },
        scope.accountId,
      );
    });
    await f.sync.reload();
    expect(f.render()).not.toContain(unavailable);
    expect(f.render()).toContain('data-is-subscribed="true"');
  } finally {
    await f.dispose();
  }
});
