import { expect, test } from 'bun:test';
import type { iTunes } from '@/types';
import { adaptResponse } from './adapter';

const podcast = (collectionId: number): iTunes.Podcast => ({
  collectionId,
  collectionName: 'Search Engine',
  collectionCensoredName: 'Search Engine',
  collectionExplicitness: 'notExplicit',
  collectionViewUrl: `https://podcasts.apple.com/podcast/id${collectionId}`,
  artistName: 'Author',
  artworkUrl100: 'https://example.com/thumbnail.jpg',
  artworkUrl600: 'https://example.com/cover.jpg',
  feedUrl: 'https://example.com/feed',
  genreIds: ['1304'],
  genres: ['Education'],
  primaryGenreName: 'Education',
  kind: 'podcast',
  releaseDate: '2026-09-28T00:00:00Z',
  trackCount: 144,
});

test('Apple search results retain collection IDs as numeric result IDs', () => {
  const ids = [1614253637, 6806963519];
  const results = adaptResponse({ results: ids.map(podcast) });
  expect(results.map((result) => result.id)).toEqual(ids);
});

test('feed URL exceptions preserve the Apple search identity', () => {
  const result = adaptResponse({
    results: [{ ...podcast(1473872585), feedUrl: '' }],
  });
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe(1473872585);
  expect(result[0].feed).toBe('https://apple.news/podcast/apple_news_today');
});
