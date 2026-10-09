import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from '@/data/api';
import { feedRefreshOptions } from '@/data/feed-refresh';
import { AccountContext } from '@/shared/auth/AccountBoundary';
import { AccountSession } from '@/shared/auth/account-session';
import type { FeedFreshness } from '@/shared/feed-contract';
import { FeedRefresh } from './FeedRefresh';

const now = 1_750_000_000_000;
const clients: QueryClient[] = [];
let clock: ReturnType<typeof spyOn<typeof Date, 'now'>>;

beforeEach(() => {
  clock = spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  clock.mockRestore();
});

function fixture(freshness?: FeedFreshness, startedAt = now) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryOnMount: false, gcTime: Infinity },
    },
  });
  clients.push(client);
  const session = new AccountSession(client, null, {
    resetPlayer() {},
    reload() {},
    publish() {},
  });
  const options = feedRefreshOptions(session, '152', () => {}, false, now);
  if (freshness)
    client.setQueryData(options.queryKey, {
      podcastId: '152',
      freshness,
      startedAt,
    });
  const render = (empty = false, initialFreshness?: FeedFreshness) =>
    renderToStaticMarkup(
      <AppRouterContext.Provider
        value={{
          bfcacheId: 'fixture',
          back() {},
          forward() {},
          refresh() {},
          push() {},
          replace() {},
          prefetch() {},
        }}
      >
        <QueryClientProvider client={client}>
          <AccountContext.Provider value={session}>
            <FeedRefresh
              podcastId="152"
              empty={empty}
              initialFreshness={initialFreshness}
            />
          </AccountContext.Provider>
        </QueryClientProvider>
      </AppRouterContext.Provider>,
    );
  return { client, options, render };
}

const freshness = (
  state: FeedFreshness['state'],
  content: FeedFreshness['content'] = 'cached',
  retryAtMs: number | null = null,
): FeedFreshness => ({ state, content, checkedAtMs: null, retryAtMs });

for (const state of ['pending', 'backoff', 'stale', 'unavailable'] as const)
  test(`usable episodes keep ${state} background work invisible`, () => {
    expect(fixture(freshness(state)).render()).toBe('');
  });

test('retained episodes stay usable even when the server reports missing content', () => {
  const f = fixture(freshness('pending', 'missing', now + 5000));
  expect(f.render()).toBe('');
});

test('a failed refresh stays quiet with usable episodes and offers retry without them', async () => {
  const fetcher = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ message: 'Feed unavailable' }, { status: 503 }),
  );
  try {
    const f = fixture();
    await expect(f.client.fetchQuery(f.options)).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(f.render()).toBe('');
    const markup = f.render(true);
    expect(markup).toContain('Episodes could not be loaded.');
    expect(markup).toContain('>Retry</button>');
    expect(markup).not.toContain('disabled=""');
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    fetcher.mockRestore();
  }
});

test('missing episodes show preparation while automatic rechecks can still run', () => {
  const f = fixture(freshness('pending', 'missing', now + 5000));
  const markup = f.render(true);
  expect(markup).toContain('role="status" aria-live="polite"');
  expect(markup).toContain('Preparing episodes…');
  expect(markup).not.toContain('>Retry</button>');
});

test('missing episodes retain loading feedback before the first refresh response', () => {
  const f = fixture();
  expect(f.render()).toBe('');
  expect(f.render(true)).toContain('Loading episodes…');
});

test.each([
  ['before', now + 900_000, true],
  ['after', now - 1000, false],
] as const)('missing episodes honor retry advice %s its deadline', (_when, retryAt, disabled) => {
  const f = fixture(freshness('backoff', 'missing', retryAt), now - 120_000);
  const markup = f.render(true);
  expect(markup).toContain(
    'Episodes are temporarily unavailable. Try again shortly.',
  );
  expect(markup).toContain('>Retry</button>');
  expect(markup.includes('disabled=""')).toBe(disabled);
});

test('missing episodes allow retry once automatic preparation rechecks have expired', () => {
  const f = fixture(freshness('pending', 'missing'), now - 120_000);
  const markup = f.render(true);
  expect(markup).toContain('Preparing episodes…');
  expect(markup).toContain('>Retry</button>');
  expect(markup).not.toContain('disabled=""');
});
