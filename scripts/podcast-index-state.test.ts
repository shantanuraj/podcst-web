import { expect, test } from 'bun:test';
import {
  checkpointPodcastIndexCursor,
  INITIAL_PODCAST_INDEX_CURSOR,
  isAfterPodcastIndexCursor,
  writePodcastIndexCursor,
} from './lib/podcast-index-state';

interface QueryCall {
  text: string;
  values: unknown[];
}

function fakeSql(calls: QueryCall[]) {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(''), values });
    return Promise.resolve({ count: 1 });
  }) as unknown as Parameters<typeof checkpointPodcastIndexCursor>[0];
}

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

test('checkpoints advance the cursor without marking a run complete', async () => {
  const calls: QueryCall[] = [];

  await checkpointPodcastIndexCursor(fakeSql(calls), {
    lastUpdate: 10,
    lastId: 3,
  });

  expect(calls).toEqual([
    {
      text: '\n    UPDATE podcast_index_sync_state\n    SET last_update = , last_id = \n    WHERE singleton = true\n  ',
      values: [10, 3],
    },
  ]);
});

test('completed cursors record the completion time', async () => {
  const calls: QueryCall[] = [];

  await writePodcastIndexCursor(fakeSql(calls), {
    lastUpdate: 10,
    lastId: 3,
  });

  expect(calls[0]?.text).toContain('completed_at = clock_timestamp()');
  expect(calls[0]?.values).toEqual([10, 3]);
});
