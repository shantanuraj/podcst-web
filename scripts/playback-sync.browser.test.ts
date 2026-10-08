import { expect, test } from 'bun:test';
import type { ProgressBatch } from '../src/shared/state-contract';
import { runBrowserFixture } from './lib/browser-fixture';

const chrome = process.env.CHROME_BIN;

test.skipIf(!chrome)(
  'browser refresh restores cross-device progress without promoting stale playback',
  async () => {
    if (!chrome) throw new Error('CHROME_BIN required');
    let current: unknown = null;
    let failNext = false;
    const writes: ProgressBatch[] = [];
    const wire = {
      protocol: 1,
      accountId: 'owner',
      generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
    };
    let revision = 0;
    let completed = false;
    const ledger = new Map<string, unknown>();
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
          revision++;
          return Response.json({});
        }
        if (path === '/fail') {
          failNext = true;
          return Response.json({});
        }
        if (path === '/writes') return Response.json(writes);
        if (path === '/api/subscriptions')
          return Response.json({ ...wire, revision: '0', items: [] });
        if (path === '/api/progress') {
          if (request.method === 'GET') {
            const url = new URL(request.url);
            if (url.searchParams.get('view') !== 'state')
              return Response.json(current);
            const ids = url.searchParams.get('episodeIds')?.split(',') ?? [];
            const row = current as { position: number } | null;
            return Response.json({
              ...wire,
              revision: String(revision),
              items: ids.map((episodeId) => ({
                episodeId,
                progress: row
                  ? {
                      positionSeconds: Math.floor(row.position),
                      completed,
                      revision: String(revision),
                      updatedAtMs: null,
                    }
                  : null,
              })),
            });
          }
          const update = await request.json();
          writes.push(update);
          if (failNext) {
            failNext = false;
            return Response.json({ message: 'Unavailable' }, { status: 503 });
          }
          const key = `${update.clientId}:${update.sequence}`;
          if (!ledger.has(key)) {
            revision++;
            const change = update.changes.at(-1);
            completed = change.completed;
            if (current)
              (current as { position: number }).position =
                change.positionSeconds;
            const { changes, ...stream } = update;
            ledger.set(key, {
              ...stream,
              revision: String(revision),
              results: changes.map((item: { episodeId: string }) => ({
                episodeId: item.episodeId,
                status: 'applied',
              })),
            });
          }
          return Response.json(ledger.get(key));
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
    expect(writes.map((batch) => batch.changes)).toEqual([
      [{ episodeId: '2', positionSeconds: 1439, completed: false }],
      [{ episodeId: '2', positionSeconds: 2101, completed: false }],
      [{ episodeId: '2', positionSeconds: 2140, completed: false }],
      [{ episodeId: '2', positionSeconds: 2140, completed: false }],
      [{ episodeId: '2', positionSeconds: 3600, completed: true }],
    ]);
    expect(writes[3]).toEqual(writes[2]);
    expect(
      writes.every(
        (batch) => batch.protocol === 1 && batch.accountId === 'owner',
      ),
    ).toBe(true);
  },
  60_000,
);
