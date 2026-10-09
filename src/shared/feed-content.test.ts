import { expect, test } from 'bun:test';
import type { IEpisodeInfo, IPaginatedEpisodes } from '@/types';
import { preserveEpisodePages, preserveFeedContent } from './feed-content';
import type { FeedFreshness } from './feed-contract';

const pending: FeedFreshness = {
  content: 'missing',
  state: 'pending',
  checkedAtMs: null,
  retryAtMs: 5000,
};
const episode = (id: string) =>
  ({ id, feed: 'https://example.invalid/rss', guid: id }) as IEpisodeInfo;

test('pending reads retain current-scope content without changing exact identity or server totals', () => {
  const old = { episodes: [episode('9007199254740993'), episode('2')] };
  const next = {
    freshness: pending,
    episodes: [episode('2')],
    total: 1,
    hasMore: false,
  };
  const merged = preserveFeedContent(old, next);
  expect(merged.episodes.map((item) => item.id)).toEqual([
    '2',
    '9007199254740993',
  ]);
  expect(merged.total).toBe(1);
  expect(merged.freshness).toEqual(pending);
  expect(preserveFeedContent(undefined, next)).toBe(next);
});

test('a missing SSR hydration cannot wipe earlier cached pages but a validated empty page stays empty', () => {
  const page: IPaginatedEpisodes = {
    episodes: [episode('1')],
    total: 2,
    hasMore: true,
    nextCursor: 1,
  };
  const previous = {
    pages: [page, { ...page, episodes: [episode('2')] }],
    pageParams: [undefined, 1],
  };
  const next = {
    pages: [
      { ...page, episodes: [], total: 0, hasMore: false, freshness: pending },
    ],
    pageParams: [undefined],
  };
  expect(
    preserveEpisodePages(previous, next).pages[0].episodes.map(
      (item) => item.id,
    ),
  ).toEqual(['1', '2']);
  const empty = {
    ...next.pages[0],
    freshness: {
      content: 'cached',
      state: 'fresh',
      checkedAtMs: 1,
      retryAtMs: null,
    } as FeedFreshness,
  };
  expect(preserveFeedContent(page, empty).episodes).toEqual([]);
});
