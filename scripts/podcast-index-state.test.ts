import { expect, test } from 'bun:test';
import {
  INITIAL_PODCAST_INDEX_CURSOR,
  isAfterPodcastIndexCursor,
} from './lib/podcast-index-state';

test('Podcast Index cursors order by source timestamp and id', () => {
  expect(
    isAfterPodcastIndexCursor(10, 3, {
      lastUpdate: 10,
      lastId: 2,
    }),
  ).toBe(true);
  expect(
    isAfterPodcastIndexCursor(10, 2, {
      lastUpdate: 10,
      lastId: 2,
    }),
  ).toBe(false);
  expect(
    isAfterPodcastIndexCursor(11, 1, {
      lastUpdate: 10,
      lastId: 999,
    }),
  ).toBe(true);
  expect(
    isAfterPodcastIndexCursor(9, 1000, {
      lastUpdate: 10,
      lastId: 2,
    }),
  ).toBe(false);
});

test('the initial cursor starts before every valid source row', () => {
  expect(isAfterPodcastIndexCursor(0, 1, INITIAL_PODCAST_INDEX_CURSOR)).toBe(
    true,
  );
  expect(isAfterPodcastIndexCursor(1, 0, INITIAL_PODCAST_INDEX_CURSOR)).toBe(
    true,
  );
});
