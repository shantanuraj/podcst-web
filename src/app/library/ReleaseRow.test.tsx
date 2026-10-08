import { expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  episodeProgressQueries,
  invalidateProgress,
  useEpisodeProgress,
} from '@/data/progress';
import { AccountContext } from '@/shared/auth/AccountBoundary';
import { accountQueryKey } from '@/shared/auth/account';
import { AccountSession } from '@/shared/auth/account-session';
import { TranslationProvider } from '@/shared/i18n';
import { newReleases } from '@/shared/releases';
import type { IEpisodeInfo } from '@/types';
import { ReleaseRow } from './ReleaseRow';

const episode = {
  id: '201',
  podcastId: '7',
  title: 'Finished fixture',
  podcastTitle: 'Fixture show',
  feed: 'https://example.invalid/feed',
  guid: 'finished',
  cover: 'https://example.invalid/art.jpg',
  duration: 100,
  published: 1000,
} as IEpisodeInfo;

function account(scope: string | null = 'fixture') {
  return new AccountSession(
    new QueryClient(),
    scope
      ? {
          id: scope,
          email: 'fixture@example.invalid',
          name: null,
          image: null,
          hasPasskey: false,
        }
      : null,
    {
      resetPlayer() {},
      reload() {},
      publish() {},
    },
  );
}

function Rows({ ids }: { ids: string[] }) {
  const progress = useEpisodeProgress(ids);
  return (
    <ReleaseRow
      episode={episode}
      when="Yesterday"
      progress={progress.get('201')}
    />
  );
}

function render(completed?: boolean, scope: string | null = 'fixture') {
  const session = account(scope);
  const ids = Array.from({ length: 201 }, (_, index) => String(index + 1));
  for (const query of episodeProgressQueries(session, ids)) {
    session.client.setQueryData(
      query.queryKey,
      query.queryKey.at(-1) === '201' && completed !== undefined
        ? [{ episodeId: '201', position: 0, completed }]
        : [],
    );
  }
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={session.client}>
      <AccountContext.Provider value={session}>
        <TranslationProvider>
          <Rows ids={ids} />
        </TranslationProvider>
      </AccountContext.Provider>
    </QueryClientProvider>,
  );
  session.client.clear();
  return markup;
}

test('completed releases remain visible, marked played, with enabled replay and navigation', () => {
  const markup = render(true);
  expect(markup).toContain('data-played="true"');
  expect(markup).toContain('Played');
  expect(markup).toContain('Finished fixture');
  expect(markup).toContain('aria-label="Play Finished fixture"');
  expect(markup).toContain('href="/episodes/7/201"');
  expect(markup).not.toContain('aria-disabled="true"');
  expect(
    newReleases([
      { episodes: [episode, { ...episode, id: '202', published: 2000 }] },
    ]).map(({ id }) => id),
  ).toEqual(['202', '201']);
});

test('unfinished and unknown progress do not appear played', () => {
  for (const completed of [false, undefined]) {
    expect(render(completed)).toContain('data-played="false"');
    expect(render(completed)).not.toContain('Played');
  }
});

test('progress queries cover every release in bounded, deduplicated account-scoped batches', () => {
  const session = account();
  const queries = episodeProgressQueries(session, [
    '201',
    ...Array.from({ length: 201 }, (_, i) => String(i + 1)),
  ]);
  expect(queries).toHaveLength(2);
  expect(String(queries[0].queryKey.at(-1)).split(',')).toHaveLength(200);
  expect(queries[1].queryKey.at(-1)).toBe('201');
  expect(queries[1].queryKey).not.toEqual(
    episodeProgressQueries(account('another'), ['201'])[0].queryKey,
  );
  expect(episodeProgressQueries(account(null), ['201'])[0].enabled).toBe(false);
  expect(episodeProgressQueries(session, [])).toEqual([]);
  session.client.clear();
});

test('playback saves invalidate release and continue caches only for the current account', () => {
  const session = account();
  for (const scope of ['fixture', 'another']) {
    for (const kind of [
      'episode-progress',
      'podcast-progress',
      'recent-progress',
      'subscriptions',
    ]) {
      session.client.setQueryData(accountQueryKey(scope, kind), []);
    }
  }
  invalidateProgress(session);
  expect(
    session.client.getQueryState(accountQueryKey('fixture', 'episode-progress'))
      ?.isInvalidated,
  ).toBe(true);
  expect(
    session.client.getQueryState(accountQueryKey('fixture', 'recent-progress'))
      ?.isInvalidated,
  ).toBe(true);
  expect(
    session.client.getQueryState(accountQueryKey('another', 'episode-progress'))
      ?.isInvalidated,
  ).toBe(false);
  expect(
    session.client.getQueryState(accountQueryKey('fixture', 'subscriptions'))
      ?.isInvalidated,
  ).toBe(false);
  session.client.clear();
});
