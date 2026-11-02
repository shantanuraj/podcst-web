import { expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { episodesQueryOptions } from '@/data/episode-query';
import { AccountContext } from '@/shared/auth/AccountBoundary';
import { AccountSession } from '@/shared/auth/account-session';
import { TranslationProvider } from '@/shared/i18n';
import type { IEpisodeInfo, IPodcastInfo } from '@/types';
import { PaginatedEpisodesList } from './PaginatedEpisodesList';

const podcast = { id: '7', episodeCount: 1200 } as IPodcastInfo;
const episode = {
  id: '42',
  podcastId: '7',
  feed: 'https://example.invalid/feed',
  guid: 'fixture',
  title: 'Playable cached episode',
  summary: 'Cached summary',
  duration: 300,
} as IEpisodeInfo;

function render(cached: boolean, failed: boolean, rows = [[episode]]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retryOnMount: false } },
  });
  const session = new AccountSession(client, null, {
    resetPlayer() {},
    reload() {},
    publish() {},
  });
  const options = episodesQueryOptions(session, { podcastId: podcast.id });
  const query = client
    .getQueryCache()
    .build(client, { queryKey: options.queryKey });
  if (cached)
    client.setQueryData(options.queryKey, {
      pages: rows.map((episodes, index) => ({
        episodes,
        total: 1200,
        hasMore: true,
        nextCursor: (index + 1) * 20,
      })),
      pageParams: rows.map((_, index) =>
        index === 0 ? undefined : index * 20,
      ),
    });
  if (failed)
    query.setState({
      status: 'error',
      error: new Error('Temporary failure'),
      fetchMeta: cached ? { fetchMore: { direction: 'forward' } } : null,
    });
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AccountContext.Provider value={session}>
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
          <TranslationProvider>
            <PaginatedEpisodesList podcast={podcast} />
          </TranslationProvider>
        </AppRouterContext.Provider>
      </AccountContext.Provider>
    </QueryClientProvider>,
  );
  client.clear();
  return markup;
}

test('a failed older-page load retains playable episodes and exposes a retry below them', () => {
  const markup = render(true, true);
  expect(markup).toContain('Playable cached episode');
  expect(markup).toContain('aria-label="Play Playable cached episode"');
  expect(markup).toContain('role="alert"');
  expect(markup).toContain('>Retry</button>');
  expect(markup.indexOf('Playable cached episode')).toBeLessThan(
    markup.indexOf('>Retry</button>'),
  );
  expect(markup).not.toContain('Loading more');
});

test('an initial episode-load error can be retried without an existing list', () => {
  const markup = render(false, true);
  expect(markup).toContain('Failed to load episodes');
  expect(markup).toContain('>Retry</button>');
  expect(markup).not.toContain('Playable cached episode');
});

test('a loaded first page shows episodes without an error or retry action', () => {
  const markup = render(true, false);
  expect(markup).toContain('Playable cached episode');
  expect(markup).not.toContain('role="alert"');
  expect(markup).not.toContain('>Retry</button>');
});

test('overlapping offset pages show each canonical episode once in first-seen order', () => {
  const first = { ...episode, id: '9007199254740992', title: 'First row' };
  const second = { ...episode, id: '9007199254740993', title: 'Second row' };
  const third = { ...episode, id: '9007199254740994', title: 'Third row' };
  const markup = render(true, false, [
    [first, second],
    [{ ...second, title: 'Duplicate overlapping row' }, third],
  ]);
  expect(markup.match(/<li\b/g)).toHaveLength(3);
  expect(markup).not.toContain('Duplicate overlapping row');
  expect(markup.indexOf('First row')).toBeLessThan(
    markup.indexOf('Second row'),
  );
  expect(markup.indexOf('Second row')).toBeLessThan(
    markup.indexOf('Third row'),
  );
});
