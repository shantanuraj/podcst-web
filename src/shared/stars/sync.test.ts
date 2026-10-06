import { beforeEach, describe, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { ApiError } from '@/data/api';
import type {
  ListAcknowledgement,
  ListBatch,
  ListSnapshot,
} from '@/shared/lists';
import type { IEpisodeInfo } from '@/types';
import { browserStorage } from './browser';
import {
  acknowledge,
  emptyScope,
  enqueue,
  freeze,
  hydratePage,
  installSnapshot,
  mergeGuest,
  project,
  type StarRoot,
  scopeIn,
} from './state';
import { type StarAPI, type StarStorage, StarSync } from './sync';

const id = '0c339753-cb50-477c-843e-e641b414a060';
const episode = (id: number) =>
  ({
    id,
    guid: 'shared',
    feed: 'https://example.invalid/rss',
    title: `Episode ${id}`,
    file: { url: 'https://example.invalid/audio.mp3' },
  }) as IEpisodeInfo;
const snapshot = (ids: number[], revision = '1'): ListSnapshot => ({
  listId: id,
  revision,
  items: ids.map((episodeId) => ({
    episodeId,
    addedAt: episodeId,
    availability: 'available',
  })),
});
const ack = (batch: ListBatch, revision = '1'): ListAcknowledgement => ({
  ...batch,
  listId: id,
  revision,
  results: batch.changes.map(({ episodeId }) => ({
    episodeId,
    status: 'applied',
  })),
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

function fixture(storage: StarStorage = browserStorage()) {
  let online = false;
  let remote = snapshot([]);
  const sent: ListBatch[] = [];
  const api: StarAPI = {
    lists: async () => [
      { id, kind: 'starred', name: null, revision: '1', itemCount: 0 },
    ],
    membership: async () => structuredClone(remote),
    episodes: async () => ({
      ...remote,
      items: remote.items.map((member) => ({
        ...member,
        episode: episode(member.episodeId),
      })),
      nextCursor: null,
    }),
    changes: async (_, batch) => {
      sent.push(batch);
      remote = snapshot(
        batch.changes
          .filter(({ op }) => op === 'add')
          .map(({ episodeId }) => episodeId),
      );
      return ack(batch);
    },
  };
  const make = () =>
    new StarSync(storage, api, async (work) => {
      if (online) await work();
    });
  return {
    storage,
    api,
    sent,
    make,
    online: () => {
      online = true;
    },
    remote: (value: ListSnapshot) => {
      remote = value;
    },
  };
}

describe('durable web stars', () => {
  test('canonical IDs distinguish identical GUIDs and survive URL changes', () => {
    const state = emptyScope();
    enqueue(state, 1, 'add', 1, episode(1));
    enqueue(state, 2, 'add', 2, episode(2));
    enqueue(state, 1, 'add', 3, {
      ...episode(1),
      feed: 'https://changed.invalid',
    });
    expect(project(state).map(({ episodeId }) => episodeId)).toEqual([2, 1]);
    expect(project(state)[1].addedAt).toBe(1);
    expect(() => enqueue(state, NaN, 'add', 1)).toThrow();
    expect(() => enqueue(state, 0, 'add', 1)).toThrow();
  });

  test('guest transfer and new taps serialize across independent IndexedDB connections', async () => {
    const first = browserStorage();
    const second = browserStorage();
    await first.update((root) =>
      enqueue(scopeIn(root, null), 1, 'add', 1, episode(1)),
    );
    await Promise.all([
      first.update((root) => mergeGuest(root, 'owner')),
      second.update((root) => enqueue(scopeIn(root, 'owner'), 1, 'remove', 2)),
    ]);
    const root = await second.load();
    expect(root.guest).toBeUndefined();
    expect(project(root['account:owner'])).toEqual([]);
    expect(root['account:owner'].queued.map(({ op }) => op)).toEqual([
      'add',
      'remove',
    ]);
    await second.update((root) => mergeGuest(root, 'other'));
    expect(root['account:other']).toBeUndefined();
  });

  test('failed guest transactions retain the original guest work', async () => {
    const storage = browserStorage();
    await storage.update((root) => enqueue(scopeIn(root, null), 1, 'add', 1));
    await expect(
      storage.update((root) => {
        mergeGuest(root, 'owner');
        throw new Error('Crash');
      }),
    ).rejects.toThrow('Crash');
    const root = await storage.load();
    expect(project(root.guest)).toHaveLength(1);
    expect(root['account:owner']).toBeUndefined();
  });

  test('does not publish a tap whose durable write failed', async () => {
    const f = fixture();
    let fail = false;
    const storage: StarStorage = {
      load: f.storage.load,
      update: (change) =>
        fail
          ? Promise.reject(new Error('Disk full'))
          : f.storage.update(change),
    };
    const sync = new StarSync(storage, f.api, async () => {});
    await sync.activate(null);
    fail = true;
    await sync.edit(1, 'add', episode(1));
    expect(project(sync.getSnapshot().state!)).toEqual([]);
    expect(sync.getSnapshot().error).toContain('Unable to save');
  });

  test('freezes exact batches and leaves rapid toggles behind them', () => {
    const state = { ...emptyScope(), listId: id };
    enqueue(state, 1, 'add', 1);
    const frozen = structuredClone(freeze(state));
    enqueue(state, 1, 'remove', 2);
    enqueue(state, 1, 'add', 3);
    expect(freeze(state)).toEqual(frozen);
    expect(state.queued).toHaveLength(2);
    expect(state.sequence).toBe('1');
  });

  test('bounds batches at 100 and never rounds bigint sequences', () => {
    const state = { ...emptyScope(), listId: id, sequence: '9007199254740992' };
    for (let n = 1; n <= 101; n++) enqueue(state, n, 'add', n);
    expect(freeze(state)?.batch.sequence).toBe('9007199254740993');
    expect(state.flight?.batch.changes).toHaveLength(100);
    expect(state.queued).toHaveLength(1);
  });

  test('lost acknowledgements replay identically without restoring another device removal', async () => {
    const f = fixture();
    const sync = f.make();
    await sync.activate('owner');
    await sync.edit(1, 'add', episode(1));
    let original: ListBatch;
    let first = true;
    f.api.changes = async (_, batch) => {
      if (first) {
        first = false;
        original = structuredClone(batch);
        throw new Error('Lost response');
      }
      expect(batch).toEqual(original);
      return ack(batch);
    };
    f.online();
    await sync.refresh();
    f.remote(snapshot([], '2'));
    const restarted = f.make();
    await restarted.activate('owner');
    await restarted.refresh();
    expect(project(restarted.getSnapshot().state!)).toEqual([]);
    expect(restarted.getSnapshot().state?.flight).toBeUndefined();
    expect(restarted.getSnapshot().state?.sequence).toBe('1');
  });

  test('persists acknowledgements through failed snapshots and restart without reposting', async () => {
    const f = fixture();
    const sync = f.make();
    await sync.activate('owner');
    await sync.edit(1, 'add', episode(1));
    f.api.membership = async () => {
      throw new Error('Offline');
    };
    f.online();
    await sync.refresh();
    expect(sync.getSnapshot().state?.flight?.ack).toBeDefined();
    expect(project(sync.getSnapshot().state!)).toHaveLength(1);
    f.api.membership = async () => snapshot([1]);
    const restarted = f.make();
    await restarted.activate('owner');
    await restarted.refresh();
    expect(f.sent).toHaveLength(1);
    expect(restarted.getSnapshot().state?.flight).toBeUndefined();
  });

  test('account changes hide metadata but retain account-bound pending work', async () => {
    const f = fixture();
    const sync = f.make();
    await sync.activate(null);
    await sync.edit(1, 'add', episode(1));
    await sync.activate('owner');
    expect(project(sync.getSnapshot().state!)).toHaveLength(1);
    await sync.activate('other');
    expect(project(sync.getSnapshot().state!)).toEqual([]);
    const saved = (await f.storage.load())['account:owner'];
    expect(saved.queued).toHaveLength(1);
    expect(saved.episodes).toEqual({});
    await sync.activate('owner');
    expect(sync.getSnapshot().state?.queued).toHaveLength(1);
    expect(project(sync.getSnapshot().state!)[0].episode).toBeNull();
  });

  test('late reads cannot overwrite another account or start its writes', async () => {
    const f = fixture();
    const sync = f.make();
    await sync.activate('owner');
    const delayed = Promise.withResolvers<ListSnapshot>();
    const started = Promise.withResolvers<void>();
    f.api.membership = async () => {
      started.resolve();
      return delayed.promise;
    };
    f.online();
    const reading = sync.refresh();
    await started.promise;
    await sync.activate(null);
    delayed.resolve(snapshot([1]));
    await reading;
    expect(sync.getSnapshot().scope).toBeNull();
    expect(project(sync.getSnapshot().state!)).toEqual([]);
    expect(f.sent).toEqual([]);
  });

  test('protocol conflicts persist a stopped stream, not a new identity', async () => {
    const f = fixture();
    const sync = f.make();
    await sync.activate('owner');
    await sync.edit(1, 'add', episode(1));
    f.api.changes = async () => {
      throw new ApiError(409, 'Conflict');
    };
    f.online();
    await sync.refresh();
    const before = sync.getSnapshot().state!;
    expect(before.blocked).toBe(409);
    const restarted = f.make();
    await restarted.activate('owner');
    await restarted.refresh();
    expect(restarted.getSnapshot().state?.flight).toEqual(before.flight);
    expect(restarted.getSnapshot().state?.clientId).toBe(before.clientId);
  });

  test('terminal failures retire optimistic success while newer intents survive', () => {
    const state = { ...emptyScope(), listId: id };
    enqueue(state, 1, 'add', 1, episode(1));
    const flight = freeze(state)!;
    acknowledge(state, {
      ...ack(flight.batch),
      results: [{ episodeId: 1, status: 'not_found' }],
    });
    expect(project(state)).toEqual([]);
    expect(state.failures).toEqual([1]);
    enqueue(state, 2, 'add', 2, episode(2));
    installSnapshot(state, snapshot([]));
    expect(project(state).map(({ episodeId }) => episodeId)).toEqual([2]);
  });

  test('rejects stale, malformed and incomplete snapshots without retiring the overlay', () => {
    const state = { ...emptyScope(), listId: id };
    enqueue(state, 1, 'add', 1);
    acknowledge(state, ack(freeze(state)!.batch, '3'));
    expect(() => installSnapshot(state, snapshot([], '2'))).toThrow();
    expect(() =>
      installSnapshot(state, { ...snapshot([], '3'), items: null as never }),
    ).toThrow();
    expect(() => installSnapshot(state, snapshot([1, 1], '3'))).toThrow();
    expect(project(state)).toHaveLength(1);
    expect(state.flight?.ack).toBeDefined();
  });

  test('display pages cannot create or delete memberships; revocation invalidates metadata', () => {
    const state = { ...emptyScope(), listId: id };
    state.episodes[1] = episode(1);
    installSnapshot(state, snapshot([1, 2]));
    hydratePage(state, {
      ...snapshot([]),
      items: [
        {
          episodeId: 1,
          addedAt: 1,
          availability: 'unavailable',
          episode: null,
        },
      ],
      nextCursor: null,
    });
    expect(project(state)).toHaveLength(2);
    expect(state.episodes[1]).toBeUndefined();
    hydratePage(state, {
      ...snapshot([], '0'),
      items: [
        {
          episodeId: 1,
          addedAt: 1,
          availability: 'available',
          episode: episode(1),
        },
      ],
      nextCursor: null,
    });
    expect(state.episodes[1]).toBeUndefined();
    installSnapshot(state, snapshot([]));
    expect(project(state)).toEqual([]);
  });
});
