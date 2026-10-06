import { expect, test } from 'bun:test';
import { runBrowserFixture } from './lib/browser-fixture';

const chrome = process.env.CHROME_BIN;

test.skipIf(!chrome)(
  'browser refresh restores cross-device progress without promoting stale playback',
  async () => {
    if (!chrome) throw new Error('CHROME_BIN required');
    let current: unknown = null;
    let failNext = false;
    const writes: unknown[] = [];
    const outcome = await runBrowserFixture({
      chrome,
      entrypoint: new URL(
        './fixtures/playback-sync-browser.tsx',
        import.meta.url,
      ),
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/phone') {
          current = await request.json();
          return Response.json({});
        }
        if (path === '/fail') {
          failNext = true;
          return Response.json({});
        }
        if (path === '/writes') return Response.json(writes);
        if (path === '/api/progress') {
          if (request.method === 'GET') return Response.json(current);
          const update = await request.json();
          writes.push(update);
          if (failNext) {
            failNext = false;
            return Response.json({ message: 'Unavailable' }, { status: 503 });
          }
          return Response.json({ success: true });
        }
      },
    });
    expect(outcome.checks).toEqual({
      restoredDifferentEpisode: true,
      restoredSameEpisode: true,
      preservedQueue: true,
      unchangedRefreshIsReadOnly: true,
      unsavedProgressFlushed: true,
      failedSaveRetried: true,
      completionSaved: true,
    });
    expect(outcome.requests.filter((path) => path === '/')).toHaveLength(2);
    expect(writes).toEqual([
      { episodeId: 2, position: 1439, completed: false },
      { episodeId: 2, position: 2101, completed: false },
      { episodeId: 2, position: 2140, completed: false },
      { episodeId: 2, position: 2140, completed: false },
      { episodeId: 2, position: 3600, completed: true },
    ]);
  },
  60_000,
);
