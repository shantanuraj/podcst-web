import { expect, test } from 'bun:test';
import {
  checkpointPodcastIndexCursor,
  checkpointUndatedPodcastIndexCursor,
  INITIAL_PODCAST_INDEX_CURSOR,
  isAfterPodcastIndexCursor,
  readUndatedPodcastIndexCursor,
  writePodcastIndexCursor,
} from './lib/podcast-index-state';
import { startPostgres } from './lib/postgres-sandbox';
import { loadMigrations, migrate } from './migrations';

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
  expect(calls[0]?.text).toContain('undated_last_id = 0');
  expect(calls[0]?.values).toEqual([10, 3]);
});

test('undated checkpoints do not change the dated watermark or completion', async () => {
  const calls: QueryCall[] = [];
  await checkpointUndatedPodcastIndexCursor(fakeSql(calls), 42);
  expect(calls[0]?.values).toEqual([42]);
  expect(calls[0]?.text).toContain('SET undated_last_id = ');
  expect(calls[0]?.text).not.toContain('completed_at');
  expect(calls[0]?.text).not.toContain('SET last_update');
});

test.skipIf(!process.env.PG_BIN)(
  'the undated migration preserves completed dated state and checkpoints independently',
  async () => {
    const cluster = startPostgres();
    try {
      const chain = loadMigrations();
      const upgradeIndex = chain.findIndex(
        ({ name }) => name === '0023-podcast-index-undated.sql',
      );
      expect(upgradeIndex).toBeGreaterThan(0);
      await migrate(cluster.sql, chain.slice(0, upgradeIndex));
      await cluster.sql`
        UPDATE podcast_index_sync_state
        SET last_update = 100, last_id = 99, completed_at = '2026-01-01T00:00:00Z'
      `;
      const [before] = await cluster.sql`
        SELECT last_update, last_id, completed_at FROM podcast_index_sync_state
      `;
      await migrate(cluster.sql, chain.slice(0, upgradeIndex + 1));
      expect(await readUndatedPodcastIndexCursor(cluster.sql)).toBe(0);
      await checkpointUndatedPodcastIndexCursor(cluster.sql, 42);
      expect(await readUndatedPodcastIndexCursor(cluster.sql)).toBe(42);
      const [checkpointed] = await cluster.sql`
        SELECT last_update, last_id, completed_at FROM podcast_index_sync_state
      `;
      expect(checkpointed).toEqual(before);
      await expect(
        checkpointUndatedPodcastIndexCursor(cluster.sql, -1),
      ).rejects.toThrow();
      expect(await readUndatedPodcastIndexCursor(cluster.sql)).toBe(42);

      await writePodcastIndexCursor(cluster.sql, {
        lastUpdate: 100,
        lastId: 99,
      });
      expect(await readUndatedPodcastIndexCursor(cluster.sql)).toBe(0);
      const [completed] = await cluster.sql`
        SELECT last_update, last_id, completed_at FROM podcast_index_sync_state
      `;
      expect(completed.last_update).toBe(before.last_update);
      expect(completed.last_id).toBe(before.last_id);
      expect(completed.completed_at.getTime()).toBeGreaterThan(
        before.completed_at.getTime(),
      );
    } finally {
      await cluster.stop();
    }
  },
  30_000,
);

test('undated cursor reads reject invalid or missing state', async () => {
  const sql = (rows: unknown[]) =>
    (() => Promise.resolve(rows)) as unknown as Parameters<
      typeof readUndatedPodcastIndexCursor
    >[0];
  expect(
    await readUndatedPodcastIndexCursor(sql([{ undated_last_id: '42' }])),
  ).toBe(42);
  for (const value of ['-1', 'bad', '9007199254740992'])
    await expect(
      readUndatedPodcastIndexCursor(sql([{ undated_last_id: value }])),
    ).rejects.toThrow('invalid');
  await expect(readUndatedPodcastIndexCursor(sql([]))).rejects.toThrow(
    'missing',
  );
});
