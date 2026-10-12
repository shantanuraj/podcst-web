import { beforeEach, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import type {
  FollowBatch,
  FollowSnapshot,
  ProgressBatch,
  ProgressSnapshot,
  StateScope,
} from '@/shared/state-contract';
import {
  freezeFollows,
  installFollows,
  queueFollow,
} from '@/shared/subscriptions/follow-outbox';
import { ApiError } from './api';
import {
  acknowledgeProgress,
  freezeProgress,
  installProgress,
  queueProgress,
} from './progress-outbox';
import { StateRuntime, type StateTransport } from './state-runtime';
import { accountState, browserStateStorage } from './state-storage';

const oldScope: StateScope = {
  protocol: 1,
  accountId: 'recovery-fixture',
  generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
};
const currentScope: StateScope = {
  ...oldScope,
  generation: '27adbd84-d0e4-4e2d-ad9f-b084efee3211',
};
const feed = 'https://example.invalid/pending-import';
const episodeId = '301';
const membership = (scope = currentScope, revision = '25'): FollowSnapshot => ({
  ...scope,
  revision,
  items: Array.from({ length: 14 }, (_, index) => ({
    podcastId: String(index + 1),
    revision,
    followedAtMs: null,
    availability: 'available',
  })),
});
const progress = (scope = currentScope): ProgressSnapshot => ({
  ...scope,
  revision: '25',
  items: [
    {
      episodeId,
      progress: {
        positionSeconds: 80,
        completed: false,
        revision: '25',
        updatedAtMs: null,
      },
    },
  ],
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

async function fixture(
  seed?: (state: ReturnType<typeof accountState>) => void,
) {
  const storage = browserStateStorage();
  await storage.update((root) => {
    const state = accountState(root, oldScope.accountId);
    installFollows(state.follows, membership(oldScope), oldScope.accountId);
    installProgress(state.progress, progress(oldScope), oldScope.accountId);
    state.follows.importFailures = [feed];
    state.follows.importRetryAt = { [feed]: 123456 };
    seed?.(state);
  });
  const responses: { follows: unknown; progress: unknown } = {
    follows: membership(),
    progress: progress(),
  };
  const sent: (FollowBatch | ProgressBatch)[] = [];
  const requests: string[] = [];
  const api: StateTransport = {
    request: async (path, method = 'GET', body) => {
      requests.push(`${method} ${path}`);
      if (body) {
        sent.push(structuredClone(body) as FollowBatch | ProgressBatch);
        throw new ApiError(
          409,
          'State reconciliation required',
          'recovery_required',
        );
      }
      const response = path.startsWith('/progress')
        ? responses.progress
        : responses.follows;
      return structuredClone(
        typeof response === 'function' ? response(path) : response,
      );
    },
  };
  let online = false;
  const make = () =>
    new StateRuntime(storage, api, async (work) => {
      if (online) await work();
    });
  const sync = make();
  await sync.activate(oldScope.accountId);
  return {
    storage,
    sync,
    api,
    responses,
    sent,
    requests,
    make,
    read: async () => (await storage.load()).accounts[oldScope.accountId],
    refresh: async () => {
      online = true;
      await sync.refresh();
    },
  };
}

test.each([
  '1',
  '25',
])('a valid new generation heals idle blocked follows at revision %s without losing imports', async (revision) => {
  const f = await fixture(({ follows }) => {
    follows.blocked = 'Invalid or stale follow snapshot';
  });
  const before = await f.read();
  const snapshot = membership(currentScope, revision);
  f.responses.follows = snapshot;
  await f.refresh();
  const after = (await f.read()).follows;
  expect(after.scope).toEqual(currentScope);
  expect(after.snapshot).toEqual(snapshot);
  expect(after.snapshot?.items).toHaveLength(14);
  expect(after.revision).toBe(revision);
  expect(after.blocked).toBeUndefined();
  expect(after.clientId).not.toBe(before.follows.clientId);
  expect(after.importFailures).toEqual(before.follows.importFailures);
  expect(after.importRetryAt).toEqual(before.follows.importRetryAt);
  expect(f.sent).toEqual([]);
  const restart = f.make();
  await restart.activate(oldScope.accountId);
  expect((await f.read()).follows).toEqual(after);
});

test('an idle blocked follow stream stays blocked for an unchanged generation', async () => {
  const f = await fixture(({ follows }) => {
    follows.blocked = 'Invalid or stale follow snapshot';
  });
  const before = (await f.read()).follows;
  f.responses.follows = membership(oldScope);
  await f.refresh();
  expect((await f.read()).follows).toEqual(before);
  expect(f.requests).toContain('GET /subscriptions?view=membership');
  expect(f.sent).toEqual([]);
});

for (const resource of ['follows', 'progress'] as const)
  for (const frozen of [false, true])
    test(`new generation retains ${frozen ? 'frozen' : 'queued'} ${resource} work without replaying it`, async () => {
      const f = await fixture((state) => {
        if (resource === 'follows') {
          queueFollow(state.follows, '99', true);
          if (frozen) freezeFollows(state.follows);
        } else {
          queueProgress(state.progress, episodeId, 'checkpoint', 120);
          if (frozen) freezeProgress(state.progress);
        }
      });
      const before = (await f.read())[resource];
      await f.refresh();
      const after = (await f.read())[resource];
      expect(after.scope).toEqual(before.scope);
      expect(after.clientId).toBe(before.clientId);
      expect(after.sequence).toBe(before.sequence);
      expect(after.revision).toBe(before.revision);
      expect(after.queued).toEqual(before.queued);
      expect(after.flight).toEqual(before.flight);
      expect(after.blocked).toBeDefined();
      expect(f.sent).toEqual([]);
    });

for (const resource of ['follows', 'progress'] as const)
  test(`recovery_required preserves the exact frozen ${resource} request`, async () => {
    const f = await fixture((state) => {
      if (resource === 'follows') {
        queueFollow(state.follows, '99', true);
        freezeFollows(state.follows);
      } else {
        queueProgress(state.progress, episodeId, 'checkpoint', 120);
        freezeProgress(state.progress);
      }
    });
    f.responses.follows = membership(oldScope);
    f.responses.progress = progress(oldScope);
    const before = (await f.read())[resource];
    if (!before.flight) throw new Error('Frozen request missing');
    await f.refresh();
    const after = (await f.read())[resource];
    expect(f.sent).toEqual([before.flight.batch]);
    expect(after.flight).toEqual(before.flight);
    expect(after.clientId).toBe(before.clientId);
    expect(after.sequence).toBe(before.sequence);
    expect(after.scope).toEqual(oldScope);
    expect(after.blocked).toBeDefined();
  });

for (const [name, response] of [
  ['malformed', { ...membership(), items: null }],
  ['wrong account', membership({ ...currentScope, accountId: 'other' })],
  [
    'duplicate IDs',
    { ...membership(), items: [membership().items[0], membership().items[0]] },
  ],
  ['item beyond revision head', { ...membership(), revision: '24' }],
] as const)
  test(`${name} response cannot reset saved follow state`, async () => {
    const f = await fixture();
    const before = (await f.read()).follows;
    f.responses.follows = response;
    await f.refresh();
    const { blocked, ...after } = (await f.read()).follows;
    expect(after).toEqual(before);
    expect(blocked).toBeDefined();
    expect(f.sent).toEqual([]);
  });

test('same-generation follow revision regression remains fenced', async () => {
  const f = await fixture();
  f.responses.follows = membership(oldScope, '24');
  const before = (await f.read()).follows;
  await f.refresh();
  const after = (await f.read()).follows;
  expect(after.snapshot).toEqual(before.snapshot);
  expect(after.scope).toEqual(oldScope);
  expect(after.revision).toBe('25');
  expect(after.blocked).toBeDefined();
  expect(f.sent).toEqual([]);
});

test('idle progress adopts a validated generation and replaces obsolete cached positions', async () => {
  const f = await fixture(({ progress }) => {
    progress.blocked = 'Invalid or stale progress snapshot';
    progress.saved['302'] = {
      episodeId: '302',
      positionSeconds: 300,
      completed: false,
    };
  });
  const before = (await f.read()).progress;
  await f.refresh();
  const after = (await f.read()).progress;
  expect(after.scope).toEqual(currentScope);
  expect(after.blocked).toBeUndefined();
  expect(after.clientId).not.toBe(before.clientId);
  expect(after.saved).toEqual({
    [episodeId]: { episodeId, positionSeconds: 80, completed: false },
  });
  expect(f.sent).toEqual([]);
});

test('invalid direct progress reads retain all local state', async () => {
  const f = await fixture(({ progress }) => {
    queueProgress(progress, episodeId, 'checkpoint', 120);
  });
  const before = await f.storage.load();
  f.responses.progress = progress({ ...currentScope, accountId: 'other' });
  await expect(f.sync.readProgress([episodeId])).rejects.toThrow();
  expect(await f.storage.load()).toEqual(before);
  expect(f.sent).toEqual([]);
});

test('the recent-progress probe cannot retire an acknowledged flight for an episode outside its result', async () => {
  const f = await fixture(({ progress }) => {
    queueProgress(progress, episodeId, 'checkpoint', 120);
    freezeProgress(progress);
    if (!progress.flight) throw new Error('Progress flight missing');
    const { changes, ...batch } = progress.flight.batch;
    acknowledgeProgress(progress, {
      ...batch,
      revision: '26',
      results: changes.map(({ episodeId }) => ({
        episodeId,
        status: 'applied',
      })),
    });
  });
  f.responses.follows = membership(oldScope);
  f.responses.progress = (path: string): ProgressSnapshot => {
    const own = path.includes('episodeIds=');
    return {
      ...oldScope,
      revision: '27',
      items: [
        {
          episodeId: own ? episodeId : '302',
          progress: {
            positionSeconds: own ? 120 : 330,
            completed: false,
            revision: own ? '26' : '27',
            updatedAtMs: null,
          },
        },
      ],
    };
  };
  await f.refresh();
  expect(f.requests).toContain(
    `GET /progress?view=state&episodeIds=${episodeId}`,
  );
  expect((await f.read()).progress.saved).toEqual({
    [episodeId]: { episodeId, positionSeconds: 120, completed: false },
    '302': { episodeId: '302', positionSeconds: 330, completed: false },
  });
  expect((await f.read()).progress.flight).toBeUndefined();
  expect(f.sent).toEqual([]);
});

test('a delayed old-generation import resolution cannot enqueue a stale ID or consume its source', async () => {
  const f = await fixture();
  await f.storage.update((root) => {
    root.legacyFollows = {
      source: { feed },
      unresolved: [feed],
      activated: true,
    };
  });
  await f.sync.reload();
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<unknown>();
  const request = f.api.request;
  f.api.request = async (path, method, body) => {
    if (path !== '/subscriptions/resolve') return request(path, method, body);
    expect(body).toEqual({ ...oldScope, feedUrls: [feed] });
    started.resolve();
    return response.promise;
  };
  const resolution = f.sync.resolveFeeds([feed], true);
  await started.promise;
  await f.refresh();
  expect((await f.read()).follows.scope).toEqual(currentScope);
  response.resolve({
    ...oldScope,
    items: [
      {
        index: 0,
        podcastId: '99',
        status: 'resolved',
        retryAfterSeconds: null,
      },
    ],
  });
  expect(await resolution).toEqual({ succeeded: 0, failed: [feed] });
  await f.sync.refresh();
  const root = await f.storage.load();
  const follows = root.accounts[oldScope.accountId].follows;
  expect(follows.scope).toEqual(currentScope);
  expect(follows.queued).toEqual([]);
  expect(follows.flight).toBeUndefined();
  expect(follows.blocked).toBeUndefined();
  expect(follows.importFailures).toEqual([feed]);
  expect(follows.importRetryAt?.[feed]).toBeGreaterThan(123456);
  expect(root.legacyFollows?.unresolved).toEqual([feed]);
  expect(f.sent).toEqual([]);
});
