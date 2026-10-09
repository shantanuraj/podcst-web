import { beforeEach, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { browserStateStorage } from '@/data/state-storage';
import { FEED_LIMITS } from '@/shared/feed-contract';
import type { IPodcastEpisodesInfo } from '@/types';
import { createSubscriptions } from './useSubscriptions';

let useSubscriptions: ReturnType<typeof createSubscriptions>;
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  useSubscriptions = createSubscriptions();
});

test('guest imports survive restart and over-cap additions cannot consume pending work', async () => {
  const feeds = Array.from(
    { length: FEED_LIMITS.opml.pendingPerScope },
    (_, i) => `https://example.invalid/${i}`,
  );
  await useSubscriptions.getState().stageImports(feeds);
  await expect(
    useSubscriptions
      .getState()
      .stageImports(['https://example.invalid/overflow']),
  ).rejects.toThrow();
  expect((await browserStateStorage().load()).guest.imports).toEqual(feeds);
  await useSubscriptions.getState().stageImports([feeds[0]]);
  expect((await browserStateStorage().load()).guest.imports).toEqual(feeds);
});

test('guest resolution is atomic with membership and fences retired callbacks', async () => {
  const feed = 'https://example.invalid/a';
  const info = {
    id: '9007199254740993',
    feed,
    episodes: [],
  } as unknown as IPodcastEpisodesInfo;
  await useSubscriptions.getState().stageImports([feed]);
  await useSubscriptions.getState().addSubscriptions([info], () => false, feed);
  let root = await browserStateStorage().load();
  expect(root.guest.follows).toEqual([]);
  expect(root.guest.imports).toEqual([feed]);
  await useSubscriptions.getState().addSubscriptions([info], () => true, feed);
  root = await browserStateStorage().load();
  expect(root.guest.imports).toEqual([]);
  expect(root.guest.follows).toEqual(['9007199254740993']);
});

test('older larger guest pending sets are preserved and remain retryable', async () => {
  const feeds = Array.from(
    { length: FEED_LIMITS.opml.pendingPerScope + 1 },
    (_, i) => `https://example.invalid/${i}`,
  );
  await browserStateStorage().update((root) => {
    root.guest.imports = feeds;
  });
  await useSubscriptions.getState().stageImports(feeds);
  expect(useSubscriptions.getState().imports).toEqual(feeds);
  await expect(
    useSubscriptions.getState().stageImports(['https://example.invalid/new']),
  ).rejects.toThrow();
  expect((await browserStateStorage().load()).guest.imports).toEqual(feeds);
});
