import { expect, test } from 'bun:test';
import { runBrowserFixture } from './lib/browser-fixture';

const chrome = process.env.CHROME_BIN;

test.skipIf(!chrome)(
  'real two-tab cookie change retires private hydration, queries and playback',
  async () => {
    if (!chrome) throw new Error('CHROME_BIN required');
    let progressWrites = 0;
    const outcome = await runBrowserFixture({
      chrome,
      entrypoint: new URL(
        './fixtures/account-boundary-browser.tsx',
        import.meta.url,
      ),
      headers: {
        'Set-Cookie': 'account=owner-a; HttpOnly; SameSite=Strict; Path=/',
      },
      fetch(request) {
        const path = new URL(request.url).pathname;
        const other = request.headers
          .get('cookie')
          ?.includes('account=other-b');
        if (path === '/switch')
          return Response.json(
            {},
            {
              headers: {
                'Set-Cookie':
                  'account=other-b; HttpOnly; SameSite=Strict; Path=/',
              },
            },
          );
        if (path === '/api/auth/session')
          return Response.json({
            user: {
              id: other ? 'other-b' : 'owner-a',
              email: 'fixture@example.invalid',
              name: null,
              image: null,
              hasPasskey: false,
            },
          });
        if (path === '/api/progress') {
          if (request.method !== 'GET') progressWrites++;
          return Response.json(
            request.method === 'GET' ? null : { success: true },
          );
        }
        if (path === '/api/feed/episodes')
          return Response.json({ message: 'Unavailable' }, { status: 404 });
      },
    });
    expect(outcome.checks).toMatchObject({
      crossTab: true,
      staleHydrationHidden: true,
      deniedRefetchCleared: true,
      delayedResponseFenced: true,
      progressRestoreFenced: true,
      queueCleared: true,
      publicCacheRetained: true,
    });
    expect(outcome.requests).toContain('/peer');
    expect(outcome.requests).toContain('/switch');
    expect(outcome.requests).toContain('/api/feed/episodes');
    expect(progressWrites).toBe(0);
  },
  60_000,
);
