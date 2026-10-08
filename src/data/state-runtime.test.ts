import { beforeEach, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import type {
  FollowBatch,
  ProgressBatch,
  StateScope,
} from '@/shared/state-contract';
import { followProjection } from '@/shared/subscriptions/follow-outbox';
import { ApiError } from './api';
import {
  freezeProgress,
  progressProjection,
  queueProgress,
} from './progress-outbox';
import { StateRuntime, type StateTransport } from './state-runtime';
import {
  accountState,
  browserStateStorage,
  convertGuestFollows,
  unionGuestFollows,
} from './state-storage';

const scope: StateScope = {
  protocol: 1,
  accountId: 'a',
  generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
};
const id = '9007199254740993';
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
test('opaque account IDs cannot alias inherited object properties', async () => {
  const storage = browserStateStorage();
  for (const account of ['__proto__', 'constructor', 'toString']) {
    await storage.update((root) => {
      accountState(root, account);
    });
    const root = await storage.load();
    expect(Object.hasOwn(root.accounts, account)).toBe(true);
    expect(root.accounts[account].progress.queued).toEqual([]);
    expect(root.accounts[account].follows.queued).toEqual([]);
  }
});

function fixture() {
  const storage = browserStateStorage();
  let online = false;
  let revision = 0;
  let position = 0;
  let completed = false;
  let followed = false;
  const sent: unknown[] = [];
  const requests: string[] = [];
  const ledger = new Map<string, unknown>();
  const api: StateTransport = {
    request: async (path, _method, body) => {
      requests.push(`${_method ?? 'GET'} ${path}`);
      if (body) {
        const batch = body as ProgressBatch | FollowBatch;
        sent.push(structuredClone(body));
        const key = `${path}:${batch.clientId}:${batch.sequence}`;
        if (ledger.has(key)) return structuredClone(ledger.get(key));
        revision++;
        const results = batch.changes.map((item) => {
          if ('episodeId' in item) {
            position = item.positionSeconds;
            completed = item.completed ?? completed;
            return { episodeId: item.episodeId, status: 'applied' };
          }
          followed = item.followed;
          return { podcastId: item.podcastId, status: 'applied' };
        });
        const { changes: _, ...stream } = batch;
        const ack = { ...stream, revision: String(revision), results };
        ledger.set(key, ack);
        return ack;
      }
      if (path.startsWith('/progress'))
        return {
          ...scope,
          revision: String(revision),
          items: path.includes('episodeIds')
            ? [
                {
                  episodeId: id,
                  progress: revision
                    ? {
                        positionSeconds: position,
                        completed,
                        revision: String(revision),
                        updatedAtMs: null,
                      }
                    : null,
                },
              ]
            : [],
        };
      return {
        ...scope,
        revision: String(revision),
        items: followed
          ? [
              {
                podcastId: id,
                revision: String(revision),
                followedAtMs: null,
                availability: 'available',
              },
            ]
          : [],
      };
    },
  };
  let tail = Promise.resolve();
  const lock = async (work: () => Promise<void>) => {
    if (!online) return;
    const task = tail.then(work);
    tail = task.catch(() => {});
    await task;
  };
  const make = (store = storage) => new StateRuntime(store, api, lock);
  return {
    storage,
    api,
    sent,
    requests,
    make,
    online: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      online = true;
    },
    remotePlayed: () => {
      completed = true;
      revision++;
    },
    remote: (next: number, follow = false) => {
      position = next;
      followed = follow;
      revision++;
    },
  };
}
test('offline restart retains progress/follows and canonical IDs; A-B-A hides work', async () => {
  const f = fixture();
  const first = f.make();
  await first.activate('a');
  await first.progress(id, 'replay', 90);
  await first.follow(id, true);
  await first.activate('b');
  expect(first.getSnapshot().state?.accounts.b).toBeUndefined();
  const restarted = f.make();
  await restarted.activate('a');
  expect(
    progressProjection((await f.storage.load()).accounts.a.progress).get(id)
      ?.positionSeconds,
  ).toBe(90);
  await f.online();
  await restarted.refresh();
  expect(f.sent).toHaveLength(2);
  expect((await f.storage.load()).accounts.a.progress.flight).toBeUndefined();
});
test('lost ack retries exact bytes without resurrecting another-device follow or rewind', async () => {
  const f = fixture();
  const first = f.make();
  await first.activate('a');
  await first.progress(id, 'replay', 90);
  const request = f.api.request;
  let lost = true;
  f.api.request = async (...args) => {
    const reply = await request(...args);
    if (args[2] && lost) {
      lost = false;
      throw new Error('Lost ack');
    }
    return reply;
  };
  await f.online();
  await first.refresh();
  f.remote(12);
  const restarted = f.make();
  await restarted.activate('a');
  expect(f.sent[1]).toEqual(f.sent[0]);
  expect(
    progressProjection((await f.storage.load()).accounts.a.progress).get(id)
      ?.positionSeconds,
  ).toBe(12);
  await restarted.follow(id, true);
  await restarted.refresh();
  expect(
    followProjection((await f.storage.load()).accounts.a.follows).has(id),
  ).toBe(true);
});
test('newer intent during flight survives ack and post-ack read', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await sync.progress(id, 'replay', 90);
  const request = f.api.request;
  const delayed = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let once = true;
  f.api.request = async (...args) => {
    const reply = await request(...args);
    if (args[2] && once) {
      once = false;
      started.resolve();
      await delayed.promise;
    }
    return reply;
  };
  await f.online();
  const run = sync.refresh();
  await started.promise;
  await sync.progress(id, 'replay', 12);
  delayed.resolve();
  await run;
  const state = (await f.storage.load()).accounts.a.progress;
  expect(state.sequence).toBe('2');
  expect(progressProjection(state).get(id)?.positionSeconds).toBe(12);
});
test('failed intent write is not projected or saved', async () => {
  const f = fixture();
  let fail = false;
  const sync = f.make({
    load: f.storage.load,
    update: (change) =>
      fail ? Promise.reject(new Error('Disk full')) : f.storage.update(change),
  });
  await sync.activate('a');
  fail = true;
  await expect(sync.progress(id, 'played', 0)).rejects.toThrow();
  expect(sync.getSnapshot().error).toContain('could not be saved');
  expect((await f.storage.load()).accounts.a).toBeUndefined();
});
for (const boundary of ['freeze', 'ack', 'read'] as const)
  test(`write failure at ${boundary} retains restartable flight`, async () => {
    const f = fixture();
    let failed = false;
    const storage = {
      load: f.storage.load,
      update: (change: Parameters<typeof f.storage.update>[0]) =>
        f.storage.update((root) => {
          const before = structuredClone(root.accounts.a?.progress);
          change(root);
          const after = root.accounts.a?.progress;
          if (
            !failed &&
            ((boundary === 'freeze' && !before?.flight && after?.flight) ||
              (boundary === 'ack' &&
                !before?.flight?.ack &&
                after?.flight?.ack) ||
              (boundary === 'read' && before?.flight?.ack && !after?.flight))
          ) {
            failed = true;
            throw new Error('Disk full');
          }
        }),
    };
    const sync = f.make(storage);
    await sync.activate('a');
    await sync.progress(id, 'played', 0);
    await f.online();
    await sync.refresh();
    expect(failed).toBe(true);
    const retained = (await f.storage.load()).accounts.a.progress;
    expect(retained.queued.length || retained.flight).toBeTruthy();
    const restart = f.make();
    await restart.activate('a');
    expect((await f.storage.load()).accounts.a.progress.flight).toBeUndefined();
    if (boundary === 'ack') expect(f.sent[0]).toEqual(f.sent[1]);
  });
test('cross-connection guest union consumes only explicit guest intent atomically', async () => {
  const a = browserStateStorage();
  const b = browserStateStorage();
  const source = {
    safe: { id: 3, episodes: [] },
    unsafe: { id: 9007199254740992, episodes: [] },
  };
  await a.update((root) => convertGuestFollows(root, source));
  await expect(
    a.update((root) => {
      unionGuestFollows(root, 'a');
      throw new Error('Crash');
    }),
  ).rejects.toThrow();
  expect((await b.load()).guest.follows).toEqual(['3']);
  await Promise.all([
    a.update((root) => unionGuestFollows(root, 'a')),
    b.update((root) => unionGuestFollows(root, 'b')),
  ]);
  const root = await a.load();
  expect(root.accounts.a.follows.queued).toHaveLength(1);
  expect(root.accounts.b.follows.queued).toEqual([]);
  expect(root.legacyFollows?.source).toEqual(source);
  expect(root.legacyFollows?.unresolved).toEqual(['unsafe']);
});
test('protocol generation failure blocks without replacing stream or frozen payload', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await sync.progress(id, 'played', 0);
  const request = f.api.request;
  f.api.request = async (...args) => {
    const reply = await request(...args);
    return args[2]
      ? { ...(reply as object), generation: crypto.randomUUID() }
      : reply;
  };
  await f.online();
  await sync.refresh();
  const before = (await f.storage.load()).accounts.a.progress;
  expect(before.blocked).toBeDefined();
  const restart = f.make();
  await restart.activate('a');
  expect((await f.storage.load()).accounts.a.progress.flight).toEqual(
    before.flight,
  );
  expect(f.sent).toHaveLength(1);
});
test('401 retains frozen work and never erases; confirmed erase fences same account', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await sync.follow(id, true);
  await f.online();
  const request = f.api.request;
  f.api.request = (...args) =>
    args[2]
      ? Promise.reject(new ApiError(401, 'Expired', 'unauthenticated'))
      : request(...args);
  await sync.refresh();
  expect((await f.storage.load()).accounts.a.follows.flight).toBeDefined();
  await sync.suspend();
  expect(sync.getSnapshot().state).toBeUndefined();
  await sync.erase('a');
  expect((await f.storage.load()).accounts.a).toBeUndefined();
  const erased = await f.storage.load();
  expect(() => accountState(erased, 'a')).toThrow();
});
test('offline unknown-completion checkpoint sends null before reading completion truth', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await sync.progress(id, 'checkpoint', 95);
  let state = (await f.storage.load()).accounts.a.progress;
  expect(state.queued[0].completed).toBeNull();
  expect(progressProjection(state).get(id)?.completed).toBe(false);
  expect(state.queued[0].positionSeconds).toBe(95);
  await f.online();
  await sync.refresh();
  state = (await f.storage.load()).accounts.a.progress;
  expect((f.sent[0] as ProgressBatch).changes[0].completed).toBeNull();
  expect(f.requests.filter((path) => path.includes('/progress'))).toEqual([
    'GET /progress?view=state&recent=1',
    'PUT /progress',
    `GET /progress?view=state&episodeIds=${id}`,
  ]);
  expect(state.saved[id].completed).toBe(false);
});
test('late response after account change cannot populate the new projection', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await sync.progress(id, 'played', 0);
  const delayed = Promise.withResolvers<unknown>();
  const started = Promise.withResolvers<void>();
  f.api.request = () => {
    started.resolve();
    return delayed.promise;
  };
  await f.online();
  const run = sync.refresh();
  await started.promise;
  await sync.activate(null);
  delayed.resolve({ ...scope, revision: '0', items: [] });
  await run;
  expect(sync.getSnapshot().account).toBeNull();
  expect((await f.storage.load()).accounts.a.progress.scope).toBeUndefined();
});

test('independent tabs serialize senders and preserve one stream sequence', async () => {
  const f = fixture();
  const a = f.make();
  const b = f.make(browserStateStorage());
  await a.activate('a');
  await b.activate('a');
  await Promise.all([a.progress(id, 'replay', 10), b.follow(id, true)]);
  await f.online();
  await Promise.all([a.refresh(), b.refresh()]);
  const root = await f.storage.load();
  expect(root.accounts.a.progress.sequence).toBe('1');
  expect(root.accounts.a.follows.sequence).toBe('1');
  expect(f.sent).toHaveLength(2);
});
test('lost follow ack cannot resurrect a later remote unfollow', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await sync.follow(id, true);
  const request = f.api.request;
  let lost = true;
  f.api.request = async (...args) => {
    const result = await request(...args);
    if (args[2] && lost) {
      lost = false;
      throw new Error('Lost ack');
    }
    return result;
  };
  await f.online();
  await sync.refresh();
  f.remote(0, false);
  const restart = f.make();
  await restart.activate('a');
  expect(f.sent[1]).toEqual(f.sent[0]);
  expect(
    followProjection((await f.storage.load()).accounts.a.follows).has(id),
  ).toBe(false);
});
test('unavailable progress transport does not stall follow sending', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await sync.progress(id, 'played', 0);
  await sync.follow(id, true);
  const request = f.api.request;
  f.api.request = (...args) =>
    args[0].startsWith('/progress')
      ? Promise.reject(new Error('Unavailable'))
      : request(...args);
  await f.online();
  await sync.refresh();
  const root = await f.storage.load();
  expect(root.accounts.a.progress.queued).toHaveLength(1);
  expect(root.accounts.a.follows.flight).toBeUndefined();
  expect(root.accounts.a.follows.sequence).toBe('1');
});
test('denied storage remains visible and is never treated as empty saved state', async () => {
  const f = fixture();
  const sync = f.make({
    load: async () => {
      throw new Error('Denied');
    },
    update: async () => {
      throw new Error('Denied');
    },
  });
  await sync.activate('a');
  expect(sync.getSnapshot().state).toBeUndefined();
  expect(sync.getSnapshot().error).toContain('Unable to open');
  await expect(sync.follow(id, true)).rejects.toThrow();
});

test('dismissing shown failures persists without removing newer failures or pending work', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await sync.progress(id, 'checkpoint', 20);
  await sync.follow(id, true);
  await f.storage.update((root) => {
    const state = accountState(root, 'a');
    state.progress.failures = [id, '2'];
    state.follows.failures = [id, '3'];
    state.progress.blocked = 'Progress needs recovery';
  });
  const before = (await f.storage.load()).accounts.a;
  await sync.dismissFailures({ progress: [id], follows: [id] });
  const restarted = f.make();
  await restarted.activate('a');
  const after = (await f.storage.load()).accounts.a;
  expect(restarted.getSnapshot().state?.accounts.a).toEqual(after);
  expect(after.progress.failures).toEqual(['2']);
  expect(after.follows.failures).toEqual(['3']);
  expect(after.progress.queued).toEqual(before.progress.queued);
  expect(after.follows.queued).toEqual(before.follows.queued);
  expect(after.progress.blocked).toBe(before.progress.blocked);
  expect(f.sent).toEqual([]);
});

test('failed notice dismissal preserves source failures and reports the device error', async () => {
  const f = fixture();
  await f.storage.update((root) => {
    accountState(root, 'a').progress.failures = [id];
  });
  const sync = f.make({
    load: f.storage.load,
    update: async () => {
      throw new Error('Disk full');
    },
  });
  await sync.activate('a');
  await expect(sync.dismissFailures({ progress: [id] })).rejects.toThrow(
    'Disk full',
  );
  expect((await f.storage.load()).accounts.a.progress.failures).toEqual([id]);
  expect(sync.getSnapshot().error).toBe(
    'This notice could not be dismissed on this device.',
  );
});

test('OPML preserves per-URL failures across restart without retrying successful resolutions', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await f.online();
  await sync.refresh();
  const request = f.api.request;
  f.api.request = async (...args) =>
    args[0] === '/subscriptions/resolve'
      ? {
          ...scope,
          items: [
            { index: 0, podcastId: id, status: 'resolved' },
            { index: 1, podcastId: null, status: 'unavailable' },
          ],
        }
      : request(...args);
  const good = 'https://good.invalid/feed';
  const bad = 'https://bad.invalid/feed';
  expect(await sync.resolveFeeds([good, bad])).toEqual({
    succeeded: 1,
    failed: [bad],
  });
  expect((await f.storage.load()).accounts.a.follows.importFailures).toEqual([
    bad,
  ]);
  await sync.refresh();
  const restart = f.make();
  await restart.activate('a');
  expect(
    restart.getSnapshot().state?.accounts.a.follows.importFailures,
  ).toEqual([bad]);
});

async function guestSelectionFixture() {
  const f = fixture();
  const sync = f.make();
  await sync.activate(null);
  await sync.progress(id, 'replay', 37);
  await sync.progress('9007199254740994', 'played', 0);
  await f.storage.update((root) => {
    accountState(root, 'a').progress.scope = scope;
  });
  await sync.activate('a');
  return {
    ...f,
    sync,
    selection: { episodeId: id, positionSeconds: 37, completed: false },
  };
}

test('selected guest position becomes NEW account intent exactly once, never on account activation', async () => {
  const f = await guestSelectionFixture();
  expect((await f.storage.load()).accounts.a.progress.queued).toEqual([]);
  const before = (await f.storage.load()).accounts.a.progress;
  await f.sync.transferGuestProgress('a', f.selection);
  const root = await f.storage.load();
  expect(root.accounts.a.progress.queued).toEqual([f.selection]);
  expect(root.accounts.a.progress.clientId).toBe(before.clientId);
  expect(progressProjection(root.guest.progress).get(id)).toBeUndefined();
  expect(
    progressProjection(root.guest.progress).get('9007199254740994'),
  ).toEqual({
    episodeId: '9007199254740994',
    positionSeconds: 0,
    completed: true,
  });
  await expect(f.sync.transferGuestProgress('a', f.selection)).rejects.toThrow(
    'selection changed',
  );
  expect((await f.storage.load()).accounts.a.progress.queued).toHaveLength(1);
});
test('selected played-at-zero tuple is transferred exactly, without changing other guest positions', async () => {
  const f = await guestSelectionFixture();
  const selected = {
    episodeId: '9007199254740994',
    positionSeconds: 0,
    completed: true,
  };
  await f.sync.transferGuestProgress('a', selected);
  const root = await f.storage.load();
  expect(root.accounts.a.progress.queued).toEqual([selected]);
  expect(progressProjection(root.guest.progress).get(id)).toEqual(f.selection);
});
test('guest-transfer transaction failure rolls back both consumption and new account intent', async () => {
  const f = await guestSelectionFixture();
  let fail = false;
  const storage = {
    load: f.storage.load,
    update: (change: Parameters<typeof f.storage.update>[0]) =>
      f.storage.update((root) => {
        change(root);
        if (fail) throw new Error('Disk full');
      }),
  };
  const sync = f.make(storage);
  await sync.activate('a');
  const before = await f.storage.load();
  fail = true;
  const error = await sync.transferGuestProgress('a', f.selection).then(
    () => null,
    (error: Error) => error.message,
  );
  expect(error).toBe('Disk full');
  expect(await f.storage.load()).toEqual(before);
  expect(sync.getSnapshot().error).toContain('not transferred');
  fail = false;
  await sync.transferGuestProgress('a', f.selection);
  expect((await f.storage.load()).accounts.a.progress.queued).toEqual([
    f.selection,
  ]);
});
test('guest transfer rejects an edited guest tuple and leaves its newer value untouched', async () => {
  const f = await guestSelectionFixture();
  const guestTab = f.make();
  await guestTab.activate(null);
  await guestTab.progress(id, 'replay', 12);
  await expect(f.sync.transferGuestProgress('a', f.selection)).rejects.toThrow(
    'selection changed',
  );
  const root = await f.storage.load();
  expect(root.accounts.a.progress.queued).toEqual([]);
  expect(progressProjection(root.guest.progress).get(id)?.positionSeconds).toBe(
    12,
  );
});
test('guest transfer requires the selected verified account, not a fresh or changed target', async () => {
  const f = await guestSelectionFixture();
  await expect(f.sync.transferGuestProgress('b', f.selection)).rejects.toThrow(
    'Verified account',
  );
  await f.sync.activate('b');
  await expect(f.sync.transferGuestProgress('b', f.selection)).rejects.toThrow(
    'Verified account',
  );
  const root = await f.storage.load();
  expect(progressProjection(root.guest.progress).get(id)).toEqual(f.selection);
  expect(root.accounts.b).toBeUndefined();
});
test('retiring an account before the queued transfer transaction runs cannot consume guest work', async () => {
  const f = await guestSelectionFixture();
  const gate = Promise.withResolvers<void>();
  let delay = false;
  const storage = {
    load: f.storage.load,
    update: (change: Parameters<typeof f.storage.update>[0]) => {
      if (delay) {
        delay = false;
        return gate.promise.then(() => f.storage.update(change));
      }
      return f.storage.update(change);
    },
  };
  const sync = f.make(storage);
  await sync.activate('a');
  delay = true;
  const transfer = sync.transferGuestProgress('a', f.selection);
  await sync.activate('b');
  gate.resolve();
  await expect(transfer).rejects.toThrow('Session retired');
  const root = await f.storage.load();
  expect(root.accounts.a.progress.queued).toEqual([]);
  expect(root.accounts.b).toBeUndefined();
  expect(progressProjection(root.guest.progress).get(id)).toEqual(f.selection);
});
test('two tabs selecting the same guest tuple cannot upload it twice', async () => {
  const f = await guestSelectionFixture();
  const second = f.make(browserStateStorage());
  await second.activate('a');
  const results = await Promise.allSettled([
    f.sync.transferGuestProgress('a', f.selection),
    second.transferGuestProgress('a', f.selection),
  ]);
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const root = await f.storage.load();
  expect(root.accounts.a.progress.queued).toEqual([f.selection]);
  expect(progressProjection(root.guest.progress).has(id)).toBe(false);
});

test('selected guest transfer restarts as the same new action and reaches the ordinary progress endpoint', async () => {
  const f = await guestSelectionFixture();
  await f.sync.transferGuestProgress('a', f.selection);
  const restart = f.make(browserStateStorage());
  await restart.activate('a');
  expect(restart.getSnapshot().state?.accounts.a.progress.queued).toEqual([
    f.selection,
  ]);
  await f.online();
  await restart.refresh();
  expect(f.sent).toHaveLength(1);
  expect((f.sent[0] as ProgressBatch).changes).toEqual([f.selection]);
  expect((f.sent[0] as ProgressBatch).sequence).toBe('1');
  expect(
    progressProjection((await f.storage.load()).guest.progress).has(id),
  ).toBe(false);
});
test('a generation change between guest selection and its transaction preserves both guest source and target', async () => {
  const f = await guestSelectionFixture();
  const gate = Promise.withResolvers<void>();
  let delay = false;
  const storage = {
    load: f.storage.load,
    update: (change: Parameters<typeof f.storage.update>[0]) => {
      if (delay) {
        delay = false;
        return gate.promise.then(() => f.storage.update(change));
      }
      return f.storage.update(change);
    },
  };
  const sync = f.make(storage);
  await sync.activate('a');
  delay = true;
  const transfer = sync.transferGuestProgress('a', f.selection);
  await f.storage.update((root) => {
    accountState(root, 'a').progress.scope = {
      ...scope,
      generation: crypto.randomUUID(),
    };
  });
  gate.resolve();
  await expect(transfer).rejects.toThrow('scope is unavailable');
  const root = await f.storage.load();
  expect(root.accounts.a.progress.queued).toEqual([]);
  expect(progressProjection(root.guest.progress).get(id)).toEqual(f.selection);
});

test('selected guest intent stays behind an existing frozen account batch without relabeling it', async () => {
  const f = await guestSelectionFixture();
  await f.storage.update((root) => {
    const progress = accountState(root, 'a').progress;
    queueProgress(progress, id, 'played', 0);
    freezeProgress(progress);
  });
  const frozen = (await f.storage.load()).accounts.a.progress.flight;
  await f.sync.transferGuestProgress('a', f.selection);
  const progress = (await f.storage.load()).accounts.a.progress;
  expect(progress.flight).toEqual(frozen);
  expect(progress.sequence).toBe('1');
  expect(progress.queued).toEqual([f.selection]);
});

test('remote played survives a local known-false checkpoint and only explicit replay clears it', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await f.online();
  await sync.refresh();
  await sync.readProgress([id]);
  expect(
    progressProjection((await f.storage.load()).accounts.a.progress).get(id)
      ?.completed,
  ).toBe(false);
  f.remotePlayed();
  await sync.progress(id, 'checkpoint', 95);
  await sync.refresh();
  expect((f.sent[0] as ProgressBatch).changes).toEqual([
    { episodeId: id, positionSeconds: 95, completed: null },
  ]);
  expect(
    progressProjection((await f.storage.load()).accounts.a.progress).get(id),
  ).toEqual({ episodeId: id, positionSeconds: 95, completed: true });
  await sync.progress(id, 'replay', 12);
  await sync.refresh();
  expect((f.sent[1] as ProgressBatch).changes).toEqual([
    { episodeId: id, positionSeconds: 12, completed: false },
  ]);
  expect(
    progressProjection((await f.storage.load()).accounts.a.progress).get(id),
  ).toEqual({ episodeId: id, positionSeconds: 12, completed: false });
});
test('null checkpoint survives lost acknowledgement and restart byte-for-byte', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await sync.progress(id, 'checkpoint', 95);
  const request = f.api.request;
  let lost = true;
  f.api.request = async (...args) => {
    const result = await request(...args);
    if (args[2] && lost) {
      lost = false;
      throw new Error('Lost acknowledgement');
    }
    return result;
  };
  await f.online();
  await sync.refresh();
  const frozen = JSON.stringify(
    (await f.storage.load()).accounts.a.progress.flight?.batch,
  );
  f.remotePlayed();
  const restart = f.make();
  await restart.activate('a');
  expect(JSON.stringify(f.sent[0])).toBe(frozen);
  expect(JSON.stringify(f.sent[1])).toBe(frozen);
  expect((f.sent[1] as ProgressBatch).changes[0].completed).toBeNull();
  expect(
    progressProjection((await f.storage.load()).accounts.a.progress).get(id)
      ?.completed,
  ).toBe(true);
});
test.each([
  true,
  false,
])('guest checkpoint selection stays concrete %s and transfers as an explicit boolean', async (completed) => {
  const f = fixture();
  const sync = f.make();
  await sync.activate(null);
  await sync.progress(id, completed ? 'played' : 'replay', 0);
  await sync.progress(id, 'checkpoint', 95);
  const selection = progressProjection(
    (await f.storage.load()).guest.progress,
  ).get(id)!;
  expect(selection).toEqual({ episodeId: id, positionSeconds: 95, completed });
  await f.storage.update((root) => {
    accountState(root, 'a').progress.scope = scope;
  });
  await sync.activate('a');
  await expect(
    sync.transferGuestProgress('a', { ...selection, completed: null } as never),
  ).rejects.toThrow('Guest selection changed');
  await sync.transferGuestProgress('a', selection);
  expect((await f.storage.load()).accounts.a.progress.queued).toEqual([
    selection,
  ]);
  expect(
    progressProjection((await f.storage.load()).guest.progress).has(id),
  ).toBe(false);
});

test('new explicit played intent survives an in-flight null checkpoint and its post-ack read', async () => {
  const f = fixture();
  const sync = f.make();
  await sync.activate('a');
  await sync.progress(id, 'checkpoint', 95);
  const request = f.api.request;
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let first = true;
  f.api.request = async (...args) => {
    const result = await request(...args);
    if (args[2] && first) {
      first = false;
      started.resolve();
      await gate.promise;
    }
    return result;
  };
  await f.online();
  const sending = sync.refresh();
  await started.promise;
  const frozen = JSON.stringify(
    (await f.storage.load()).accounts.a.progress.flight?.batch,
  );
  await sync.progress(id, 'played', 0);
  expect(
    progressProjection((await f.storage.load()).accounts.a.progress).get(id)
      ?.completed,
  ).toBe(true);
  gate.resolve();
  await sending;
  expect(JSON.stringify(f.sent[0])).toBe(frozen);
  expect((f.sent[0] as ProgressBatch).changes[0].completed).toBeNull();
  expect((f.sent[1] as ProgressBatch).changes).toEqual([
    { episodeId: id, positionSeconds: 0, completed: true },
  ]);
  expect(
    progressProjection((await f.storage.load()).accounts.a.progress).get(id)
      ?.completed,
  ).toBe(true);
});

test('known local completion survives an offline null checkpoint and IndexedDB restart', async () => {
  const f = fixture();
  await f.storage.update((root) => {
    const progress = accountState(root, 'a').progress;
    progress.scope = scope;
    progress.revision = '1';
    progress.saved[id] = { episodeId: id, positionSeconds: 0, completed: true };
  });
  const sync = f.make();
  await sync.activate('a');
  await sync.progress(id, 'checkpoint', 95);
  const restart = f.make(browserStateStorage());
  await restart.activate('a');
  const outbox = restart.getSnapshot().state?.accounts.a.progress;
  expect(outbox?.queued).toEqual([
    { episodeId: id, positionSeconds: 95, completed: null },
  ]);
  expect(outbox && progressProjection(outbox).get(id)).toEqual({
    episodeId: id,
    positionSeconds: 95,
    completed: true,
  });
  expect(f.sent).toEqual([]);
});
