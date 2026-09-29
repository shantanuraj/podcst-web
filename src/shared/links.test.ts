import { expect, test } from 'bun:test';
import type { IPodcastSearchResult } from '@/types';
import { getSearchResultHref } from './links';

const result: IPodcastSearchResult = {
  feed: 'https://example.com/feed',
  title: 'Example',
  author: 'Author',
  cover: 'cover',
  thumbnail: 'thumbnail',
};

test('known search results link directly to the database podcast ID', () => {
  expect(
    getSearchResultHref({ ...result, id: 152, itunes_id: 1614253637 }),
  ).toBe('/episodes/152');
});

test('unindexed Apple results link to identity resolution', () => {
  expect(getSearchResultHref({ ...result, itunes_id: 1614253637 })).toBe(
    '/itunes/1614253637',
  );
});

test('RSS-only results keep their feed resolution path', () => {
  expect(getSearchResultHref(result)).toBe(
    `/episodes/${encodeURIComponent(result.feed)}`,
  );
  expect(getSearchResultHref({ ...result, id: 152 })).toBe('/episodes/152');
});
