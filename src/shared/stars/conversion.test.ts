import { beforeEach, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, get, set } from 'idb-keyval';
import { browserStorage } from './browser';
import { convertStars } from './conversion';
import { project } from './state';
import { type StarAPI, StarSync } from './sync';

const wire = {
  protocol: 1 as const,
  accountId: 'owner',
  generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
};
const clientId = 'a7a2e014-b64f-4487-9c92-71cd59fc0cf7';
const listId = '0c339753-cb50-477c-843e-e641b414a060';
const batch = {
  clientId,
  sequence: '4',
  changes: [{ op: 'add' as const, episodeId: 12 }],
};
const legacy = () => ({
  'account:owner': {
    clientId,
    sequence: '4',
    listId,
    queued: [{ op: 'remove', episodeId: 12, at: 2 }],
    episodes: {},
    failures: [],
    flight: {
      batch,
      intents: [{ ...batch.changes[0], at: 1 }],
      ack: {
        clientId,
        sequence: '4',
        listId,
        revision: '2',
        results: [{ episodeId: 12, status: 'applied' }],
      },
    },
  },
});
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
test('accepted-but-not-installed numeric flight uses unchanged bridge before new string work', async () => {
  const source = legacy();
  const original = structuredClone(source);
  const oldStore = createStore('podcst-lists', 'state');
  await set('root', source, oldStore);
  const sent: unknown[] = [];
  let revision = '3';
  const api: StarAPI = {
    lists: async () => ({
      ...wire,
      lists: [
        { id: listId, kind: 'starred', name: null, revision, itemCount: 0 },
      ],
    }),
    migration: async (_id, scope, frozen) => {
      expect(scope).toEqual(wire);
      expect(frozen).toEqual(batch);
      expect(typeof frozen.changes[0].episodeId).toBe('number');
      sent.push(frozen);
      return {
        ...wire,
        clientId,
        sequence: '4',
        listId,
        revision: '2',
        results: [{ episodeId: '12', status: 'applied' }],
      };
    },
    changes: async (_id, next) => {
      sent.push(next);
      revision = '4';
      return {
        ...wire,
        clientId,
        sequence: next.sequence,
        listId,
        revision,
        results: [{ episodeId: '12', status: 'unchanged' }],
      };
    },
    membership: async () => ({ ...wire, listId, revision, items: [] }),
    episodes: async () => ({
      ...wire,
      listId,
      revision,
      items: [],
      nextCursor: null,
    }),
  };
  const storage = browserStorage();
  const sync = new StarSync(storage, api, (work) => work());
  await sync.activate('owner');
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual({
    ...wire,
    clientId,
    sequence: '5',
    changes: [{ op: 'remove', episodeId: '12' }],
  });
  expect((await storage.load())['account:owner'].legacy).toBeUndefined();
  expect(await get<unknown>('root', oldStore)).toEqual(original);
  expect(
    (await get('root', createStore('podcst-lists-v2', 'state'))).source,
  ).toEqual(original);
});
test('unsafe frozen numeric identity stays blocked and is never guessed or bridged', async () => {
  const source = legacy();
  source['account:owner'].flight.batch = {
    ...batch,
    changes: [{ op: 'add', episodeId: 9007199254740992 }],
  };
  await set('root', source, createStore('podcst-lists', 'state'));
  const state = (await browserStorage().load())['account:owner'];
  expect(state.blocked).toBe(409);
  expect(state.legacy).toBeUndefined();
  expect(state.unresolved).toContainEqual(source['account:owner'].flight);
  expect(state.clientId).toBe(clientId);
  expect(state.sequence).toBe('4');
});
test('conversion transaction failure retains original source and retries idempotently', async () => {
  const oldStore = createStore('podcst-lists', 'state');
  await set('root', legacy(), oldStore);
  const storage = browserStorage();
  await expect(
    storage.update((root) => {
      delete root['account:owner'];
      throw new Error('Crash');
    }),
  ).rejects.toThrow();
  const restart = await browserStorage().load();
  expect(restart['account:owner'].legacy?.batch).toEqual(batch);
  expect(await get<unknown>('root', oldStore)).toEqual(legacy());
});
test('invalid source is not activated as an empty collection', async () => {
  const oldStore = createStore('podcst-lists', 'state');
  await set('root', { 'account:owner': { queued: 'damaged' } }, oldStore);
  await expect(browserStorage().load()).rejects.toThrow();
  expect(
    await get('root', createStore('podcst-lists-v2', 'state')),
  ).toBeUndefined();
});
test('safe queued IDs stage exactly while unresolved source is retained', () => {
  const source = legacy();
  source['account:owner'].queued.push({
    op: 'add',
    episodeId: 9007199254740992,
    at: 4,
  });
  const state = convertStars(source)['account:owner'];
  expect(state.unresolved).toHaveLength(1);
  expect(state.queued[0].episodeId).toBe('12');
  expect(project(state)).toEqual([]);
});

test('confirmed terminal erase removes archived account flights and fences reactivation', async () => {
  const oldStore = createStore('podcst-lists', 'state');
  await set('root', legacy(), oldStore);
  const storage = browserStorage();
  await storage.load();
  await storage.erase?.('owner');
  expect((await storage.load())['account:owner']).toBeUndefined();
  expect(await get<unknown>('root', oldStore)).toEqual({});
  await expect(
    storage.update((root) => {
      root['account:owner'] = convertStars(legacy())['account:owner'];
    }),
  ).rejects.toThrow('terminally erased');
});
