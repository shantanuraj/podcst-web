import { expect, test } from 'bun:test';
import { runBrowserFixture } from './lib/browser-fixture';

const chrome = process.env.CHROME_BIN;
test.skipIf(!chrome)(
  'browser readiness admits once, rechecks with GET and retains cached content',
  async () => {
    if (!chrome) throw new Error('CHROME_BIN required');
    let posts = 0;
    let reads = 0;
    const outcome = await runBrowserFixture({
      chrome,
      entrypoint: new URL(
        './fixtures/feed-readiness-browser.ts',
        import.meta.url,
      ),
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        if (path === '/api/feed/refresh') {
          posts++;
          expect(await request.json()).toEqual({
            podcastId: '9007199254740993',
          });
          return Response.json(
            {
              podcastId: '9007199254740993',
              freshness: {
                content: 'missing',
                state: 'pending',
                checkedAtMs: null,
                retryAtMs: Date.now() + 5000,
              },
            },
            { status: 202 },
          );
        }
        if (path === '/api/feed/episodes') {
          reads++;
          return Response.json({
            episodes: [],
            total: 0,
            hasMore: false,
            freshness: {
              content: 'cached',
              state: 'fresh',
              checkedAtMs: Date.now(),
              retryAtMs: null,
            },
          });
        }
      },
    });
    expect(outcome.checks).toMatchObject({
      admitted: true,
      refreshed: 1,
      guestRetained: true,
      byteBounded: true,
    });
    expect(posts).toBe(1);
    expect(reads).toBe(1);
  },
  60_000,
);
