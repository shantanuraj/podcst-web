import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IDBFactory } from 'fake-indexeddb';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { freezeProgress, queueProgress } from '@/data/progress-outbox';
import { stateRuntime } from '@/data/state-browser';
import { accountState } from '@/data/state-storage';
import { AccountContext } from '@/shared/auth/AccountBoundary';
import { accountQueryKey } from '@/shared/auth/account';
import { AccountSession } from '@/shared/auth/account-session';
import type { FeedFreshness } from '@/shared/feed-contract';
import { TranslationProvider } from '@/shared/i18n';
import type { ListEpisodeItem } from '@/shared/lists';
import { starRuntime } from '@/shared/stars/browser';
import type { FollowSnapshot, StateScope } from '@/shared/state-contract';
import { installFollows } from '@/shared/subscriptions/follow-outbox';
import { useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import type { IEpisodeInfo, IPodcastEpisodesInfo } from '@/types';
import LibraryPage from './page';

const scope: StateScope = {
  protocol: 1,
  accountId: 'library-fixture',
  generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
};
const podcast: IPodcastEpisodesInfo = {
  id: '7',
  feed: 'https://example.invalid/feed',
  title: 'Library fixture podcast',
  cover: 'https://example.invalid/art.jpg',
  description: '',
  link: null,
  author: 'Fixture author',
  explicit: false,
  keywords: [],
  published: null,
  episodes: [],
};
const episode: IEpisodeInfo = {
  id: '701',
  podcastId: '7',
  feed: podcast.feed,
  podcastTitle: podcast.title,
  title: 'A cached library episode',
  guid: 'cached-episode',
  summary: null,
  showNotes: '',
  published: Date.now(),
  cover: podcast.cover,
  explicit: false,
  duration: 120,
  link: null,
  author: podcast.author,
  episodeArt: null,
  file: {
    url: 'https://example.invalid/audio.mp3',
    length: 1,
    type: 'audio/mpeg',
  },
};
const membership = (
  podcastId: string,
  availability: 'available' | 'unavailable' = 'available',
): FollowSnapshot['items'][number] => ({
  podcastId,
  availability,
  followedAtMs: 0,
  revision: '1',
});

async function fixture({
  items = [membership('7'), membership('8')],
  catalogue,
  membershipPending = false,
  fetching = false,
  error = false,
  failures,
  guest = false,
  starred,
}: {
  items?: FollowSnapshot['items'];
  catalogue?: IPodcastEpisodesInfo[];
  membershipPending?: boolean;
  fetching?: boolean;
  error?: boolean;
  failures?: { progress: string[]; follows: string[] };
  guest?: boolean;
  starred?: ListEpisodeItem[];
} = {}) {
  const indexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  globalThis.indexedDB = new IDBFactory();
  const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name: string, work: (lock: object) => Promise<void>) =>
        work({}),
    },
  });
  const snapshot: FollowSnapshot = { ...scope, revision: '1', items };
  const starSnapshot = {
    ...scope,
    listId: '0c339753-cb50-477c-843e-e641b414a060',
    revision: '1',
    items: starred ?? [],
  };
  const started = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<void>();
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        const path = String(input);
        if (starred && path === '/api/auth/session')
          return Response.json({ user: { id: scope.accountId } });
        if (starred && path === '/api/lists')
          return Response.json({
            ...scope,
            lists: [
              {
                id: starSnapshot.listId,
                kind: 'starred',
                name: null,
                revision: '1',
                itemCount: starred.length,
              },
            ],
          });
        if (starred && path.startsWith('/api/lists/'))
          return Response.json({ ...starSnapshot, nextCursor: null });
        started.resolve();
        if (membershipPending) await pending.promise;
        return Response.json(snapshot);
      },
      { preconnect() {} },
    ),
  );
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        retryOnMount: false,
        refetchOnMount: false,
        staleTime: Infinity,
        gcTime: Infinity,
      },
    },
  });
  const session = new AccountSession(
    client,
    guest
      ? null
      : {
          id: scope.accountId,
          email: 'fixture@example.invalid',
          name: null,
          image: null,
          hasPasskey: false,
        },
    { resetPlayer() {}, reload() {}, publish() {} },
  );
  const sync = stateRuntime(session).sync;
  await sync.storage.update((root) => {
    if (guest) {
      root.guest.catalog = Object.fromEntries(
        (catalogue ?? []).map((podcast) => [podcast.feed, podcast]),
      );
      root.guest.follows = (catalogue ?? []).flatMap(({ id }) =>
        id ? [id] : [],
      );
      return;
    }
    const account = accountState(root, scope.accountId);
    account.progress.scope = scope;
    account.progress.failures = failures?.progress ?? [];
    account.follows.failures = failures?.follows ?? [];
    if (!membershipPending)
      installFollows(account.follows, snapshot, scope.accountId);
  });
  const activation = sync.activate(session.scope);
  if (membershipPending) await started.promise;
  else await activation;
  const stars = starred ? starRuntime(session).sync : undefined;
  if (stars) await stars.activate(session.scope);
  const queryKey = accountQueryKey(scope.accountId, 'subscriptions', 'library');
  if (catalogue !== undefined) client.setQueryData(queryKey, catalogue);
  if (fetching || error)
    client
      .getQueryCache()
      .build(client, { queryKey })
      .setState({
        ...(fetching ? { fetchStatus: 'fetching' } : {}),
        ...(error ? { status: 'error', error: new Error('Unavailable') } : {}),
      });
  return {
    fetcher,
    session,
    sync,
    render: () =>
      renderToStaticMarkup(
        <AppRouterContext.Provider
          value={{
            bfcacheId: 'fixture',
            back() {},
            forward() {},
            refresh() {},
            push() {},
            replace() {},
            prefetch() {},
          }}
        >
          <QueryClientProvider client={client}>
            <AccountContext.Provider value={session}>
              <TranslationProvider>
                <LibraryPage />
              </TranslationProvider>
            </AccountContext.Provider>
          </QueryClientProvider>
        </AppRouterContext.Provider>,
      ),
    dispose: async () => {
      pending.resolve();
      await activation;
      await sync.suspend();
      await stars?.suspend();
      client.clear();
      fetcher.mockRestore();
      if (locks) Object.defineProperty(navigator, 'locks', locks);
      else Reflect.deleteProperty(navigator, 'locks');
      if (indexedDB) Object.defineProperty(globalThis, 'indexedDB', indexedDB);
      else Reflect.deleteProperty(globalThis, 'indexedDB');
    },
  };
}

function section(markup: string, title: string) {
  return (
    markup
      .match(/<section\b[^>]*>[\s\S]*?<\/section>/g)
      ?.find((item) => item.includes(`<h2>${title}</h2>`)) ?? ''
  );
}

function expectLoading(markup: string) {
  expect(section(markup, 'New episodes')).toContain('aria-busy="true"');
  expect(section(markup, 'Subscriptions')).toContain('aria-busy="true"');
  expect(markup).not.toContain('Podcast details unavailable');
  expect(markup).not.toContain('Unfollow');
  expect(markup).not.toContain('Your Library is Empty');
  expect(markup).not.toContain('Nothing new this week');
  expect(markup).toMatch(
    /<button\b[^>]*disabled=""[^>]*>Export [^<]+<\/button>/,
  );
}

test('known follows retain their count while catalogue details are loading', async () => {
  const f = await fixture();
  try {
    const markup = f.render();
    expectLoading(markup);
    expect(section(markup, 'Subscriptions')).toContain('2 ·');
    expect(section(markup, 'Subscriptions')).toContain('aria-hidden="true"');
  } finally {
    await f.dispose();
  }
});

test('a catalogue response cannot declare an empty library before membership arrives', async () => {
  const f = await fixture({ catalogue: [], membershipPending: true });
  try {
    expectLoading(f.render());
  } finally {
    await f.dispose();
  }
});

test('cached subscription tiles survive a background refetch', async () => {
  const f = await fixture({
    items: [membership('7')],
    catalogue: [podcast],
    fetching: true,
  });
  try {
    const markup = f.render();
    expect(section(markup, 'Subscriptions')).toContain(podcast.title);
    expect(markup).not.toContain('Podcast details unavailable');
    expect(markup).not.toContain('Your Library is Empty');
  } finally {
    await f.dispose();
  }
});

test.each([
  ['pending', 'cached'],
  ['backoff', 'cached'],
  ['unavailable', 'cached'],
  ['pending', 'missing'],
] as const)('%s freshness with %s server content keeps the cached library quiet', async (state, content) => {
  const freshness: FeedFreshness = {
    state,
    content,
    checkedAtMs: null,
    retryAtMs: null,
  };
  const f = await fixture({
    items: [membership('7')],
    catalogue: [{ ...podcast, episodes: [episode], freshness }],
  });
  try {
    const markup = f.render();
    expect(section(markup, 'Subscriptions')).toContain(podcast.title);
    expect(section(markup, 'New episodes')).toContain(episode.title);
    expect(markup).not.toContain('Preparing some episodes');
    expect(markup).not.toContain('Cached content and follows are retained');
    expect(markup).not.toContain('>Recheck</button>');
    expect(markup).not.toContain('aria-busy="true"');
    expect(markup).not.toContain('Podcast details unavailable');
  } finally {
    await f.dispose();
  }
});

test('saved content preparation stays with missing episodes instead of becoming a library banner', async () => {
  const freshness: FeedFreshness = {
    state: 'pending',
    content: 'missing',
    checkedAtMs: null,
    retryAtMs: null,
  };
  const f = await fixture({
    items: [membership('7')],
    catalogue: [podcast],
    starred: [
      {
        episodeId: '701',
        addedAt: 0,
        availability: 'available',
        episode,
        freshness,
      },
      {
        episodeId: '702',
        addedAt: 0,
        availability: 'content_missing',
        episode: null,
        freshness,
      },
      {
        episodeId: '703',
        addedAt: 0,
        availability: 'unavailable',
        episode: null,
      },
      {
        episodeId: '704',
        addedAt: 0,
        availability: 'content_missing',
        episode: null,
      },
    ],
  });
  try {
    const markup = f.render();
    const starred = section(markup, 'Starred');
    expect(starred).toContain(episode.title);
    expect(starred).toContain('Preparing episode…');
    expect(starred).toContain('Episode unavailable');
    expect(starred).toContain('Episode details unavailable');
    expect(starred.match(/>Unstar<\/button>/g)).toHaveLength(3);
    expect(markup).not.toContain('Preparing saved episode content');
    expect(markup).not.toContain('Memberships are unchanged');
    expect(markup.replace(starred, '')).not.toContain('Preparing episode…');
  } finally {
    await f.dispose();
  }
});

test('newly followed podcasts are not reported missing during catalogue refetch', async () => {
  const f = await fixture({ catalogue: [podcast], fetching: true });
  try {
    const markup = f.render();
    expect(section(markup, 'Subscriptions')).toContain(podcast.title);
    expect(section(markup, 'Subscriptions')).toContain('2 ·');
    expect(markup).not.toContain('Podcast details unavailable');
    expect(markup).not.toContain('Unfollow');
  } finally {
    await f.dispose();
  }
});

test('confirmed unavailable and missing details stay inside Subscriptions', async () => {
  const f = await fixture({
    items: [membership('7'), membership('8', 'unavailable'), membership('9')],
    catalogue: [podcast],
  });
  try {
    const markup = f.render();
    const subscriptions = section(markup, 'Subscriptions');
    expect(subscriptions).toContain(podcast.title);
    expect(subscriptions).toContain('3 ·');
    expect(subscriptions).toContain('Podcast unavailable');
    expect(subscriptions).toContain('Podcast details unavailable');
    expect(subscriptions.match(/>Unfollow<\/button>/g)).toHaveLength(2);
    expect(markup.replace(subscriptions, '')).not.toContain('Unfollow');
    expect(subscriptions).not.toContain('aria-busy="true"');
  } finally {
    await f.dispose();
  }
});

test('catalogue errors never become an empty library or missing-podcast rows', async () => {
  const f = await fixture({ error: true });
  try {
    const markup = f.render();
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('Your Library is Empty');
    expect(markup).not.toContain('Podcast details unavailable');
    expect(markup).not.toContain('Unfollow');
    expect(markup).not.toContain('Nothing new this week');
  } finally {
    await f.dispose();
  }
});

test('an empty catalogue and confirmed empty membership show the empty library', async () => {
  const f = await fixture({ items: [], catalogue: [] });
  try {
    const markup = f.render();
    expect(markup).toContain('Your Library is Empty');
    expect(markup).not.toContain('aria-busy="true"');
  } finally {
    await f.dispose();
  }
});

test('rejected progress remains dismissible during loading without announcing saved follow failures', async () => {
  const failures = { progress: ['701', '701'], follows: ['8', '9', '8'] };
  const f = await fixture({ failures });
  try {
    const markup = f.render();
    expectLoading(markup);
    expect(markup).not.toContain('Some changes could not be applied');
    expect(markup).toContain(
      'Listening progress could not be saved for 1 unavailable episode.',
    );
    expect(markup).not.toContain('could not be followed');
    expect(markup).toContain('>Dismiss</button>');
    await f.sync.dismissFailures({ progress: failures.progress });
    await f.sync.reload();
    const dismissed = f.render();
    expectLoading(dismissed);
    expect(dismissed).not.toContain('could not be saved');
    expect(dismissed).not.toContain('could not be followed');
    expect(dismissed).not.toContain('>Dismiss</button>');
    expect(
      (await f.sync.storage.load()).accounts[scope.accountId].follows.failures,
    ).toEqual(failures.follows);
  } finally {
    await f.dispose();
  }
});

test('retiring an account hides its failure notices', async () => {
  const f = await fixture({
    catalogue: [podcast],
    failures: { progress: ['701'], follows: ['8'] },
  });
  try {
    expect(f.render()).toContain(
      'Listening progress could not be saved for 1 unavailable episode.',
    );
    expect(f.render()).not.toContain('could not be followed');
    f.session.beginAuthChange();
    expect(f.render()).not.toContain('could not be saved');
    expect(f.render()).not.toContain('could not be followed');
    expect(f.render()).not.toContain('>Dismiss</button>');
  } finally {
    await f.dispose();
  }
});

test('a saved failure for an old podcast leaves its current subscription clean and retains diagnostics', async () => {
  const f = await fixture({
    items: [membership('7')],
    catalogue: [podcast],
    failures: { progress: [], follows: ['8'] },
  });
  try {
    const oldFeed = 'https://example.invalid/old-feed';
    await f.sync.storage.update((root) => {
      root.guest.catalog = {
        [oldFeed]: { ...podcast, id: '8', feed: oldFeed },
      };
    });
    await f.sync.reload();
    const before = await f.sync.storage.load();
    const markup = f.render();
    expect(section(markup, 'Subscriptions')).toContain(podcast.title);
    expect(section(markup, 'Subscriptions')).toContain('1 ·');
    expect(markup).not.toContain('could not be followed');
    expect(markup).not.toContain('Some changes could not be applied');
    expect(markup).not.toContain('Podcast details unavailable');
    expect(markup).not.toContain('>Dismiss</button>');
    expect(before.accounts[scope.accountId].follows.failures).toEqual(['8']);
    expect(await f.sync.storage.load()).toEqual(before);
  } finally {
    await f.dispose();
  }
});

test('guest catalogue loading waits for its own hydration after durable state is ready', async () => {
  const previous = useSubscriptions.getState();
  const initial = useSubscriptions.getInitialState();
  const previousInitial = { ...initial };
  const f = await fixture({ guest: true, catalogue: [podcast] });
  try {
    useSubscriptions.setState({
      subs: {},
      initialized: false,
      error: undefined,
    });
    Object.assign(initial, useSubscriptions.getState());
    expect(f.sync.getSnapshot().state?.guest.follows).toEqual(['7']);
    expectLoading(f.render());
    useSubscriptions.setState({
      subs: { [podcast.feed]: podcast },
      initialized: true,
    });
    Object.assign(initial, useSubscriptions.getState());
    const loaded = f.render();
    expect(section(loaded, 'Subscriptions')).toContain(podcast.title);
    expect(loaded).not.toContain('aria-busy="true"');
    expect(loaded).not.toContain('Your Library is Empty');
  } finally {
    Object.assign(initial, previousInitial);
    useSubscriptions.setState(previous, true);
    await f.dispose();
  }
});

test.each([
  'queued',
  'frozen',
])('%s listening progress stays quiet without keeping missing podcast details loading', async (phase) => {
  const f = await fixture({ catalogue: [podcast] });
  try {
    await f.sync.storage.update((root) => {
      const progress = accountState(root, scope.accountId).progress;
      queueProgress(progress, '701', 'checkpoint', 12);
      if (phase === 'frozen') freezeProgress(progress);
    });
    await f.sync.reload();
    const before = await f.sync.storage.load();
    const markup = f.render();
    expect(markup).not.toContain('Saved on this device. Waiting to sync…');
    const subscriptions = section(markup, 'Subscriptions');
    expect(subscriptions).toContain(podcast.title);
    expect(subscriptions).toContain('Podcast details unavailable');
    expect(subscriptions).toContain('>Unfollow</button>');
    expect(subscriptions).not.toContain('aria-busy="true"');
    expect(subscriptions).not.toContain('aria-hidden="true"');
    expect(await f.sync.storage.load()).toEqual(before);
  } finally {
    await f.dispose();
  }
});

test('a failed progress write still reports that it was not saved on this device', async () => {
  const f = await fixture({ items: [membership('7')], catalogue: [podcast] });
  const update = spyOn(f.sync.storage, 'update').mockRejectedValueOnce(
    new Error('Disk full'),
  );
  try {
    await expect(f.sync.progress('701', 'checkpoint', 12)).rejects.toThrow(
      'Disk full',
    );
    const markup = f.render();
    expect(markup).toContain('Progress could not be saved on this device.');
    expect(markup).not.toContain('Saved on this device. Waiting to sync…');
    expect(section(markup, 'Subscriptions')).toContain(podcast.title);
  } finally {
    update.mockRestore();
    await f.dispose();
  }
});

test('a failed sync remains visible while cached subscriptions stay available', async () => {
  const f = await fixture({ items: [membership('7')], catalogue: [podcast] });
  try {
    f.fetcher.mockRejectedValueOnce(new Error('Offline'));
    await f.sync.refresh();
    const markup = f.render();
    expect(markup).toContain(
      'Sync paused. Pending work is retained for this account.',
    );
    expect(markup).not.toContain('Saved on this device. Waiting to sync…');
    expect(section(markup, 'Subscriptions')).toContain(podcast.title);
  } finally {
    await f.dispose();
  }
});

test('blocked progress still asks for recovery instead of hiding the failure', async () => {
  const f = await fixture({ items: [membership('7')], catalogue: [podcast] });
  try {
    await f.sync.storage.update((root) => {
      const progress = accountState(root, scope.accountId).progress;
      queueProgress(progress, '701', 'checkpoint', 12);
      progress.blocked = 'Progress needs recovery';
    });
    await f.sync.reload();
    const markup = f.render();
    expect(markup).toContain('Progress needs recovery');
    expect(markup).not.toContain('Saved on this device. Waiting to sync…');
    expect(section(markup, 'Subscriptions')).toContain(podcast.title);
  } finally {
    await f.dispose();
  }
});
