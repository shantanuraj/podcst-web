import { expect, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { IDBFactory } from 'fake-indexeddb';
import type { AccountUser } from '@/shared/auth/account';
import { AccountSession } from '@/shared/auth/account-session';
import type { FollowBatch, ProgressBatch } from '@/shared/state-contract';
import { connectState, stateRuntime } from './state-browser';

const generation = '17adbd84-d0e4-4e2d-ad9f-b084efee3211';
const accountId = 'state-browser-fixture';

async function fixture() {
  const originals = new Map(
    ['indexedDB', 'window', 'document'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: new IDBFactory(),
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: Object.assign(new EventTarget(), { visibilityState: 'hidden' }),
  });
  const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name: string, work: () => Promise<void>) => work(),
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const user: AccountUser = {
    id: accountId,
    email: 'fixture@example.invalid',
    name: null,
    image: null,
    hasPasskey: false,
  };
  let nextUser = user;
  const session = new AccountSession(client, user, {
    resetPlayer() {},
    reload() {},
    publish() {},
    readSession: async () => nextUser,
  });
  let progressRevision = 0;
  let followRevision = 0;
  let position = 0;
  const followed = new Set<string>();
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);
        const scope = { protocol: 1, accountId: session.scope, generation };
        if (init?.body) {
          const batch = JSON.parse(String(init.body)) as
            | ProgressBatch
            | FollowBatch;
          const { changes, ...stream } = batch;
          const results = changes.map((change) => {
            if ('episodeId' in change) {
              position = change.positionSeconds;
              progressRevision++;
              return { episodeId: change.episodeId, status: 'applied' };
            }
            if (change.followed) followed.add(change.podcastId);
            else followed.delete(change.podcastId);
            followRevision++;
            return { podcastId: change.podcastId, status: 'applied' };
          });
          return Response.json({
            ...stream,
            revision: String(
              path === '/api/progress' ? progressRevision : followRevision,
            ),
            results,
          });
        }
        if (path.startsWith('/api/progress'))
          return Response.json({
            ...scope,
            revision: String(progressRevision),
            items: path.includes('episodeIds=')
              ? [
                  {
                    episodeId: '42',
                    progress: {
                      positionSeconds: position,
                      completed: false,
                      revision: String(progressRevision),
                      updatedAtMs: null,
                    },
                  },
                ]
              : [],
          });
        if (path === '/api/subscriptions?view=membership')
          return Response.json({
            ...scope,
            revision: String(followRevision),
            items: [...followed].map((podcastId) => ({
              podcastId,
              availability: 'available',
              revision: String(followRevision),
              followedAtMs: null,
            })),
          });
        throw new Error(`Unexpected request: ${path}`);
      },
      { preconnect() {} },
    ),
  );
  const invalidations = spyOn(client, 'invalidateQueries');
  const sync = stateRuntime(session).sync;
  const settle = async (account: string) => {
    await new Promise<void>((resolve) => {
      const ready = () => {
        const view = sync.getSnapshot();
        return (
          view.account === account &&
          !!view.state?.accounts[account]?.follows.snapshot &&
          !view.syncing
        );
      };
      if (ready()) return resolve();
      const unsubscribe = sync.subscribe(() => {
        if (!ready()) return;
        unsubscribe();
        resolve();
      });
    });
    await sync.refresh();
  };
  const disconnect = connectState(session);
  await settle(accountId);
  invalidations.mockClear();
  return {
    session,
    sync,
    invalidations,
    keys: () => invalidations.mock.calls.map(([filter]) => filter?.queryKey),
    switchAccount: async () => {
      nextUser = { ...user, id: 'other-account' };
      await session.finishAuthChange(true);
      await settle(nextUser.id);
    },
    dispose: async () => {
      disconnect();
      await sync.suspend();
      client.clear();
      invalidations.mockRestore();
      fetcher.mockRestore();
      if (locks) Object.defineProperty(navigator, 'locks', locks);
      else Reflect.deleteProperty(navigator, 'locks');
      for (const [name, original] of originals)
        if (original) Object.defineProperty(globalThis, name, original);
        else Reflect.deleteProperty(globalThis, name);
    },
  };
}

test('playback checkpoints refresh progress queries without refreshing subscriptions', async () => {
  const f = await fixture();
  try {
    await f.sync.progress('42', 'checkpoint', 20);
    await f.sync.refresh();
    expect(f.keys()).toEqual([
      ['account', accountId, 'podcast-progress'],
      ['account', accountId, 'recent-progress'],
    ]);
    f.invalidations.mockClear();
    await f.sync.refresh();
    await f.sync.reload();
    expect(f.keys()).toEqual([]);
  } finally {
    await f.dispose();
  }
});

test('follow acknowledgements refresh subscriptions without refreshing progress queries', async () => {
  const f = await fixture();
  try {
    await f.sync.follow('7', true);
    await f.sync.refresh();
    expect(f.keys()).toEqual([['account', accountId, 'subscriptions']]);
  } finally {
    await f.dispose();
  }
});

test('generation changes invalidate their resource even when its revision is unchanged', async () => {
  const f = await fixture();
  try {
    const nextGeneration = crypto.randomUUID();
    await f.sync.storage.update((root) => {
      root.accounts[accountId].progress.scope = {
        protocol: 1,
        accountId,
        generation: nextGeneration,
      };
    });
    await f.sync.reload();
    expect(f.keys()).toEqual([
      ['account', accountId, 'podcast-progress'],
      ['account', accountId, 'recent-progress'],
    ]);
    f.invalidations.mockClear();
    await f.sync.storage.update((root) => {
      const state = root.accounts[accountId].follows;
      if (!state.scope || !state.snapshot)
        throw new Error('Missing follow snapshot');
      state.scope.generation = nextGeneration;
      state.snapshot.generation = nextGeneration;
    });
    await f.sync.reload();
    expect(f.keys()).toEqual([['account', accountId, 'subscriptions']]);
  } finally {
    await f.dispose();
  }
});

test('retired account updates stay fenced and a new account initializes its own queries', async () => {
  const f = await fixture();
  try {
    f.session.beginAuthChange();
    await f.sync.storage.update((root) => {
      root.accounts[accountId].progress.revision = '9';
    });
    await f.sync.reload();
    expect(f.keys()).toEqual([]);
    await f.switchAccount();
    const keys = f.keys();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key?.[1] === 'other-account')).toBe(true);
    expect(new Set(keys.map((key) => key?.[2]))).toEqual(
      new Set(['subscriptions', 'podcast-progress', 'recent-progress']),
    );
  } finally {
    await f.dispose();
  }
});
