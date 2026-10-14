import { beforeEach, describe, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import type { LegacyListBatch, ListBatch, ListSnapshot } from '@/shared/lists';
import type { StateScope } from '@/shared/state-contract';
import type { IEpisodeInfo } from '@/types';
import { browserStorage } from './browser';
import { emptyScope, enqueue, freeze, project, type StarScope } from './state';
import { type StarAPI, StarSync } from './sync';

const oldScope: StateScope = {
  protocol: 1,
  accountId: 'owner',
  generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
};
const nextScope: StateScope = {
  ...oldScope,
  generation: '33c0de7c-45be-4313-98db-a1bd798bc685',
};
const listId = '0c339753-cb50-477c-843e-e641b414a060';
const episode = (id: string) =>
  ({
    id,
    guid: `episode-${id}`,
    title: `Episode ${id}`,
    feed: 'https://example.invalid/feed',
    file: { url: `https://example.invalid/${id}.mp3` },
  }) as IEpisodeInfo;
const snapshot = (
  scope: StateScope,
  ids: string[],
  revision: string,
): ListSnapshot => ({
  ...scope,
  listId,
  revision,
  items: ids.map((episodeId) => ({
    episodeId,
    addedAt: Number(episodeId),
    availability: 'available',
  })),
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

async function fixture(
  prepare: (state: StarScope) => void = () => {},
  remoteScope = nextScope,
) {
  const storage = browserStorage();
  const initial: StarScope = {
    ...emptyScope(),
    wire: oldScope,
    listId,
    sequence: '7',
    revision: '9',
    snapshot: snapshot(oldScope, ['1'], '9'),
    episodes: { '1': episode('1') },
  };
  prepare(initial);
  await storage.update((root) => {
    root['account:owner'] = initial;
  });
  let remote = snapshot(remoteScope, ['2'], '1');
  const sent: ListBatch[] = [];
  const migrated: LegacyListBatch[] = [];
  const reads: string[] = [];
  const apply = (batch: ListBatch | LegacyListBatch) => {
    const ids = new Set(remote.items.map((item) => item.episodeId));
    for (const change of batch.changes) {
      if (change.op === 'add') ids.add(String(change.episodeId));
      else ids.delete(String(change.episodeId));
    }
    remote = snapshot(
      remoteScope,
      [...ids],
      String(BigInt(remote.revision) + 1n),
    );
    return {
      ...remoteScope,
      clientId: batch.clientId,
      sequence: batch.sequence,
      listId,
      revision: remote.revision,
      results: batch.changes.map(({ episodeId }) => ({
        episodeId: String(episodeId),
        status: 'applied' as const,
      })),
    };
  };
  const api: StarAPI = {
    lists: async () => {
      reads.push('lists');
      return {
        ...remoteScope,
        lists: [
          {
            id: listId,
            kind: 'starred',
            name: null,
            revision: remote.revision,
            itemCount: remote.items.length,
          },
        ],
      };
    },
    membership: async () => {
      reads.push('membership');
      return structuredClone(remote);
    },
    episodes: async () => {
      reads.push('episodes');
      return {
        ...remote,
        items: remote.items.map((item) => ({
          ...item,
          episode: episode(item.episodeId),
        })),
        nextCursor: null,
      };
    },
    changes: async (_, batch) => {
      sent.push(structuredClone(batch));
      return apply(batch);
    },
    migration: async (_, scope, batch) => {
      expect(scope).toEqual(remoteScope);
      migrated.push(structuredClone(batch));
      return apply(batch);
    },
  };
  return {
    storage,
    initial: structuredClone(initial),
    api,
    sent,
    migrated,
    reads,
    make: () => new StarSync(storage, api, (work) => work()),
    saved: async () => (await storage.load())['account:owner'],
  };
}

describe('Starred generation recovery', () => {
  test.each([
    undefined,
    409,
  ])('recovers an idle stream with block %s without uploading cached stars', async (blocked) => {
    const f = await fixture((state) => {
      if (blocked) state.blocked = blocked;
    });
    const sync = f.make();
    await sync.activate('owner');
    const recovered = await f.saved();
    expect(recovered.wire).toEqual(nextScope);
    expect(recovered.clientId).not.toBe(f.initial.clientId);
    expect(recovered.sequence).toBe('0');
    expect(recovered.revision).toBe('1');
    expect(recovered.blocked).toBeUndefined();
    expect(recovered.episodes).toEqual({ '2': episode('2') });
    expect(project(recovered).map((item) => item.episodeId)).toEqual(['2']);
    expect(sync.getSnapshot().error).toBeUndefined();
    expect(f.sent).toEqual([]);
    expect(f.migrated).toEqual([]);
    const restarted = f.make();
    await restarted.activate('owner');
    expect((await f.saved()).clientId).toBe(recovered.clientId);
    expect((await f.saved()).sequence).toBe('0');
  });

  const pending: [string, (state: StarScope) => void][] = [
    ['queued', (state) => enqueue(state, '3', 'add', 3, episode('3'))],
    [
      'unacknowledged flight',
      (state) => {
        enqueue(state, '3', 'add', 3, episode('3'));
        freeze(state);
      },
    ],
    [
      'acknowledged flight',
      (state) => {
        enqueue(state, '3', 'add', 3, episode('3'));
        const flight = freeze(state);
        if (!flight) throw new Error('Missing frozen batch');
        flight.ack = {
          ...flight.batch,
          listId,
          revision: '10',
          results: [{ episodeId: '3', status: 'applied' }],
        };
      },
    ],
    [
      'legacy flight',
      (state) => {
        state.legacy = {
          batch: {
            clientId: state.clientId,
            sequence: state.sequence,
            changes: [{ op: 'add', episodeId: 3 }],
          },
        };
      },
    ],
    [
      'unresolved work',
      (state) => {
        state.unresolved = [{ episodeId: 9007199254740992, op: 'add' }];
      },
    ],
  ];

  test.each(
    pending,
  )('preserves %s and does not send it across a generation change', async (_, prepare) => {
    const f = await fixture(prepare);
    await f.make().activate('owner');
    expect(await f.saved()).toEqual({ ...f.initial, blocked: 409 });
    expect(f.sent).toEqual([]);
    expect(f.migrated).toEqual([]);
  });

  test('retains a same-generation block and its existing stream identity', async () => {
    const f = await fixture((state) => {
      state.blocked = 409;
    }, oldScope);
    await f.make().activate('owner');
    expect(await f.saved()).toEqual(f.initial);
    expect(f.reads).toContain('lists');
    expect(f.sent).toEqual([]);
    expect(f.migrated).toEqual([]);
  });

  test('keeps the stream identity when an ordinary refresh stays in the same generation', async () => {
    const f = await fixture((state) => {
      state.revision = '0';
      state.snapshot = snapshot(oldScope, ['1'], '0');
    }, oldScope);
    await f.make().activate('owner');
    const saved = await f.saved();
    expect(saved.wire).toEqual(oldScope);
    expect(saved.clientId).toBe(f.initial.clientId);
    expect(saved.sequence).toBe('7');
    expect(saved.revision).toBe('1');
    expect(saved.blocked).toBeUndefined();
    expect(project(saved).map((item) => item.episodeId)).toEqual(['2']);
    expect(f.sent).toEqual([]);
  });

  test('keeps the prior state when loading the new membership fails', async () => {
    const f = await fixture();
    f.api.membership = async () => {
      throw new Error('Offline');
    };
    const sync = f.make();
    await sync.activate('owner');
    expect(await f.saved()).toEqual(f.initial);
    expect(sync.getSnapshot().error).toBeDefined();
    expect(f.sent).toEqual([]);
    expect(f.migrated).toEqual([]);
  });

  const invalidSnapshots: [string, (value: ListSnapshot) => ListSnapshot][] = [
    ['another account', (value) => ({ ...value, accountId: 'other' })],
    [
      'another generation',
      (value) => ({ ...value, generation: oldScope.generation }),
    ],
    [
      'another list',
      (value) => ({ ...value, listId: '9d5a4da9-3cc3-46c9-96fd-f359c8782568' }),
    ],
    ['an invalid revision', (value) => ({ ...value, revision: '-1' })],
    [
      'duplicate members',
      (value) => ({ ...value, items: [...value.items, ...value.items] }),
    ],
    ['missing members', (value) => ({ ...value, items: undefined as never })],
    ['a null member', (value) => ({ ...value, items: [null as never] })],
  ];

  test.each(
    invalidSnapshots,
  )('refuses recovery with %s without replacing saved state', async (_, change) => {
    const f = await fixture();
    f.api.membership = async () => change(snapshot(nextScope, ['2'], '1'));
    await f.make().activate('owner');
    expect(await f.saved()).toEqual({ ...f.initial, blocked: 409 });
    expect(f.sent).toEqual([]);
    expect(f.migrated).toEqual([]);
  });

  test('refuses a lists envelope for another account', async () => {
    const f = await fixture();
    const lists = f.api.lists;
    f.api.lists = async () => ({ ...(await lists()), accountId: 'other' });
    await f.make().activate('owner');
    expect(await f.saved()).toEqual({ ...f.initial, blocked: 409 });
    expect(f.sent).toEqual([]);
  });

  test('retains a tap made while the recovery snapshot is loading', async () => {
    const f = await fixture();
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<ListSnapshot>();
    f.api.membership = async () => {
      started.resolve();
      return response.promise;
    };
    const sync = f.make();
    const activating = sync.activate('owner');
    await started.promise;
    const queued = Promise.withResolvers<void>();
    const unsubscribe = sync.subscribe(() => {
      if (sync.getSnapshot().state?.queued.length) queued.resolve();
    });
    const editing = sync.edit('3', 'add', episode('3'));
    await queued.promise;
    unsubscribe();
    const edited = structuredClone(await f.saved());
    response.resolve(snapshot(nextScope, ['2'], '1'));
    await Promise.all([activating, editing]);
    expect(await f.saved()).toEqual({ ...edited, blocked: 409 });
    expect(f.sent).toEqual([]);
    expect(f.migrated).toEqual([]);
  });

  test('does not adopt a recovery response after the account retires', async () => {
    const f = await fixture();
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<ListSnapshot>();
    f.api.membership = async () => {
      started.resolve();
      return response.promise;
    };
    const sync = f.make();
    const activating = sync.activate('owner');
    await started.promise;
    await sync.activate(null);
    const retired = structuredClone(await f.saved());
    response.resolve(snapshot(nextScope, ['2'], '1'));
    await activating;
    expect(await f.saved()).toEqual(retired);
    expect(sync.getSnapshot().scope).toBeNull();
    expect(f.sent).toEqual([]);
    expect(f.migrated).toEqual([]);
  });

  test.each([
    'queued',
    'legacy',
  ] as const)('initializes an unscoped stream with %s work without dropping it', async (kind) => {
    const f = await fixture((state) => {
      delete state.wire;
      delete state.snapshot;
      state.revision = '0';
      state.sequence = '0';
      if (kind === 'queued') enqueue(state, '3', 'add', 3, episode('3'));
      else {
        state.sequence = '4';
        state.legacy = {
          batch: {
            clientId: state.clientId,
            sequence: '4',
            changes: [{ op: 'add', episodeId: 3 }],
          },
        };
      }
    });
    await f.make().activate('owner');
    const saved = await f.saved();
    expect(saved.wire).toEqual(nextScope);
    expect(saved.clientId).toBe(f.initial.clientId);
    expect(saved.blocked).toBeUndefined();
    expect(saved.queued).toEqual([]);
    expect(saved.flight).toBeUndefined();
    expect(saved.legacy).toBeUndefined();
    expect(project(saved).map((item) => item.episodeId)).toEqual(['3', '2']);
    expect(f.sent).toHaveLength(kind === 'queued' ? 1 : 0);
    expect(f.migrated).toHaveLength(kind === 'legacy' ? 1 : 0);
    if (kind === 'legacy') {
      const legacy = f.initial.legacy;
      if (!legacy) throw new Error('Missing legacy fixture');
      expect(f.migrated[0]).toEqual(legacy.batch);
    }
  });
});
